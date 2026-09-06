# P0b — One recoverable musical project

Implemented against clean P0a commit `c03c545`. Baseline: 75 tests passed with no
skips; build and typecheck passed. This work retains the vanilla dashboard, MCP
stdio launch and Tidal/SuperDirt engine. It contains no React, Vite, visual redesign,
starter experience or P1–P5 work.

## Ownership and boundaries

| Boundary | Responsibility |
| --- | --- |
| `project.ts` | Versioned document schema, referential validation, deterministic edit reducer |
| `project-compiler.ts` | Structured clips/automation/arrangement to Tidal; channel controls to SC |
| `project-service.ts` | Authoritative document, monotonic revisions, bounded history, workspace and asset observations |
| `project-storage.ts` | Validated complete project files and durable alternating checkpoints |
| `application.ts` | One P0a command queue for HTTP/MCP, revision checks, acknowledgements, engine application and rollback attempts |
| `server.ts`, `dashboard.ts` | MCP/HTTP adapters, both using `dispatchExternal` |
| Dashboard modules | Disposable document projections and short-lived gesture drafts |
| Existing engine/protocol/process modules | Readiness, generations, interpreter framing and owned-process lifecycle |

`ProjectDocument` is authored music. `workspace` holds the selected scene and
recovery metadata. Browser console text, panel visibility and pointer drafts remain
editing context, not musical authority. `projectRuntime` reports applied project,
revision/generation, queued commands, arrangement playback mode and application
errors. Existing transport/recording/engine health remain runtime state. Meters,
clock, waveforms and spectrum remain separate telemetry and never enter the document.

The old `rig.slots`, tempo and mute/solo fields are compatibility projections of the
project. Legacy raw commands still pass through the P0a acknowledged execution path,
then update the project as opaque code clips. They cannot update musical history
before acknowledgement. General REPL execution is not treated as musical introspection.

## Document schema, version 1

- Project ID, monotonic revision, name, schema version, BPM and beats per cycle.
- Ordered tracks with stable IDs, stable d-slot assignments, channel assignments,
  active clip IDs, names and independent mixer level/balance/mute/solo.
- Stable clips: visual steps with per-step velocity, asset ID, swing and instrument
  parameters; or opaque code expressions with a managed-routing flag and dependency IDs.
- Stable scenes containing **track ID → clip ID** references; separate scene order.
- Arrangement entries with stable IDs, scene references and cycle durations.
- Immutable asset identities with sample/synth/file references and sample indices.
- Automation lanes referencing track and optional clip IDs, parameter, values,
  cycle duration and enable state. A clip-specific lane overrides a track-wide
  lane for the same parameter. Musical gain automation multiplies pad velocity.
- Explicit Tidal/SC/sample-library dependency declarations, including retained source.
- Verbatim imported `.tidal` source artifacts.

All objects are validated, including unique identities, ownership, routes, reference
integrity, numeric limits and scene-order permutations. There is at least one scene.
Reordering changes the track array only. Deletion removes dependent clip, scene and
automation references; undo restores them together. Asset replacement creates a new
asset identity and changes the chosen clip reference, not every use of an old asset.

The current bounds are 16 slots, 12 managed stereo channels, 1,024 clips, 128 scenes,
512 arrangement entries, 2,048 assets/lanes, and 4 MiB of compact document JSON.
Snapshot history is suitable for this bounded local document; incremental event
sourcing was unnecessary for this phase.

## Editing API and synchronization

`project_edit` accepts `projectId`, expected `revision`, an `edits` array, a `label`,
and optional `groupId`. HTTP uses the same fields with `cmd: "project.edit"`.
`editSchema` in `project.ts` is the complete machine-readable edit API. It supports
track add/delete/order/rename, clip put/delete/activate, steps/sound/swing/parameters,
mixing, assets, scenes, arrangement, automation, tempo, project name and dependencies.

`project_status`, `project_undo`, `project_redo`, `project_save`, `project_load`,
`project_new` and `project_recover` supplement the original MCP tools. Raw musical
commands also require project identity/revision through external adapters. Read
`status.project` first. Runtime-only boot/Stop/record/reset do not require a musical
revision. Existing operation ID/session/time retry metadata still applies.

Revisions are checked **inside** the application queue. Opening a project resets
history and advances the revision even when reopening the same project ID. Retries
return the original bounded result; they neither reapply edits nor create history.
Full documents are read through status rather than retained in every retry result.

The browser queues commands and may advance expected revisions only across its own
acknowledged commands. It does not silently rebase across external edits or project
loads. Pointer drafts retain their starting project/revision. Stale drafts fail and
the UI refreshes from the server. Scene snapshots and automation are no longer
browser-owned. Browser song advancement was removed: the compiler creates the whole
arrangement with explicit cycle lengths, so closing a tab cannot stop scene chaining.

## Visual/code boundary and compatibility

Visual rhythm edits change velocities/steps; sound edits change an asset reference;
effect controls change structured parameters. The compiler emits Tidal from those
fields. No visual or mixer mutation path calls `applyParam`, `stripParam`, or any
other code-rewriting regex. The old `applyParam` export remains solely for the
preserved P0a helper test and is not used by the application.

