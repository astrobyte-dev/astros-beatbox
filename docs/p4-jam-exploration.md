# P4 — Jam & Exploration

P4 implementation and available Ubuntu validation are complete. **Native audio,
timing, CPU and musical-quality acceptance are not complete.** P5 was not started.

Development branch: `feat/p4-jam-exploration`, intentionally based on exact
`63d99d0f61fc62f1430db8abebb60f540f90b164` and targeting
`feat/p3.5b-capture-sampling`. Lower draft PRs remain unmerged. Delivery commit and
draft PR are identified in the delivery reply and Git history.

## Baseline and platform

Before edits, verified Ubuntu 24.04.4 LTS x86_64, the requested branch and exact
commit, a clean tree, and fetched origin. Reviewed P0a–P3.5B architecture/reports,
ProjectService/storage/compiler, command/retry/revision boundaries, scenes and
prepared performances, automation, Sound Lab sources/presets/FX/modulation,
sampling/capture/library, Studio gestures/design tokens, MCP and runtime ownership.

Baseline: **301 passed, 3 Windows-only skips, 304 discovered**; build and both
typechecks passed. Classic, Studio, P2, P3, P3.5A, P3.5B and System browser journeys
and the Linux runtime/lifecycle harness passed before implementation. That initial
shell used Node 22.22.2. Final validation explicitly uses the repository's installed
**Node 24.14.0 / npm 11.9.0**. No system, kernel or audio packages were modified.

## One canonical Jam path

Jam is a focused Studio view, not another project format or playback authority.
`jam-model.ts` is browser-safe capability/schema metadata using the existing
Sound Lab definitions. `jam.ts` is the server-side deterministic transformation
engine. `Application.executeJam` uses the existing serialized command queue,
project/session/revision checks, retry cache and `changeProject` acknowledgement
and durability contract. React holds input drafts, selected scope/intensity and
panel preferences; it never commits a local musical document.

Jam entry/exit changes presentation only. Header Play/Pause, recording, Undo/Redo,
Save and System remain accessible. The quick starts author a small groove in an
empty project and then request Play through the normal runtime. Groove adds the
existing Reese instrument and a reverb to the existing pocket starter; Minimal
keeps two percussion instruments; Surprise varies the starter rhythm. Existing
music is never overwritten by a starter. Continue Current uses ordinary Play.

Prepared P3 scene/arrangement performances deliberately retain their established
snapshot semantics. Jam transformations reject while such a performance is active;
Studio provides **Play active instruments** to return explicitly. No Jam command
reboots/kills services. Jam scene buttons use canonical scene activation; P3's
quantized scene-launch interface remains available in Studio.

## Variations, constraints and musical heuristics

`jam.variation` receives an explicit uint32 seed, algorithm version 1, selected
track IDs, scope, intensity and operation. Repeatability is against the same source
document and stable identities. A per-track seeded stream makes display reordering
irrelevant to the resulting notes/rhythm. No `Math.random` or browser-side generation
is used. Browser cryptographic entropy only supplies a request seed.

The default surface changes one semantic scope at a time. MCP can request multiple
scopes. Unsupported unlocked combinations reject the entire transaction before
publication. Kept tracks may remain in heterogeneous selections. Scope means:

| Keep level | Protected from generation |
| --- | --- |
| Track | All supported Jam transformations and moving macro contributions |
| Rhythm | Pad placement, rests, velocity/accent and existing swing |
| Sound | Synth source/base controls, notes/octave, sample pitch/playback and chop assignments |
| FX | Effect instances/values and motion targeting those FX |
| Motion | Existing modulation routes and their amounts |
| Named parameter | Its semantic value, modulation change and macro contribution; available in structured commands |

Locks are project-authored, revision checked, undoable and persisted. Explicit
Studio edits, Undo and returning to an idea remain intentional restoration/editing
actions, not generators; they can restore different constraints. A/B explains that
it restores the chosen idea's locks too.

When locking an already affected macro target, the server retains its current
normalized contribution in the lock's `offsets`. Subsequent macro moves/reset
leave that held sound intact. Unlocking releases it to the current macro settings.
These offsets belong to the separate macro layer, never source/FX base values.
Old/neutral locks have zero contribution. FX/source removal prunes dependent lock
parameters/offsets and mappings in the same Undo; Undo restores them.

