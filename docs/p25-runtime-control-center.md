# P2.5 — Runtime Control Center and Windows lifecycle

Implemented on the completed P2 commit `4cd75f1`. P3 has not begun.

**P2.5 is complete and accepted as of 2026-09-07.** The user confirmed
that the real Windows launcher opened Studio in Opera GX, produced the expected
Studio browser request and zero console-show events, and preserved the existing
runtime and active session without restart or disruption. This was real Windows
launcher/default-browser validation, not merely a mocked or unit test.

One earlier P2 creative journey produced a silent take. Repeated investigation
did not reproduce it and no root cause is claimed. The investigation is complete
for this milestone; its residual uncertainty remains documented in
[the investigation](p25-silent-take-investigation.md) and
[repeated validation evidence](p25-investigation-validation.json).

## Baseline

Before edits, read recent history, P0a/P0b/P1/P2 reports, the command queue,
project/storage boundaries, process ownership and interpreter drivers, persistent
runtime/MCP adapters, recording/Preview routing, telemetry, HTTP security, Studio
and Windows diagnostics. The working tree was initially clean.

All 124 baseline automated tests passed, with no skips. Production build and both
TypeScript checks passed. Classic, Studio and P2 Chromium journeys passed. The
base audio, P0a, P0b, Studio live, P2 live and persistent-runtime reconnect tests
all passed before implementation. Baseline output remains in ignored
`mcp/baseline-*.log`; previous milestone screenshots and measurement files are
preserved in Git, with this phase's evidence recorded separately.

## Runtime and control architecture

P2's persistent Node owner remains the sole owner of `Application`, `Engine`,
HTTP and telemetry. The MCP adapter and browsers remain disposable clients.
Disconnecting either does not stop audio or recording. The persistent owner's
detached launch remains intact; no second supervisor, music store, desktop
runtime, runtime-adoption mechanism or process-killing authority was introduced.

| Boundary | P2.5 addition |
| --- | --- |
| `proc.ts` | Read-only driver facts, creation observation, exit state, stream-tagged output |
| `engine.ts` | Generation-filtered output forwarding and acknowledged audio format observation |
| `runtime-inspection.ts` | Bounded asynchronous Windows process/socket observation and conservative ownership projection |
| `runtime-health.ts` | Structured health, actual service hierarchy, client leases, project/audio summary and transition times |
| `runtime-logs.ts` | Bounded diagnostics buffer and redaction |
| `application.ts` | Lifecycle actions in the existing P0a serialized queue and retry cache |
| `runtime.ts` | Attaches observations and lifecycle hooks to the existing owner |
| `dashboard.ts` | Guarded health/log/client endpoints and production `/system` serving |
| `runtime-client.ts`, `launcher.ts` | Existing-instance reuse and clear external-conflict reporting |
| `System.tsx` | Disposable status/controls UI using the existing Studio design system |

### Health contract

`GET /runtime/health` returns schema version 1, runtime session and engine
generation, snapshot/inspection timestamps, overall health and last transition,
components, ports, lifecycle progress/error, audio facts, current project, last
engine fault and log cursor. Drivers expose alive/usable/exited state, exit code,
driver generation, PID, start observation and last error. Components carry an
observed transition time and supported restart group.

Readiness uses the existing acknowledged interpreter/engine state and recent
audio telemetry. An existing PID alone never makes an interpreter or audio
service Ready. Stale meters, missing owned roots, missing scsynth, failed OS
inspection, port conflicts and lifecycle failures require attention. Inspection
is refreshed at most every three seconds during ordinary reads and invalidated
across engine generations; an observation spanning generations is marked stale.
There is no independent background authority deciding whether music may execute.

The hierarchy reflects the actual implementation: Node contains HTTP, application,
telemetry and catalogue services; its audio engine owns Tidal and sclang roots.
Windows GHCup/GHC and SC launch helpers and scsynth appear under their observed
parents. Supporting process trees are disclosed on demand. The recorder has
catalogue/lifecycle code in Node and its existing tap/writer in the audio engine.

