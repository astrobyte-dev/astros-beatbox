# P0a: Make the existing rig report reality

This phase retains the MCP stdio launch, vanilla dashboard, Tidal/SuperDirt musical
path, existing sequencer and `.tidal` set format. It does not implement P0b, a new
project document, undo, recovery storage, React, Vite or a visual redesign.

## Boundaries

| System | Responsibility |
|---|---|
| `commands.ts` | Shared runtime validation, request metadata and result contract |
| `application.ts` | Serialized application commands, retry handling, file operations and updates to the existing slot/code state after acknowledgement |
| `protocol.ts` | Interpreter-specific frames, action acknowledgements, compiler/runtime diagnostics |
| `proc.ts` | One owned interpreter lifetime, output decoding, queue, timeouts, exits and live faults |
| `owned-process.ts` | Windows root creation identity and verified descendant handles for shutdown |
| `engine.ts` | Port preflight, boot/reboot, driver generations, audio setup and health |
| `server.ts`, `dashboard.ts` | MCP/HTTP adapters; neither independently evaluates music nor invents success |

## Acknowledgement contract

Every valid command result has `ok`, `operationId`, `sessionId`, and `generation`.
Failures have `error` and `code`; HTTP uses a non-2xx response and MCP sets `isError`.
An error message is never wrapped in an HTTP success response. Validation happens
before boot or mutation. No command outcome is inferred from a fixed delay or log tail.

Tidal action expressions such as `d1`, `do`, `hush`, and tempo/mixer operations run
inside an exception handler. Only reaching the acknowledgement *inside that action*
can confirm its synchronous return. A later END or prompt is not proof of success.
Both stdout and stderr must finish their command frames; compiler diagnostics,
runtime FAIL, or an absent action acknowledgement cause rejection.

Declarations, pure expressions and GHCi meta commands retain their native REPL
semantics. They return `acknowledgement: "completion"`, explicitly meaning bounded
diagnostic completion, not a verified musical action. Arbitrary code is not a sandbox:
it can alter interpreter settings, suppress diagnostics, or schedule later work.

SuperCollider compiles each expression and acknowledges from inside its evaluation
handler. Internal asynchronous setup and recording routines acknowledge after their
waits and `s.sync` barriers. Raw user routines acknowledge only the outer expression;
their scheduled work can fail later. OSC/audio-device effects are not universally
provable from interpreter completion.

Detected late failures remain visible through engine `error`, `faultVersion`, and
`lastFault`. `observedDuringOperationId` is context, not an assertion about the cause
of a background error. A failure after an earlier response cannot retroactively
change that response. Already applied side effects of arbitrary code cannot be rolled
back atomically. The UI reports uncertain transport state after detected failures.

A command timeout quarantines its interpreter. Pending/queued work fails instead
of being replayed into an unknown interpreter state. Reset creates new drivers and
generations. Old output, faults and queued work cannot update the new generation.
Audio-server loss also marks the engine unavailable even if sclang remains alive.
GHCi boot verifies the actual Tidal stream binding; a later prompt alone is insufficient.

## Retries and ordering

Clients may omit retry metadata and receive a generated operation ID. For retriable
operations, supply `operationId`, the `sessionId` from status, and the original
`issuedAt` timestamp in Unix milliseconds. Reuse all of them with the same payload.

Within five minutes, duplicate pending or completed requests return the same result
without another execution. Reusing an ID with a different payload is rejected.
Expired requests and requests from a previous server session are rejected, not
automatically replayed. The bounded cache is in memory; this is not durable exactly-once
delivery across restarts. The dashboard serializes commands in submission order and
does not automatically retry an uncertain network outcome. HTTP and MCP share the
same server queue. Work queued before a Reset cannot silently target its successor.

## Intentional behavior changes

- Stop keeps tracked slot code, tempo and mute/solo choices. Play replays those
  patterns and restores the choices. Explicit Tidal `hush` retains its clear-all behavior.
- Stop suspends automatic sequencer song advancement and flushes pending painted
  edits before stopping. The cards and Play button remain available.
- Reset attempts to replay the tracked set, including its stopped state. User-defined
  interpreter bindings do not survive an engine restart; replay failures are reported.
- Failed code stays in the console. Failed eval/knob commands do not replace the last
  acknowledged slot code. Multi-action code may still have partially affected the engine.
- Failed set loading retains the prior tracked set and attempts to replay it. This
  is best effort, not transactional restoration of arbitrary interpreter state.