Small change / Fresh / Wild control mutation count and travel (8% / 20% / 40%
internally). A subtle 16-pad rhythm changes at most one non-anchor pad. Rhythms
retain their first active hit, preserve deliberate silence, bound additions to a
useful density, prefer restrained offbeat velocities and avoid removing every hit.
An already dense authored pattern is not forcibly normalized. Build adds a few
quiet hits; Strip Back removes offbeats while retaining the anchor. Fill adds hits
only in the final quarter. It is an authored action with one Undo, not a temporary
browser-timed fill.

Synth variation uses explicitly marked semantic controls and, above subtle,
optional ±12-note transposition preserving the existing pitch collection/register
when it fits MIDI bounds. Samples use small bounded pitch changes; trim/reverse,
loop duration/envelope and asset identity remain intact. Chops choose only existing
stable slice IDs on active pads. FX use supported normalized creative parameters;
motion varies existing enabled route amounts. Boundary moves turn inward instead
of claiming that removing a preset label alone changed the sound.

Chaos deliberately shares this constrained engine. Its intensity and scope are the
same visible controls; it never expands its authority to locked tracks, code, files,
master output, feedback beyond existing bounds, or runtime services.

Code tracks are opaque and offer no generated transformations. Unavailable source
and FX definitions expose no executable Jam targets. Existing unknown-definition
mappings survive save/reopen losslessly and remain inactive. Captured samples,
ordinary samples, phrase loops, chops and synths have explicit capability labels.
Legacy synth assets with visual rhythm can change that rhythm, but do not acquire
guessed sample-pitch capabilities.

## Ideas, comparison, Keep and scenes

`ExplorationTrail` sits alongside the existing ProjectService snapshot/history
infrastructure. It stores inert validated document snapshots, never an independently
playing current project. Readback sends labels, source revisions, parent IDs,
kept/current markers and summaries, not another set of full documents.

The trail is capped at twelve alternatives and approximately 16 MiB serialized
JSON, in addition to the existing bounded ordinary Undo history. Original is
retained for the session. Up to six additional favorites share a 7 MiB budget,
reserving room for Original/current. Capacity refusal explains that the user should
save or promote; kept alternatives are not silently evicted. Non-kept intermediates
can age out. Parent links to expired intermediates are informational.

A/B and Return submit the selected snapshot through the normal canonical transaction
path. Each is undoable; return-and-vary creates a branch with a parent reference.
Comparing after a macro/manual edit preserves that exact pre-compare state in the
trail so B can return to it. Full project state is restored, including scene edits,
locks and macro mappings; it is not a hidden audio audition layer. Significant
actions show changed/kept names, with seed/revision/algorithm details expandable.
The summary is hidden when a later unrelated revision makes it stale.

Keep This marks the current idea in the runtime session. Studio explicitly asks
users to Save jam for disk retention, or Save as Scene for reusable clips. Closing
a browser/MCP connection retains the runtime trail; project open/new/recovery or
runtime restart clears transient alternatives. The project itself and its current
kept result use normal save/recovery.

Promotion duplicates active clips and clip-scoped automation with stable new IDs
in one authored Undo. Intentional silence is retained and the original scene is
unchanged. **P3 instruments, FX, mixer, modulation and macros remain shared across
scenes.** The UI calls this out: promotion preserves independent clips, not an
independent per-scene instrument/FX patch. Full sound alternatives can be retained
in the session trail or saved as complete projects.

## Musical verbs and macros

Curated recipes: Get Dirtier, Add Space, Open Up, Go Darker, Add Movement, Strip
Back and Build. Each has a scope explanation, capability-based target selection,
lock checks, normalized bounds and one meaningful history entry. Unsupported
verbs are absent; completely protected targets cannot be transformed.

Sound Lab's existing `meaning` is the semantic identity. A small signed `jam`
travel field extends that same parameter metadata. For example, drive increases
for dirt while bit resolution decreases. Only eligible effect parameters from
the existing automation-safe set participate; delay time and other unsupported
rate/frequency controls are not invented as Jam destinations.

Suggested Dirt, Space, Movement and Brightness macros appear only when useful.
At most eight project macros each map up to 128 stable track/semantic parameter
identities. Custom software assignment selects a small set of available controls;
there is no hardware/MIDI learn. Reordering FX cannot break mappings. Bypassing an
FX retains the mapping and suspends its contribution; removing it prunes the
mapping and Undo restores it. Unknown versions remain dormant and retained.

Native normalized composition is:

`clamp(automation-or-base + modulation signal × amount + macro offset, 0, 1)`