MCP clients appear separately as **host-launched / not owned**. Their reported
PIDs and connection times are explicitly connection observations, not termination
rights. Heartbeats run every four seconds, expire after fifteen seconds, and
retain at most 32 entries. Disconnecting a client leaves runtime ownership alone.

### Ownership and ports

Termination still exclusively uses the existing P0a child roots and native
process handles. The original `owned-process.ts` creation-time and descendant
checks are unchanged. The display matches root PID **and creation identity**, then
checks ancestry and descendant creation ordering against a fresh OS observation.
Display data cannot grant a kill capability. PID reuse, missing roots and stale
generations do not cause adoption. Unverifiable orphans remain external.

Required ports include HTTP (3737 by default), meter UDP (57199 by default),
scsynth UDP 57110, instrument UDP 57120 and Tidal control UDP 6010. Additional
owned listeners/UDP endpoints are discovered rather than omitted. MCP stdio has
no TCP listener of its own. The UI shows protocol, purpose, address, PID, executable
name/path, start time, ownership and conflict/unknown/free observation.

These are snapshots, not atomic reservations. “Free” means no listener observed
in that snapshot; actual engine/HTTP/socket binds still arbitrate startup races.
Non-loopback-only bindings are shown as unverified for a loopback conflict.
Inspection errors do not turn ports green. Similar audio executable names are
labelled as possible dependencies, never proof of another compatible runtime.
An occupied telemetry port leaves System available to explain the failure.

### Single instance and launcher

`Launch Beatbox.vbs` starts the compiled Node launcher with creation-time hidden
window style, without CMD or PowerShell wrappers. It opens Studio through a
hidden `cscript.exe` helper running `open-studio.vbs`, which uses ShellExecute
with normal browser visibility. The former hidden Explorer path could start the
runtime without visibly opening Opera GX; this final correction fixes that path. `npm run launch` supports an already-open developer terminal. The
`--no-open` launcher test option uses the same runtime launch path while allowing
the Chromium acceptance test to open and inspect Studio itself.

The existing live `/runtime` handshake is retained and more strictly validated:
kind, protocol, workspace key, positive PID, ready state and ready session UUID.
It is a **structural compatibility handshake**, not cryptographic authentication
against a hostile local process. No stale identity file grants ownership. A valid
preparing instance is awaited without spawning another runtime. A ready instance
is reused and Studio says Beatbox was already running. Simultaneous first launches
still use P2's HTTP bind arbitration; a losing process never opens the catalogue
or starts audio children.

An unrelated/incompatible HTTP owner is inspected and reported with
`PORT CONFLICT (EADDRINUSE)`, PID, executable and available start time. It is never
killed. The VBS launcher displays startup failures intentionally in a message box.

### Headless Windows correction

The first real window trace detected terminal-show events during SC preparation.
Changing only sclang's Windows launch from `detached: true` to `detached: false`,
while retaining `windowsHide: true` and piped stdio, eliminated the observed
flashes. Windows ignores no-window creation when combined with detached process
creation. WASAPI/SystemClock audio passed with the corrected child launch.

The persistent **Node owner remains detached**. This distinction matters because
Node/libuv assigns non-detached children to its parent-lifetime job. Removing
detachment from the owner could regress P2 reconnect persistence. No hide-after-
launch polling, global OS setting changes or third-party binary patches are used.
The installed SuperCollider launch helper remains part of its owned descendant
tree and its captured output remains available.

