# P3 — Composition & Performance

Implemented on Ubuntu, intentionally stacked on P2.6 commit
`be2e73011bccbb19b6a2203ed1aabcd4f14ea186`. The agreed scope is in
[TASK-3](../tasks/TASK-3.md). P2.6 remains **Level B — Ubuntu Runtime Safe**,
draft PR #4, unmerged, with **Windows revalidation pending**. This phase does not
claim cross-platform acceptance. P3.5, P4 and P5 are not included.

## Architecture

ProjectService remains the sole authored-document authority. Scene operations,
arrangement edits, automation, drafts and dependencies use the existing serialized
command queue, revision checks, bounded retry contract, recovery and undo history.
React and the classic dashboard consume disposable projections. MCP forwards to
the same persistent runtime. No additional audio owner or process-killing path
was introduced.

Scenes retain stable track-ID → clip-ID/null mappings and a separate order. New
scenes start intentionally silent. Duplication creates new clip and clip-lane IDs,
copies exact code/drafts and preserves dependency and immutable asset references.
Track-wide lanes remain intentionally shared across that track's visual clips.
The explicit clip selector can intentionally share an existing clip; ordinary
scene duplication does not. Tracks retain routes and identity across scene order,
track order, save/reopen and history. Delete removes arrangement references;
Undo restores them together. The final scene cannot be deleted.

Arrangement entry IDs are distinct from scene IDs and scene display order.
Existing `cycles` is presented as repeats: one repeat is one project cycle, with
`tempo.beatsPerCycle` beats. `arrangementLoop: false` authors a finite performance;
absent/true retains the original looping behavior. No runtime position is persisted.
Version-1 files remain readable; the new optional fields are rejected by older
strict P2.6 readers, so use P3 when reopening a project saved with P3 fields.

## Engine-owned timing

`performance.ts` builds a prepared 16-slot Tidal action. `BootTidal.hs` prepares
patterns, then uses Tidal 1.10's existing play-map MVar to replace the slots in one
exception-safe swap. Every track, including silence, uses the same engine clock
value and `jumpIn' 0` cycle transition. An explicitly immediate launch is also
available through the structured API. Preparation crossing the selected boundary
fails instead of claiming an on-time installation. The acknowledgement includes
the actual scheduled cycle; a missing acknowledgement is an error.