The macro sum is bounded to [-1, 1]; each mapping's travel is at most 0.5. Existing
semantic-to-DSP mappings and output/feedback limits remain in force. Automation's
base selector and authorization tokens remain separate, as do modulation sources,
rates and amounts. No macro writes either layer's authored arrays or base values.
Zero/disable restores the underlying sound for free targets. Held lock offsets
remain until unlocking, as shown in Studio.

The initial macro gesture contract follows Studio's existing guarded Range:
release a pointer/keyboard gesture to commit one revision and one Undo. HTTP does
not receive per-frame values. Persistent inserts smooth their new offsets with
20 ms native lag. Synth offsets travel with new note events; existing sustained
voices are not retrospectively retuned. Group IDs support bounded software gesture
grouping. No additional modulation nodes or unbounded native resources are created.
These limits are disclosed, rather than claiming continuous audition while dragging.

## Event notebook, bench and suggestions

Performance capture is a bounded **event notebook**, separate from audio Rec and
microphone capture. Up to 128 successfully acknowledged scene, macro, variation,
verb and selected mixer-edit intentions are retained in order. Scheduled scene
launches retain the engine-confirmed cycle; other gestures are explicitly untimed.
Failed commands/retries do not fabricate duplicate events. Capture stops at its
cap or generation/lifecycle change. It is session state until Keep Performance,
which persists one take as one Undo; at most eight takes belong to a project.
Opening another project clears the transient take. There is no automatic replay,
arrangement conversion, full gesture recorder or claim of deterministic timing for
untimed events. Saved takes are inspectable event records, not executable logs.

Your Bench pins instrument links in one bounded browser preference (32 IDs), with
keyboard-accessible star toggles. It never stores musical values. Scope, intensity,
comparison selection and open panels remain workspace state. A dismissible,
deterministic suggestion identifies an eligible track and scope; no LLM, network
service, engagement timer, points, streaks or notification mechanics are present.

A broad Make Something Happen button and transient stutter/drop/filter events are
omitted: they would require a new, properly acknowledged engine event lifecycle
and native timing acceptance. The implemented Fill/Build/Strip actions are explicit
canonical transformations; audio recording captures the resulting jam normally.

## Studio, accessibility and visual review

Reviewed the actual rendered start screen and Jam at 1280, 1440 and 1920 pixels.
The first render put Make Variation below too many tracks; it was moved into the
top action area and track cards made compact. Fixed pressed-hover contrast,
centered idea rows, an inherited inline layout on starter cards, stale compare
return selection, and made inactive/kept macro controls visibly unavailable.
Event notebook details are folded by default to reduce clutter. No horizontal
page overflow or browser errors were observed.

The surface uses established paper, ink, blue and track-color tokens, with a single
static play stamp. Lock states use words/icons and semantic toggles, not color alone.
All buttons, native range controls, history, custom assignments and bench links are
keyboard accessible. Existing immutable gesture bases reject stale edits. No drag
operation lacks a keyboard alternative. Reduced-motion behavior is verified.
A/B, Undo and current scene are explicit; deeper editing remains one click away.
The interface now presents an obvious thing to try and makes preserved parts legible.
This is visual/interaction review, **not acoustic or human musical-quality acceptance**.

Screenshots: [Start](p4-start-1440.png), [Jam 1280](p4-jam-1280.png),
[Jam 1440](p4-jam-1440.png), [Jam 1920](p4-jam-1920.png). Historical milestone
screenshots regenerated by regressions were restored to retain their original evidence.

## MCP, validation and review

MCP adds `jam_inspect`, `jam_variation`, `jam_lock`, `jam_verb`, `jam_macro_assign`,
`jam_macro_value`, `jam_macros_suggest`, `jam_macros_reset`, `jam_return`, `jam_keep`,
`jam_promote`, `jam_capture_start`, `jam_capture_stop`, `jam_capture_keep`.
All writes use the same command authority and external project/revision/session
contract as Studio. Readback includes capabilities, verbs and bounded trail metadata.
Existing tool families remain asserted in the inventory test.

Final full suite: **377 discovered, 374 passed, 3 Windows-only skips, zero failures**.
The 73 new P4 tests cover seeded repeatability/order independence; scope/intensity;
track/rhythm/sound/FX/parameter locks and held offsets; silence/density/anchors;
source capabilities and unavailable definitions; sample/chop identity and unchanged
original/managed WAV bytes; semantic recipes/summaries/bounds; macro targets,
automation/modulation/authorization coexistence, reset/disable/reorder/removal/Undo;
scene/arrangement projection and promotion; trail entry/byte/favorite bounds,
Original retention, compare/return/branch; persistence/recovery; retries/stale writes;
engine failure; gesture grouping; prepared-performance rejection; and bounded,
explicitly untimed event capture. No existing tests were removed or relaxed.