Managed code clips contain an opaque **pattern expression**. Routing is an outer
projection; the stored source is unchanged by mixing or unrelated edits. Creating
these clips is available through the project API without introducing P3 code UI.
Arbitrary console/MCP Tidal remains executable. Only explicit top-level d-slot
assignments and numeric tempo commands are tracked; nested/quoted semicolons are
preserved. Other interpreter actions and declarations remain runtime-only.

Raw code cannot be reverse-engineered losslessly. Its rhythm/effect controls are
disabled rather than rewriting its expression. It retains code playback and
legacy Tidal mute/solo. Raw code can explicitly bypass routing, affect other slots,
or depend on interpreter definitions; those actions cannot be made transactional
or fully introspected. Dependencies are retained, not automatically executed.

The dashboard keeps its existing panels and controls. Added controls are complete
project save/open/new, undo/redo and project/missing-asset status. The grid retains
painting, velocity scrolling, sound replacement, reorder, clear, scenes and song
chain. New visual rows start empty. Existing surprise/snippet/console workflows
still generate raw code; they are not silently converted into visual tracks.

`.tidal` import/export remains the existing source/set workflow, separate from
complete saves. Imported source is also retained verbatim in the document. The
legacy importer executes non-comment lines and cannot import every possible
multiline Haskell program; use the console for those. Failed imports retain the
previous project and attempt playback restoration as in P0a.

## Independent mixing and routing

Capacity stays at the existing **12 SuperDirt orbits**. Managed d1–d12 tracks use
their existing orbit (`slot - 1`); tracks keep this route when reordered. All clips
and scene references on a track share that route. No orbit is allocated per clip
or per pattern. Raw d13–d16 remain available without promising managed channels.

At engine boot, each orbit's existing monitor output goes to a dedicated stereo
bus. A persistent `abxChannel` Synth reads it, applies a 20 ms-smoothed level and
linear stereo balance, and feeds hardware output 0/1. These channel nodes execute
after the Dirt output nodes and before the existing master limiter/meter/recorder.
The existing Dirt dry/effect chain and synth definitions are retained. Rebuilding
the scope's orbit effects does not replace the channel nodes.

Balance leaves both channels at unity in the centre and attenuates the opposite
side towards either extreme; it does not collapse stereo to mono. Mute and solo
compute channel level zero. Sustained voices and effect output therefore respond
without rescheduling Tidal or rewriting musical gain/pan. The scope remains an
orbit observation before the final channel stage; it is not a calibrated post-fader
meter. The master meters observe the final mix.