The implementation follows the primary Tidal 1.10 sources:
[stream update and validation](https://github.com/tidalcycles/Tidal/blob/v1.10.0/src/Sound/Tidal/Stream/Process.hs),
[play-map types](https://github.com/tidalcycles/Tidal/blob/v1.10.0/src/Sound/Tidal/Stream/Types.hs),
[cycle transitions](https://github.com/tidalcycles/Tidal/blob/v1.10.0/src/Sound/Tidal/Transition.hs),
and [engine clock API](https://github.com/tidalcycles/Tidal/blob/v1.10.0/src/Sound/Tidal/Stream/UI.hs).
Tidal's slot ID, pattern-time query control and independent SC mixer routing are
retained. Completed transition history is compacted at subsequent launches.
Tidal boot explicitly verifies the helper and clock binding before reporting ready.

The existing whole-arrangement compiler emits `slow`/`timeCat` patterns. P3 anchors
these at the scheduled start cycle and adds an engine-side finite-end gate where
looping is disabled. Silent sections and tempo changes remain cycle-based. No
browser, MCP client or Node timer advances entries or launches the next scene.
A runtime timer only reads `getnow`; removing that observer affects display,
not the installed musical sequence. Clock loss is reported as unconfirmed position.
Clock observations refer to Tidal scheduling time, not measured acoustic output.

Current/queued scene and arrangement position are runtime observations, separate
from the scene selected for editing. Repeated scene-launch clicks are idempotent
at the same project revision; an explicit Repeat can retrigger. Opening a project
hushes managed playback and clears the queued performance, and reopens stopped.
Stop/quit clears observers; late observations cannot revive an old project.
Restart re-prepares the launched material at a new cycle boundary, preserving
subsequent live mix/tempo settings; it does not promise phase continuity.

**Deliberate editing boundary:** a performance retains its launched composition
snapshot. Composition edits are authored and recoverable; relaunch a section or
arrangement to hear them. Channel mixer and tempo changes remain live. Studio
shows that a newer revision exists. This prevents editing another section from
silently rewriting a queued transition. Removing performing scenes/tracks/routes
requires Stop first. In ordinary editing playback, existing live rhythm/motion
editing remains supported. These are explicit product limits, not hidden scheduling.

Preparation forces representative pattern queries and checks every active managed
code expression before replacement. It cannot prove all future queries of arbitrary
Haskell safe. Later Tidal/SC faults remain subject to P0a's visible uncertainty and
quarantine contract. Mixer/tempo work and interpreter actions are not one distributed
transaction: partial failure reports unconfirmed application and retains the authored
project/previous patterns where possible. It never claims universal atomic rollback.

## Automation and code

Automation remains canonical authored lanes targeting track ID, optional clip ID,
and semantic parameter name. Studio adds Rise, Fall and Swell stepped-value presets,
cycle duration, enable/disable, scope and curve display. Existing track-wide lanes
are visible; enabled clip-specific lanes explicitly override them. Duplicate targets
at the same scope are rejected. Parameters edited under automation retain their
stored base values. The compiler now removes the overridden base gain rather than
multiplying base gain and automation twice; pad velocity remains multiplicative.
Disabling the lane restores the base projection. Save/reopen and Undo/Redo retain it.
This is the existing bounded parameter set, not Sound Lab modulation or an FX rack.

Studio can add a managed code instrument, preserve/edit exact source as a saved
draft, and explicitly prepare/apply it. Failed drafts persist alongside the last
working source. In a running performance, prepared authored code is heard on the
next explicit scene relaunch, consistent with other composition edits. Channel
mixing never rewrites code. Dependency selection is available in Studio; declaration
creation uses the existing structured `dependencies.set` API. Retained declaration
source is never executed automatically. Arbitrary code is not reverse-engineered.

Raw SC, untracked Tidal/set imports and raw mutation during performance mark the session
**Externally modified**. Authored edits are retained without automatic reconciliation
into external playback. Launch/resume and project switching are refused until an
explicit Return to managed project. That action finalizes an active recording before
rebooting the owned audio engine, clearing unknown interpreter/SC state, and restoring
managed playback. An explicit Reset/Restart also clears external-state uncertainty after the owned
engine has actually rebooted, retaining the previous stopped/playing contract.
Recognized top-level d-slot/tempo operations, including tracked `do` batches, outside performance retain
the legacy bounded tracking contract; they are not arbitrary-code introspection.

## Studio, accessibility and MCP

The section strip exposes editing/current/queued state as text, intentional silence,
and keyboard-operable Launch buttons. Scene creation, duplication, names, reorder,
clip mapping and deletion use native controls. Arrangement cards offer explicit
move buttons, repeats, removal and looping; no operation requires dragging.
Performance presentation keeps transport/recording, scenes, arrangement and mixer
while hiding editing chrome. Existing design tokens, typography and focus styles
remain. Motion uses accessible labels and native controls. Managed code is a
contextual disclosure, alongside the existing generated-code view.

`project_status` provides scenes, arrangement, automation and performance observations.
`project_edit` exposes all new domain edits as one labelled transaction. Added tools:
`scene_launch`, `arrangement_start`, `arrangement_stop`, `managed_code_apply`,
`performance_return`. All target music through project ID/revision protection.
The classic dashboard reads these same documents and displays external/performance
state; its former browser song-advancement function remains a no-op.

Scenes/arrangements only depend on track/clip identity. Existing synth assets and
managed code are supported by those identities without assuming sample-library
membership. Semantic automation targets remain independent of React paths. Source
parameters, channel mixing and output/recording routing stay separate. No new
instrument kinds, DSP modules, mic input, modular FX, macros or generative features
were introduced.

## Validation and exit status

Baseline: 177 discovered, 174 passed, three Windows-only skips; build, both typechecks,
classic/Studio/P2/System browser journeys and the Linux Node runtime harness passed.

P3 adds 27 tests: domain independence/reference safety/history; exact boundaries;
multi-track batches and missing acknowledgements; repeat deduplication; stale project
rejection; obsolete queues; finite/looped/silent arrangements; observations with no
clients; tempo changes; snapshot edits; restart mix/tempo; canonical automation
restoration/collision/history; code failures/dependencies/recovery; external state;
and extensibility to existing synth sources. Full totals are recorded in
[p3-validation.json](p3-validation.json).

The new real Chromium journey uses actual HTTP/application/storage/MCP adapters with
a deterministic fake interpreter and explicitly advanced cycles. It exercises
Groove → duplicate Lift → edit → queue → Drop → arrangement/repeats/order → motion →
performance view → close all clients → observe positions → reconnect Studio/MCP →
legacy sync/Undo → managed draft rejection/correction/dependencies → save/reopen
stopped. Three widths and keyboard launch are checked. Screenshots are separate P3
artifacts; historical Windows acceptance screenshots are preserved.

Review fixes include project-switch cancellation versus deletion guards, overridden
base gain, missing scheduling acknowledgements, failed clock observations, preserved
restart mix/tempo, raw mutation during performance, native boot helper verification,
repeat-input stale-revision capture, and a newline separating preserved managed
code from generated routing so trailing line comments cannot swallow the suffix.
Review of the retained P0a native harness also corrected overly strict classification
of tracked `do` batches and explicit Reset restoration after external work. Retained Studio/P2 and recording-ordering
harnesses now explicitly Play after verifying the new reopen-stopped contract;
recording, non-silence, reconnect, Pause and cleanup assertions remain intact.

| Exit criterion | Status |
| --- | --- |
| First-class stable scenes, independent duplication, ordering, safe deletion | Implemented; domain/history/browser validated |
| Perform scenes, queue defined boundaries, engine owns timing | Implemented; deterministic protocol/compiler fixtures validated; native timing pending |
| Stable arrangements, repeat/loop/silence, no frontend scheduling | Implemented; domain/compiler and zero-client observation contract validated |
| Canonical persistent reversible automation | Implemented for existing visual parameters; tests/browser validated |
| Dependable managed source/drafts/dependencies | Implemented; fake compiler failure and persistence validated; native compiler/audio pending |
| Honest external mutation state and explicit managed return | Implemented; application/browser validated |
| Save/reopen complete composition stopped | Implemented; recovery/domain/browser validated |
| Studio/MCP/classic synchronization | Actual adapters validated with deterministic engine |
| Preserve prior guarantees | Portable suite and browser/runtime regressions; native Windows revalidation pending |
| Extensibility without P3.5/P4/P5 implementation | Reviewed; no new future-phase systems |

Ubuntu validation is portable development and deterministic engine-contract validation
on the P2.6 Level B runtime base. **Native Linux Tidal/GHCi/SuperCollider audio was not
run**, and the new Haskell helper has not been executed in a native interpreter here.
Thus acoustic timing, real scene/arrangement playback, Preview isolation during P3,
and P3 recording/audio acceptance are **not validated**. No system packages, audio
services or pending kernel/package state were modified. Windows desktop/audio/flash
acceptance for both P2.6 and subsequent shared P3 changes remains pending.

The implementation is reviewable with portable checks; **full native P3 acceptance
is not complete**, and nothing is approved for merging to main by this report.

## Files

Added: `tasks/TASK-3.md`, `mcp/src/performance.ts`, `mcp/src/p3.test.ts`,
`mcp/studio/src/Composition.tsx`, `mcp/p3-selftest.mjs`, this report,
`docs/p3-validation.json`, three `docs/p3-composition-*.png` screenshots and
`docs/p3-performance-1440.png`.

Modified: `mcp/src/project.ts`, `project-compiler.ts`, `application.ts`,
`commands.ts`, `server.ts`, `tidal.ts`, `track.ts`, `studio-client.ts`, `mcp.test.ts`;
`tidal/BootTidal.hs`; Studio `App.tsx`/`style.css`; `mcp/dashboard-project.js`;
`mcp/package.json`, `run-tests.mjs`, `studio-selftest.mjs`, `p2-selftest.mjs`,
`recording-live-selftest.mjs`; CI; README, CONTRIBUTING and HANDOFF.

P2.6's task/acceptance reports, native Windows/Linux ownership implementations,
package lockfile, SC startup, recorder routing and historical evidence are unchanged.