Production build and both server/Studio typechecks: **PASS**. Browser journeys:
**PASS** for classic, Studio, P2, P3, P3.5A, P3.5B, System and P4. Linux runtime
harness: **PASS**, including native Node cold/second launch, session reuse,
Studio/System, OS inventory, Stop/Quit, signals, owner/port cleanup and unrelated
owner protection. P4 browser covers real UI/HTTP/storage/MCP with fixture audio:
quick start/play → Keep Kick/Bass → intensity → variation → A/B → return/branch →
Get Dirtier → Space macro → stale gesture rejection → event capture/Keep → Keep This →
Drop scene → switch scenes → bench → enter/exit → MCP sync/reconnect → save/reopen
stopped → replay; three widths and reduced motion. The final numeric boundary
fix was followed by another full suite, both typechecks and P4 browser run.

Reviewed the entire diff and searched new production Jam modules for browser
randomness authority, AudioContext/getUserMedia, timers, source-file writes/deletes,
process lifecycle calls, macro writes to automation/modulation and unbounded trails.
None were introduced. All file operations in Jam regression tests are isolated
fixtures; production Jam has no filesystem mutation API. Existing ProjectStorage
handles authored durability. Generation/revision rejection and rollback reporting
remain unchanged. No dependency or native/system package installation was needed.

## Acceptance gates and exact exit criteria

| P4 implementation exit criterion | Result |
| --- | --- |
| Jam Mode exists | Complete: focused canonical Studio presentation |
| Safely create variations | Complete: validated seeded engine and one-intention commits |
| Keep/Change respected | Complete: whole track and semantic scope protection |
| Clear reliable locks | Complete: persisted constraints, held macro offsets, tests |
| Variation intensity | Complete: Small change / Fresh / Wild |
| Compare/revisit alternatives | Complete: bounded canonical snapshot trail and A/B |
| Keep/promote good results | Complete: session favorites, normal saves, independent clip scenes |
| Curated musical verbs | Complete: seven supported recipes with summaries |
| Performance macros | Complete within release-to-commit/new-note gesture scope |
| Automation/modulation coexistence | Complete: separate bounded native offset layer |
| Canonical/reversible Jam transformations | Complete: shared revision/history/storage contracts |
| Explicit source capabilities | Complete: sample/synth/loop/chop/capture/FX/code limits |
| Jam remains one canonical project view | Complete: no browser player or second current document |
| Studio/MCP synchronized | Complete: real MCP/browser read/write/reconnect journey |
| P0a–P3.5B not intentionally regressed | Portable suite and prior browser/runtime journeys pass |
| P5 not started | Confirmed; no packaging or lower-PR merges |
| Native audio/musical quality accepted | **No — pending physical/native validation** |

All inherited gates remain open:

- **P2.6:** Windows desktop/audio validation pending.
- **P3:** native audio/timing and Windows validation pending.
- **P3.5A:** native audio/timing/CPU and Windows validation pending.
- **P3.5B:** native microphone/audio and Windows validation pending.
- **P4:** native audible variation quality, macro layering/smoothing/held locks,
  sustained-voice behavior, FX tails, scene timing, headroom/CPU and real musical
  usability; plus Windows desktop/runtime/audio regression acceptance pending.

Ubuntu remains **Level B — Runtime Safe**. No native Linux microphone/audio or
Windows machine was available. Deterministic fixtures and CI do not close these gates.

## Files changed

- New domain/validation: `mcp/src/jam-model.ts`, `jam.ts`, `jam.test.ts`.
- Canonical integration: `project.ts`, `project-service.ts`, `application.ts`,
  `commands.ts`, `studio-client.ts`, `server.ts`.
- Sound Lab/compiler: `sound-lab.ts`, `sound-lab-engine.ts`, `project-compiler.ts`.
- Studio: new `mcp/studio/src/Jam.tsx`; `App.tsx`, `style.css`.
- Tests/CI: new `mcp/p4-selftest.mjs`; `mcp/src/mcp.test.ts`, `mcp/run-tests.mjs`,
  `mcp/package.json`, `.github/workflows/ci.yml`.
- Documentation: this report, `docs/p4-validation.json`, four P4 screenshots,
  `tasks/TASK-4.md`, `README.md`, `CONTRIBUTING.md`, `HANDOFF.md`.