Routing was checked against the installed `DirtOrbit.sc`, `GlobalDirtEffect.sc` and
`core-synths-global.scd`, not inferred from slot count. Relevant primary references:
[SuperDirt](https://github.com/musikinformatik/SuperDirt),
[SuperCollider buses](https://doc.sccode.org/Tutorials/Getting-Started/11-Busses.html),
[Tidal concatenation](https://userbase.tidalcycles.org/cat.html).

## History, persistence and recovery

History is bounded before/after snapshots: at most 64 intentions, also trimmed to
approximately 16 MiB (one large valid snapshot remains allowed). Consecutive changes
with the same gesture ID group for up to 30 seconds between updates. Painting and
curve drawing submit a batch at gesture completion; faders can apply live while
remaining one history unit. New edits after undo discard redo. MCP batches and UI
edits share this history. Stop, Play, audition, reset and recording do not add undo.

Complete projects use `projects/<name>.abx.json`:

```json
{
  "format": "astros-beatbox-project",
  "version": 1,
  "sequence": 0,
  "sha256": "checksum of validated document JSON",
  "document": { "schemaVersion": 1, "...": "complete authored project" }
}
```

Writes use a new sibling temporary file, file fsync, close, then rename. A failed
write is an error and does not commit the document or history. Loads validate the
complete candidate, references, version and checksum before touching the current
project. When audio is live, candidate application must also acknowledge before
the swap; on failure restoration is best effort and uncertainty remains visible.

Every musical commit, undo/redo and successful switch writes one of two alternating
checksummed `.abx-recovery/checkpoint-{0,1}.json` files, with increasing sequence.
There is no execution journal. Startup selects the newest valid checkpoint,
ignores orphan temporary files, and reports corruption/fallback. The recovered
document is loaded **stopped**, with no engine boot or automatic code execution.
`TIDAL_PROJECTS_DIR` and `TIDAL_RECOVERY_DIR` can override the storage directories.

Missing sample banks/indices remain in the document and appear in asset status.
Playback silences their managed clips to avoid SuperDirt's sample-index wrapping.
Synth availability is reported as unverified until runtime can establish it. File
references are retained but require an explicitly registered sample library;
unregistered file clips are silenced rather than playing a same-named built-in.

## Validation record — Windows, Node 24.14.0

- Full automated suite: **101 passed, zero failed/skipped**, including every P0a
  test. Discovery floor increased from 75 to 101.
- Typecheck, TypeScript build, dashboard JavaScript syntax and diff checks passed.
- New tests cover stable identity/reorder/reference integrity, deterministic edits,
  grouped undo/redo, redo branching, actual MCP+HTTP shared history, stale queued
  revisions, project switching, complete/inactive persistence, interrupted write
  stages, corrupt checkpoint fallback, recovery without playback, missing assets,
  schema/checksum validation, musical expression preservation, mixer commands and
  runtime failure truthfulness.
- Original live chain passed: final master peak **L+R 0.560**, L 0.281/R 0.279.
- P0a live regression passed: Stop/Play/source save/load/record/retries, actual
  compiler/runtime/late errors, timeout quarantine, retained-project Reset and audio
  server loss. Finalized WAV **389,676 bytes**, PCM peak **4,055**.
- P0b live regression passed: compiled event values and arrangement, one sustained
  stereo probe through Dirt's dry/monitor/channel path, volume, balance, mute/solo,
  isolation between two orbits, full save/reopen and undo/redo. Steady stereo was
  approximately **0.051/0.032**, quarter-level **0.012/0.007**, left-only
  **0.043/0.000**, right-only **0.000/0.031**. All audio tests released owned ports.
- Real Chromium validation passed against the real HTTP/project service with a
  fake audio engine: pointer painting, grouped fader drag, automation, scene A/B,
  track reorder preserving scene/automation references, undo/redo, save/new/reopen,
  stale pointer rejection after an external edit, Stop and no JavaScript errors.
  Screenshot: [existing dashboard](p0b-dashboard-validation.png). The in-app Browser
  was unavailable; local Playwright/Chromium was used.

Run `npm test`, `npm run typecheck`, `npm run build`, `npm run selftest`,
`npm run selftest:p0a`, `npm run selftest:p0b` and `npm run selftest:browser` in `mcp`.
Audio tests are opt-in and must run sequentially. Browser setup is documented in
`CONTRIBUTING.md`; its fake engine cannot establish acoustic correctness.

## Review fixes and remaining limits

Review caught and fixed cycle compression in arrangement concatenation, potential
sample-index substitution, raw-slot collisions in channel allocation, multiple solo
choices being lost after raw edits, delayed first-edit playback after Stop, unrelated
edits clearing runtime uncertainty, source semicolon splitting, beats-per-cycle
handling, full-project/large-payload retention in the retry cache, stale fader drafts,
rebasing across project loads, reopening the correct scene selection and mixer
controls hidden behind the fixed console. Engine boot now establishes the default
project tempo explicitly. The held-audio test explicitly wakes Dirt's normally
event-driven monitor before injecting its steady probe.

Not automatically validated: human listening quality, every physical output device,
hardware power loss/filesystem controller failure, OneDrive conflict resolution,
forced-host orphan process cleanup, or arbitrary user Haskell/SC side effects.
Fsync+rename and alternating checkpoints protect process interruption; they are not
a cross-machine storage transaction. Use one server/writer per recovery directory.
An unsent gesture or console draft can be lost on browser crash. History is in memory
and resets on reopen/recovery; authored state is durable. Custom asset registration,
dependency execution and advanced managed code UI remain explicit future work.

The source importer and raw slot recognizer remain intentionally bounded, not a
Haskell parser. The API supports more clip lengths/lanes than the legacy 16-pad,
single-lane editor exposes. Per-orbit scopes remain pre-fader. These are documented
compatibility limits; no new interface work was undertaken to conceal them.

## P0b exit criteria

| Criterion | Status and evidence |
| --- | --- |
| Rhythm, mixing, automation and project state agree | Met for managed editing; shared reducer/compiler and browser/runtime checks |
| Musical identity survives reorder | Met; stable IDs and scene/automation reference tests, Chromium drag test |
| Visual edits preserve unrelated expression | Met; structured edits, opaque code boundary, compiler tests |
| Mixer volume preserves velocity/dynamics | Met; independent persistent channel stage, unit and held-audio tests |
| Undo/redo spans UI and MCP | Met; one history service and actual MCP/HTTP test |
| Complete managed session saves and reopens | Met; versioned round trips including inactive clips/scenes and browser reopen |
| Interrupted state has safe recovery | Met for acknowledged authored edits; alternating fsynced checkpoints and recovery tests |
| Stale edits cannot target another/newer project | Met; external identity/revision checks inside queue, switch and browser draft tests |
| P0a command/process guarantees remain | Met; original automated tests and real P0a runtime regression passed |
| Remain within P0b | Met; existing dashboard retained; no P1 work |

## Files

Added: `project.ts`, `project-compiler.ts`, `project-service.ts`, `project-storage.ts`,
`project.test.ts`, `project-application.test.ts`, `p0b-selftest.ts` under `mcp/src`;
`mcp/dashboard-project.js`, `mcp/browser-selftest.mjs`, this report and the validation
screenshot. Modified: application/command/server/dashboard/config/engine/track
modules and their relevant existing tests; existing dashboard core/grid/curves/mixer
and HTML; package/lock/test-runner files; `.gitignore`, README and CONTRIBUTING.
The P0a protocol, interpreter drivers and process-ownership implementation were not
changed. The existing 12-orbit SC startup configuration was retained.