Audited Node child creation uses `windowsHide`, direct executable launch and
captured output; existing diagnostic PowerShell scripts use `CreateNoWindow`.
Supporting source references: [Node 24.14's Windows process creation](https://github.com/nodejs/node/blob/v24.14.0/deps/uv/src/win/process.c)
and [SuperCollider 3.14.1's Windows launch helper](https://github.com/supercollider/supercollider/blob/Version-3.14.1/common/sc_popen.cpp).

## Lifecycle and shutdown

All four new commands require current `sessionId` and `expectedGeneration`.
The UI also supplies `operationId` and `issuedAt`, using P0a's bounded five-minute
retry contract. Pending/completed retries share results; conflicting IDs and stale
sessions/generations are rejected. Dialog confirmation remains tied to the
session/generation originally reviewed. New work is refused during a pending
lifecycle operation; previously accepted work drains through the existing queue.

| UI control | Command | Behavior |
| --- | --- | --- |
| Restart audio | `audio.restart` | Finalize recording, hush and stop Preview, existing engine reboot, restore jam/transport |
| Stop audio | `audio.stop` | Finalize recording, stop musical work and owned audio; retain authored jam, mark transport stopped |
| Restart services | `runtime.restart` | Restart owned audio and telemetry, then restore the jam; retain persistent Node owner and HTTP |
| Quit Astro's Beatbox | `runtime.quit` | Refuse new work, finalize recording, stop owned audio, close telemetry/HTTP and exit owner |

Individual Tidal/scsynth stop controls are deliberately absent because they would
break the coupled audio engine. Their details identify the safe audio restart
group. There is no pretend MCP restart: MCP clients belong to their host.

Quit's sequence is: close admission, drain accepted work, acknowledge recording
writer-stop/close barriers and validate the WAV, hush Tidal and stop Preview when
possible, stop verified Tidal and SC trees in dependency order, close telemetry,
reply, then close HTTP/connections. Interpreter deadlines and P0a's process
termination waits remain bounded. P0a's native cleanup waits up to three seconds
per verified process and reports failures within its helper timeout.

Any failed recording finalization or process cleanup remains an explicit failure.
HTTP stays available for inspection and deliberate Quit retry, and new music
remains refused after a failed Quit. A successful real Quit was checked against
Windows: the owner and all listed owned child PIDs disappeared and their ports
were released. Signals use the same graceful path; forceful host death retains
P0a's limits on unverifiable orphans. Browser disconnect is not Quit.

## System UX, logs and session summary

System shares Studio's Outfit/DM Sans fonts, warm paper/ink colors, accents,
buttons, cards and dialog styling. A subtle Studio header link reaches it. The
page leads with understandable health and safe actions, followed by the service
tree, audio and current jam. Process IDs and supporting trees are disclosures;
ports and logs sit below the main overview. Healthy status is subdued. Actual
failures/conflicts receive explicit text and stronger contrast.

Native controls, focus outlines, a skip link, status announcements and confirmation
dialogs support keyboard use. Dialogs cycle Tab/Shift+Tab, support Escape and
restore invoking focus. Controls show pending work and cannot submit repeated
operations. Disconnected observations are visibly stale; shutdown has an explicit
closed state. A late response from an old runtime cannot close a newer UI session.

Audio shows observed device/configuration, sample rate/output channels and orbit
count, fresh L/R activity, Preview and recording status. The project summary shows
name, ID, revision, applied revision, recovery and named-save state. Named-save
state is conservative after runtime recovery; recovery checkpoints are not
mislabelled as named saves. No device-management or composition redesign occurred.

The log buffer retains at most 800 entries of at most 2,048 characters each.
Partial stream lines are bounded and cannot cross generations. Logs carry source,
time, severity and optional engine generation. Runtime, Studio, MCP, audio,
telemetry and recording events share the buffer with captured Tidal/SC diagnostics.
Echoed protocol/code frames are suppressed, common credentials/home-user prefixes
are redacted, and no environment map or command payload is deliberately collected.
Arbitrary user code can print arbitrary content; redaction is not a universal
data-loss-prevention system.

Users can filter sources, pause/resume live logs, clear their visible view and copy
visible entries. Developer diagnostics exposes additional captured interpreter
output while services stay headless. Clearing a view does not delete other
clients' history. Log responses carry runtime session identity. The startup-only
file log rotates at the next launch after exceeding 1 MiB; child streams go into
the bounded runtime buffer, not an unbounded file tail.

## Validation evidence

The 2026-09-07 handover rerun passed the complete suite, typechecks, System UI,
real Opera GX launcher, P2 live Preview isolation, 13 additional recording timing
takes, persistent MCP/browser reconnect and real Windows lifecycle/cleanup.
See [final handover measurements](p25-handover-validation.json). Earlier repeated
investigation results below remain separate historical evidence.

Final automated result: **157 passed, zero failed/skipped on Windows**, preserving
all 124 original assertions and adding 33 P2.5 and investigation tests. Production build, server and
Studio type checks, and `git diff --check` pass.

New tests cover root/descendant inventory, PID reuse/missing parents, netstat
parsing, free/owned/external/unknown and dynamic ports, stale identity,
bounded/source-filtered/redacted logs, actual child output/exit, audio stop/restart,
service restart order, pending/completed deduplication, stale lifecycle metadata,
queued work before Quit, stubborn cleanup/failure retry, recording during Quit,
failed finalization, headless launch flags, actual Windows creation identity,
System HTTP/origin guards, stale health generations and bounded MCP leases.

`system-selftest.mjs` passed against production Chromium: three desktop widths,
health/process rendering, confirmation focus/Escape/return, lifecycle pending
states, source logs/pause/clear/diagnostics, a real unrelated UDP listener, and
clean Quit. Original classic/Studio/P2 browser journeys also passed. The Browser
plugin reported no available browser; the repository's installed Chromium harness
was used after checking that availability.

`system-live-selftest.mjs` passed through a real Windows Script Host launcher and
persistent runtime, Studio navigation, actual audio/OS inventory, audio restart,
second launch without duplicate audio children, stop/restart of services, unrelated
TCP conflict, active-recording Quit, all-owned-PID disappearance and relaunch with
stopped recovery. It uses isolated project/recovery/recording storage. Its native
WinEvent observer records top-level show events without window titles, user
content, environment or command lines. **Zero console-show events** were observed
after the sclang fix. The separate `launcher-open-selftest.mjs` exercises the
actual default-browser branch omitted by `--no-open`, and passed with Opera GX.
The user subsequently confirmed the remaining real Windows acceptance check:
Studio opened, its expected browser request was observed, zero console-show
events occurred, and the existing runtime/session remained undisturbed.

See [Windows measurements](p25-windows-validation.json),
[audio regression measurements](p25-audio-regressions.json),
[System overview](p25-system-1440.png), [live audio System](p25-system-live.png),
[conflict](p25-system-conflict.png), and [Quit](p25-system-quit.png).

The base audio, P0a and P0b live regressions passed. Studio live recorded a
443,692-byte nonzero WAV with PCM peak 8,035. The P2 reconnect run preserved the
session/generation and ongoing recording across MCP/browser disconnects; master
peaks before/during/after were 0.188 / 0.201 / 0.164 and the spanning recording
was 1,146,924 bytes with peak 8,037. Three consecutive P2 repeats produced
nonzero journey takes and simultaneous Preview output with exactly zero Preview
in the project-only recording. Full measurements and hashes are in the evidence.

### Findings retained from review

- Fixed real SC terminal flashes without changing the persistent owner.
- Preserved `EADDRINUSE` for the existing conflict regression contract.
- Fixed confirmation focus cycling/return and pinned confirmation identity.
- Invalidated process inspection across engine generations; made missing roots
  and missing scsynth prevent a healthy overall report.
- Prevented partial logs and late UI responses from crossing runtime generations
  or sessions; bounded client/transition observations.
- Kept failed shutdown inspectable and retryable; tested recording before cleanup.
- Scoped the browser conflict assertion to its intended UDP port, since more than
  one real external conflict may be present.
- One P2 journey's finalized WAV was silent despite acknowledged playback. Three
  consecutive reruns passed without weakening assertions or changing audio
  routing. The cause was not established. Failure-only meter/interpreter output
  was added to the existing P2 test for a future recurrence.

During final checks a separate legacy rig appeared on TCP 3737 / UDP 57199:
The process belonged to a different workspace, verified through its launch path.
The normal launcher reported that real conflict and left the process running.
This is not a leaked process from the isolated P2.5 runtime. The default launch
was blocked by those occupied ports. During the followup investigation, the user
explicitly authorized stopping that legacy rig. It was not recording; its verified
process tree was stopped and the ports released. No automatic adoption was added.

## Files

Added: `HANDOFF.md`, `tasks/TASK-2.5.md`, `mcp/open-studio.vbs`,
`mcp/launcher-open-selftest.mjs`; `Launch Beatbox.vbs`; `mcp/src/launcher.ts`, `runtime-health.ts`,
`runtime-inspection.ts`, `runtime-logs.ts`, `p25.test.ts`;
`mcp/studio/src/System.tsx`; `mcp/system-selftest.mjs`,
`system-live-selftest.mjs`, `watch-windows.ps1`; this report, P2.5 screenshots and
separate runtime/audio evidence JSON files.

Modified: `application.ts`, `commands.ts`, `dashboard.ts`, `engine.ts`, `meter.ts`,
`proc.ts`, `runtime-client.ts`, `runtime-control.ts`, `runtime.ts`, `sclang.ts`,
`server.ts`; Studio `App.tsx`, `main.tsx`, `style.css`; `vite.config.ts`,
`package.json`, `run-tests.mjs`; P2 self-test failure diagnostics; `.gitignore`,
README and CONTRIBUTING. The followup adds `recording-diagnostics.ts`,
`recording-live-selftest.mjs`, recording tests and evidence, and updates
`recordings.ts`, `studio-client.ts`, and Studio `Recordings.tsx`. No dependencies or lockfile changes. The original
ownership implementation, musical compiler/reducer and Preview/recording routing
are unchanged.

## P2.5 exit status

| Criterion | Status |
| --- | --- |
| Coherent `/system` health overview | Implemented; Chromium verified |
| Relevant owned processes/services represented | Verified against Windows inventory; helper trees disclosed |
| Owned versus external distinction | Verified; no external kill control |
| Required/dynamic ports and conflicts | Verified with real UDP/TCP listeners and actual legacy conflict |
| Combined bounded live logs | Verified; sources, pause/clear/diagnostics and child output |
| Safe lifecycle controls and deduplication | Automated and live verified |
| Restart audio | Live verified with restored nonzero music |
| Restart services | Live verified; persistent owner/HTTP intentionally retained |
| Recording-safe application Quit | Live verified; finalized nonzero WAV |
| Successful Quit removes every verified owned child | Windows PID and port checks passed |
| Unowned processes never silently killed | P0a regressions and actual conflict tests pass |
| Second launch reuses verified instance | Live verified; no duplicate audio children |
| Headless launch/restart/stop | Native window trace passes with zero console-show events |
| Explicit human console-flash check | **Passed: user confirmed real Windows acceptance on 2026-09-07** |
| Studio remains functional | Original and live browser journeys pass |
| Preview excluded from recording | Three repeated real simultaneous captures pass |
| MCP/frontend reconnect preserves music/recording | Real persistent-runtime test passes |
| P0a/P0b/P1/P2 automated baseline preserved | All 124 retained; 157 total pass |
| Previous live regressions | Pass on repeat; **one unexplained silent P2 take retained as caveat** |
| No P3 or runtime-ownership rewrite | Met |

A future small Windows tray client can call the same health/command APIs and open
Studio/System. It does not need to own the engine. Electron, packaging, unowned
process termination and durable orphan adoption remain outside this phase.
