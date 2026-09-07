# Product Finish: audit before implementation

Audited 2026-09-07 on Ubuntu 24.04.4 LTS, Node 24.14.0 / npm 11.9.0.
Branch `feat/p5-product-finish`, exact clean base
`0947f818d73d490d4e252182b0df47d716f4134a`; origin fetched before edits.

Baseline: 377 tests discovered, 374 passed, three Windows skips; production build
and both typechecks passed. Classic, Studio, P2, P3, Sound Lab, Sampling, Jam,
System and Linux lifecycle journeys passed. Native audio was not exercised.
Historical screenshots are preserved; fresh baseline images live in
[p5-before](p5-before/), including a [comparison sheet](p5-before/contact-sheet.png).
A temporary browser harness recorded an additional horizontal arrival/library/
dialog/Jam/degraded-state walk before production edits. Its initial selector typo was corrected before the audit finished.

Reviewed P0a–P4 reports and contracts, current React surfaces and shared controls,
canonical state/storage/client, runtime health/ownership/logs, sampling workers,
bounded histories, classic controls, CI and every existing browser harness.
Walked arrival → starter → Play → all seven collection entries → save dialog →
four widths → Jam variation → editing → injected audio failure. The baseline
journeys additionally exercise synth/FX/modulation, scene/arrangement, imported
waveforms/trim/chops, microphone fixtures/Keep/use, recording/reopen and System
conflict/dialog recovery. This is rendered interaction review, not human usability
research or audible musical acceptance.

| Priority | Current evidence / user impact | P5 decision |
| --- | --- | --- |
| 1 | First pad begins at y=839/832/786/786 at 1024/1280/1440/1920, height 800. Scene authoring appears before making a beat. | Put rhythms before composition in editing; keep composition first in Perform. Add direct Sound Lab and Scenes focus links. Compact the repeated introduction. |
| 1 | Project name is visible but disk-save state only appears in System. Opening a saved jam immediately replaces unsaved work and clears history. | Publish existing server save observation to Studio, retain actual saved filename, guard unsaved switches in a focused dialog. Preserve failed-save state and canonical revision checks. |
| 1 | Arrival has two copies of Pocket groove, then a separate Play step; no contextual invitation after start. | Add a primary Start Playing action using starter + acknowledged Play; retain explicit stopped starter. Offer Open Existing and Jam starts without a wizard. Remember dismissible contextual tips locally. |
| 1 | Audio errors direct people to Matrix; disconnected arrival offers classic instead of health. | Link actionable recovery to System and show technical detail on demand. Never claim atomic audio rollback. |
| 2 | Seven library entries each consume a full row; navigation changes shape only on Sounds. Capture's kept state has no next-action control. | Consistent compact grouped navigation; direct Capture → My Sounds and My Sounds → Capture. Preserve asset categories. |
| 2 | Sound Lab defaults samples to FX, labels them SAMPLE / CODE, and exposes Notes + Instrument even for an ordinary sample. | Default to Sample; clarify conversion to synth; unify context and channel/source explanations. Keep basic/advanced depth and existing DSP untouched. |
| 2 | Jam summary sits below every track and verb; "offsets" and "session trail is bounded" leak implementation vocabulary. | Move changed/kept summary beside variation action, explain session retention and shared scene instruments in ordinary language. |
| 2 | Only Undo shortcut; no discoverable reference. Focus styling omits select/textarea. Range output implicitly creates live regions. Clock still schedules animation under reduced motion. | Small conflict-aware shortcut system, Help dialog, focus restoration, explicit value text, quiet output, reduced-motion frame suppression. |
| 2 | Waveform loading is indistinguishable from unavailable; missing/empty results lack direct recovery. | Explicit loading/unavailable/retry and browse recovery actions; avoid success before acknowledgement. |
| 2 | Constrained layout moves inspector below the whole page; header may wrap, FX/chop controls become tiny. | Test 1024×768, 1280×800, 1440×900, 1920×1080; reachable focus links and consistent hit areas, wrapped local regions. |
| 3 | System health hierarchy and ownership disclosure already work; logs and actions are tested. | Preserve architecture; expose compatibility tools under System and improve setup explanation using observed capabilities. |
| 3 | Client ignores meter fields but serializes large read models on polling; My Jams fetch repeats for unrelated library tabs. | Measure realistic 12-track fixture and idle notifications, remove demonstrated redundant requests; avoid speculative rewrite. |

## Classic capability decision, before implementation

| Classic capability | Studio / System equivalent | Parity | Migration |
| --- | --- | --- | --- |
| Play, pause, recording | Header transport / Recordings | Portable tests pass | Studio primary |
| Managed pads, mix, undo/redo, projects | Instruments, Mixer, My Jams | Portable tests pass | Studio primary |
| Scenes, arrangement, curves | Composition, Perform, Motion | Managed equivalent, not arbitrary legacy curve drawing | Retain compatibility |
| Raw Tidal console / arbitrary routing | Managed code supports bounded patterns only | Incomplete | Retain classic |
| Import/export `.tidal` | Complete projects use `.abx.json` | No direct source-file equivalent | Retain classic |
| Set Loop / legacy source transformations | Jam uses canonical transformations | Different semantics | Retain classic |
| Output-device selection | System observes output, Capture selects input | Output selector unmatched | Retain classic |
| Master/per-channel live diagnostics | System output activity; Studio mix | Diagnostic views differ | Retain classic |
| Stop/reset and process health | System owned lifecycle | Portable tests pass; native gates open | System primary |

Decision **C**: keep classic temporarily for these specific capabilities. Remove
its promotional link from the creative library, retain the existing `/` route,
link it explicitly from System compatibility tools and relevant code contexts.
Do not claim complete parity, remove endpoints, or delete diagnostic code.

## Scope and acceptance constraints

No new music model, player, synth/FX family, native installation, cloud or analytics.
Preserve bounded parameters, import originals, owned process cleanup and stacked PRs.
P2.6 Windows; P3 native audio/timing + Windows; P3.5A native audio/timing/CPU +
Windows; P3.5B native microphone/audio + Windows; P4 native audio/timing/CPU/
musical quality + Windows all remain pending. P5 adds eventual real Windows and
native whole-product acceptance. Ubuntu remains Level B — Runtime Safe.