- Recording acknowledges setup/close barriers and validates the finalized RIFF/WAVE
  header and file length before reporting a saved recording. A broken recorder does
  not prevent Reset, but unconfirmed finalization remains an explicit failure.
- Occupied HTTP/audio/meter ports cause a clear failure. There is no port takeover
  or blanket termination by executable name, including in the legacy diagnostic scripts.
- Graceful MCP stdin close releases owned resources. The launch arrangement is unchanged.

## Ownership limits

Only child processes spawned by this application can establish an ownership root.
Windows shutdown verifies root PID **and creation time**, opens native process handles,
and verifies descendants against parent relationships and creation times before stopping
them. It does not infer ownership from names or ports. Ownership tests keep an unrelated
process of the same executable alive while the owned tree is stopped.

Forced host termination can bypass cleanup. If a parent has already exited and a
descendant cannot be verified, cleanup deliberately leaves it alone. A later instance
does not adopt or kill that process. Occupied ports require explicit user cleanup;
durable ownership recovery or Windows job objects are not implemented in this phase.

## Validation

Baseline: 31 tests passed; build and typecheck passed, with no pre-existing failures.

- `npm test`: builds first, then runs the full suite; discovery floor raised to 75.
- `npm run typecheck` and `npm run build`.
- `npm run selftest`: real SuperDirt/Tidal audio path and stereo meter assertion.
- `npm run selftest:p0a`: real compilation/runtime/late errors, timeout quarantine,
  Stop/Play, set save/load, duplicate recording requests, WAV content, Reset and scsynth loss.
- Automated HTTP/MCP tests cover error propagation, original tool names and launch,
  operation identity, static dashboard serving, and refusal to evict a port owner.
- Dashboard unit tests cover code retention, network errors, newer text during an
  evaluation, Play availability and stopped song advancement.
- Windows ownership tests run real owned and unrelated Node processes. They are
  explicitly skipped on other operating systems; the remainder needs no audio engine.

An interactive browser was unavailable during implementation. Dashboard logic and
HTTP delivery were tested, but visual rendering, pointer gestures, device switching
across physical devices, audible quality and forced-host-death recovery were not
validated end to end. Legacy PowerShell diagnostics had their unsafe cleanup removed;
the maintained Node self-tests are the runtime validation path.

## Remaining scope for later phases

The slot/code projection is still approximate. The sequencer, pattern bank and curves
retain their existing browser-local state; arbitrary Tidal is not losslessly represented
there. Regex-based parameter editing remains structurally limited. `.tidal` saving is
still a set export, not a complete session save. Canonical music state, editing/code
ownership, undo/redo, durable recovery and recording-library UX remain future work.
P0a acknowledges commands and reports uncertainty; it does not claim full musical-state
introspection or guaranteed rollback of arbitrary code.

## Implementation validation record — 2026-09-06

Windows, Node 24.14.0: 75 automated tests passed, zero failed or skipped. Typecheck,
build, dashboard JavaScript syntax, PowerShell diagnostic syntax and diff whitespace
checks passed. The original live audio self-test measured L+R 0.376 (0.188 each).
The P0a live test passed with meter peak 0.188 and a finalized 389,932-byte WAV with
PCM peak 4,044; compiler/runtime/late faults, timeout quarantine, retained-set Reset
and scsynth exit detection also passed. Both live tests released their owned audio ports.

## Files changed

| Group | Files |
|---|---|
| Added runtime boundaries | `mcp/src/application.ts`, `commands.ts`, `protocol.ts`, `owned-process.ts` |
| Added automated tests | `mcp/src/application.test.ts`, `protocol.test.ts`, `ownership.test.ts`, `dashboard.test.ts`, `dashboard-client.test.ts`, `mcp.test.ts` |
| Added opt-in live test | `mcp/src/p0a-selftest.ts` |
| Modified server/drivers | `mcp/src/server.ts`, `dashboard.ts`, `engine.ts`, `proc.ts`, `sclang.ts`, `tidal.ts`, `meter.ts` |
| Modified existing diagnostics | `mcp/src/selftest.ts`, `diag_record.ts`, `fullchain_test.ps1`, `sc/interactive_test.ps1` |
| Modified dashboard | `mcp/dashboard.js`, `dashboard-seq.js`, `dashboard-curves.js`, `dashboard.html` |
| Modified engine boot files | `tidal/BootTidal.hs`, `sc/superdirt_startup.scd` |
| Modified tooling/docs | `mcp/package.json`, `mcp/run-tests.mjs`, `README.md`, `CONTRIBUTING.md` |
| Added documentation | `docs/p0a-command-boundary.md` |
