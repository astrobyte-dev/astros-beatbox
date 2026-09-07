# P3.5A — Sound Lab Core

**Implementation complete for the initial supported Sound Lab surface; native
audio acceptance is NOT complete.** Ubuntu 24.04.4 LTS, Node 24.14.0/npm 11.9.0.
P2.6 remains Level B / Ubuntu Runtime Safe, Windows gate pending. P3 remains
implementation complete, native audio/timing acceptance pending. Dependencies
are unmerged drafts. No P3.5B/P4/P5 work was started.

## Baseline

Verified clean `feat/p3.5a-sound-lab-core` at exact P3 head
`7f5971ab603c33f893071839c5880b57ed8569f1`, confirmed Ubuntu and fetched origin
before editing. Reviewed the milestone handoffs and project, compiler, scene,
automation, mixer, reconciler, engine, Studio, history, storage and MCP boundaries.
The initial shell selected Node 22; the complete baseline and acceptance runs used
the repository's pinned Node 24.14.0. Baseline: **201 passed, 3 Windows-only skips,
204 discovered**, production build, both typechecks, Classic/Studio/P2/P3/System
browser journeys and Linux lifecycle harness passed before implementation.

## Authored architecture

`src/sound-lab.ts` is a browser-safe catalogue and schema module. It holds stable
IDs, version, category, descriptions, engine names, basic/advanced parameter
metadata, normalized ranges/steps/units, defaults, musical meaning and factory
patches. React uses the same catalogue as validation, compilation and MCP.

`Track.source` distinguishes `sample`, `synth` and `code`. A synth owns definition
ID/version, exact parameter values and optional preset identity. Omitted source
retains old P0b–P3 clip/asset semantics without rewriting old checksums. Newly added
synths are always explicit. Existing step clips retain their immutable asset
reference for compatibility, but the synth track's definition is authoritative;
a missing historical sample reference cannot silence a synth. Notes are bounded
MIDI integers, one per pad, with a separate octave offset. Pitch is clamped to MIDI
0–127 after transposition. The compiler uses managed `midinote` and `pF` controls.

Track-level ordered `effects` contain stable instance ID, definition ID/version,
enabled state and values. Track-level `modulation` routes contain stable IDs,
semantic targets, source type, depth, rate and enable state. Parameters are stored
in 0–1 space, with engine mappings to Hz, time, oscillator shape and other units.
Targets are `synth.<parameter>` or `fx.<instanceId>.<parameter>`. A maximum of eight
serial inserts and sixteen routes per track keeps the first surface bounded.
The existing twelve managed stereo channels remain the routing capacity.

Source changes preserve track, scene, clip and mixer identity. Incompatible synth
routes/automation are removed together with the source change and restored by its
Undo. Replacing a synth with a sample explicitly changes the track source, retaining
notes and inserts. Other clips whose old reference is synth-only become silent;
no synthetic sound is played while claiming a sample source.

## Instruments and DSP

| Instrument | Approach | Factory patches |
| --- | --- | --- |
| Dirty Mono | Pulse/sub oscillator, resonant low-pass, soft saturation, explicit prior-note glide and mono cut group | Clean Pulse, Warehouse, Corroded |
| 808 Sub | Sine/sub weight, pitch-drop envelope, harmonic tone, drive and glide | Deep, Knock, Long Slide |
| Reese | Detuned stereo saws, width mixing, slow filter movement and drive | Wide Dark, Moving |
| Prism | Sine/triangle/pulse interpolation, tone/filter, attack/decay/release shaping | Glass Pluck, Soft Cloud |
| Static Bloom | FM, pink noise, bounded instability, filter and saturation | Rust, Atmosphere |

`src/sound-lab-engine.ts` generates SynthDefs from the shared catalogue. Engine boot
adds them alongside the existing channel installation, before reporting readiness.
SuperDirt's event groups own voice lifetimes; envelopes also free their own voices.
Glide starts at the prior active note in the authored looping phrase. Bass cut groups
prevent overlapping managed mono voices. Default note length is four pad durations;
Notes exposes length and octave, while explicit clip sustain/legato and P3 automation
remain available. Envelope life is bounded by the SuperDirt event gate.

These are designed patches and DSP approaches, **not audibly curated or acoustically
accepted sounds**. The native interpreter/toolchain was unavailable. Native compile,
musical balance, aliasing, gate/envelope interaction, glide at scene boundaries,
cut behavior and actual output measurements require later acceptance.

The integration was checked against primary sources for
[SuperDirt event scheduling and gates](https://github.com/musikinformatik/SuperDirt/blob/master/classes/DirtEvent.sc),
[SynthDef lookup](https://github.com/musikinformatik/SuperDirt/blob/master/classes/DirtSoundLibrary.sc)
and [Tidal's parameter makers and MIDI note conversion](https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/Params.hs).
This source review does not establish compatibility through native execution.

## Serial inserts and lifetime

The eight effects are Filter (resonant low-pass), Distortion (soft saturation),
Bitcrush (quantization/sample hold), Reverb (FreeVerb2), Delay (bounded CombC),
Chorus (stereo modulated delay), Compressor (Compander) and Ring Mod.
They run on each existing stereo channel input bus, after Dirt's source/event
processing and before its independent channel fader/balance and master boundary.
The existing Preview path remains outside the project recorder and insert buses.

`rackCommand` reconciles an engine-local dictionary. Parameter and bypass edits
update nodes; reorders move existing nodes before the channel in serial order;
removed/unavailable instances are freed. Runtime keys include channel, authored
instance, definition and version, so opening another project with a reused instance
ID cannot retain the wrong processor. String-key retention uses `includesEqual`:
[SuperCollider's `includes` compares identity](https://doc.sccode.org/Classes/Collection.html#-includesEqual).
A new engine generation starts with an empty dictionary. No node or bus handle is
serialized. Live insert edits survive an audio reset during scene performance.

Node placement follows [SC execution order](https://doc.sccode.org/Classes/Synth.html#Order%20of%20Execution)
and [ReplaceOut](https://doc.sccode.org/Classes/ReplaceOut.html). Bypassed nodes remain
alive to preserve state and tails; their CPU cost remains. Removal truncates a tail.
Native glitch/tail/reorder and node-count measurements remain pending.

## Modulation and composition ownership

P3's stepped compositional automation now also supports `synth.<parameter>`.
A clip lane overrides a track lane for that semantic target; enabled automation
supplies the event's control value while retaining the authored base. Disabling
it exposes the original base. Existing sample/event automation is unchanged.

SC combines `clamp(base-or-automation + modulation × depth)` before DSP mapping.
The product is explicitly parenthesized because SC binary operators share
precedence. LFO, random hold and repeating envelope pulses run at control rate in
scsynth. Synth voices retrigger their modulation phase on each event; persistent
inserts retain phase. Rates are 0.02–20 Hz and depths −1–1. One route per target
avoids ambiguous collisions. Off/remove restores zero offset and retains base /
automation; disabling keeps its authored depth. FX removal also removes its routes.

There is no audio-rate browser write loop. Knobs commit once on release or keyboard
gesture, and synth changes apply to subsequent events. P3 scene/arrangement content
remains a prepared performance snapshot: relaunch to hear staged source/note changes;
mixer, tempo and insert edits are live. No polling frequency was increased.

Initial limitation: compositional automation targets synth controls and the prior
P3 event controls; **serial insert controls support manual editing and engine
modulation, but do not yet expose P3 compositional automation lanes**. Unsupported
FX automation targets are rejected rather than pretending to schedule them. This
is not a general modulation graph, free-running global synth LFO, MIDI editor or
macro system.

## Studio and accessibility

The Synths collection separates Bass, Synth and Experimental instruments from
sample banks. Adding one creates a first phrase as one Undo intention. The selected
track stays directly above Sound Lab's Notes / Instrument / FX / Motion views.
Dark instrument panels use Studio's typography, coral/mint accents and existing
page structure. Knobs have arc/value feedback, a modulation ring and automation
indicator. Advanced controls appear only where the definition supplies them.

Reusable knobs support pointer capture, vertical drag, Shift fine adjustment,
arrow keys, Home/End, Escape/cancel, visible focus, accessible slider state and an
explicit Reset button. Transient drafts retain their starting project revision;
concurrent MCP changes reject the gesture. Existing reusable faders/pads remain.
FX reorder uses accessible earlier/later buttons, bypass has switch semantics,
and modulation assignment uses named selects and buttons. No right-click or
required dragging. Notes use one MIDI number per pad instead of adding a piano roll.

Instrument/effect factory patches load atomically. Users can name and save exact
parameter patches in the current project, then reload them. There is no separate
cross-project/cloud patch library. Defaults preserve the surrounding mixer/rack.
The full project keeps exact values, source, patches, notes, order, bypass and routes
through checksummed save/open and alternating recovery checkpoints. Unknown
instruments/versions are retained and silent; unknown FX are retained and bypassed.
Invalid known parameter sets fail before mutation. Future project formats fail
without changing the current project.

## Scenes, history and MCP

Scenes and arrangements continue to reference track/clip IDs. Duplicate scene copies
notes, rhythm and clip automation independently; it shares the track's instrument,
patch and inserts by design. Silence never changes the sound source or channel.
The original compiler/performance machinery schedules the arrangement.

ProjectService snapshots provide one intention for source swap, patch load, effect
add/remove/reorder, route changes and knob gestures. No separate UI or AI history
exists. Real `project_edit` batches expose `source.set`, `synth.parameter`,
`notes.set`, `fx.put/remove/order`, `modulation.put/remove` and `patch.put/load`.
`project_status` returns complete state; `sound_lab_catalog` lists definitions and
patches without booting audio. HTTP/MCP retain session, operation and revision
checks. Failed engine application leaves history/document unchanged and attempts
the existing best-effort rollback; atomic audio rollback is not claimed.

## Safety, performance and future runway

All authored sound values are finite/bounded; pitches, route rates, depths, rack
size and project size are bounded. Filter resonance has a floor on reciprocal Q;
delay decay and maximum delay are finite. Voice outputs use DC removal and clipping;
insert outputs use DC removal/limiting; the existing final master limiter remains.
No unbounded user feedback routing is introduced. SC source review corrected
operator-precedence errors that could otherwise zero base parameters or dry signal.
Native amplitude, CPU and node-leak acceptance still requires actual measurements.

FX read channel buses and are independent of the source oscillator implementation,
so future input sources can feed the same architecture. No input source or capture
was added. Meaning fields such as brightness/dirt/space/movement/energy provide a
small semantic runway; there are no P4 verbs, variation, generation or macros.
Existing System, runtime ownership, Windows launch/process safeguards, recorder and
Preview ownership are preserved. No system audio, package or kernel changes occurred.

## Validation and review

Final suite: **236 passed, 3 expected Windows-only skips, 239 discovered; zero
failures**. Thirty-five new tests cover definitions, five synth compilation paths,
source/scene independence, bounds, missing/version handling, pitch, rack identity /
order / bypass / cleanup, modulation collision/removal/restoration, automation
coexistence, curated/user patches, recovery, grouped history, stale revisions,
parameter traffic, failed acknowledgements, scene launch/reopen, reused FX IDs,
performance reset and SC arithmetic/source contracts. Discovery floor is 239.

Production build and both TypeScript checks pass. Browser journeys pass:

- Sound Lab: add/play synth, keyboard and pointer knobs, one history entry, patches,
  notes, two FX/reorder/bypass/Undo, LFO/Undo/Redo, synth automation coexistence,
  real MCP catalogue/edit/stale rejection, independent duplicated scene notes,
  scene launch, full save/new/reopen/reload and concurrent held-gesture rejection.
- Classic, original Studio, P2 creative loop, P3 composition/performance and System
  regression journeys; deterministic audio, real project/HTTP/MCP services.
- Linux lifecycle: cold/second launch, session reuse, Stop/Quit, signals, owned
  process/port cleanup and unrelated-conflict protection, with Node fixtures.

Reviewed Sound Lab screenshots at 1280, 1440 and 1920, including rack and motion.
Fixed dark-panel text contrast and excessive rack control spacing. No page overflow
or JavaScript errors occurred. Historical P0b–P3 screenshots were restored after
regression runs. New evidence is `p35-instrument-{1280,1440,1920}.png`,
`p35-fx-1920.png` and `p35-motion-1920.png`.

Final review also fixed stale processor identity on project switch, live insert
state on performance Reset, synth/sample availability assumptions, SC string
membership, SC arithmetic grouping, and misleading effect engine metadata.
Searches found no new browser audio engine/control timer, React-owned project
reducer, audio input, external installation or future-phase features.

## Exit criteria

| Criterion | Status |
| --- | --- |
| First-class canonical synth / source-agnostic scenes and arrangement | Implemented; domain/compiler/browser covered |
| Small reusable instrument and parameter-definition system | Five instruments; version/default/bounds tests |
| Tactile controls and basic/advanced Studio integration | Implemented; keyboard/pointer/stale-gesture and visual reviewed |
| Canonical serial FX, useful collection, persistent/reversible order/bypass/parameters | Eight effects; domain/application/browser covered |
| Engine-owned modulation and distinct automation/base ownership | Implemented for supported targets; contract/coexistence tests |
| Local factory/user patches and full project save/reopen/recovery | Implemented; storage/history/browser covered |
| Structured MCP inspection/edits and synchronization | Implemented; actual adapter/browser covered |
| Future input/semantic experimentation runway without later-phase work | Reviewed; no P3.5B/P4/P5 features |
| Ubuntu portable/runtime validation | Passed on P2.6 Level B base; fixture audio only |
| Native audio, audible quality, timing, CPU and node lifetime acceptance | **Pending** |
| P2.6/P3/P3.5A Windows desktop/audio revalidation | **Pending** |

## Files and delivery

Added: `src/sound-lab.ts`, `sound-lab-edits.ts`, `sound-lab-engine.ts`,
`sound-lab.test.ts`; Studio `SoundLab.tsx`; `p35-selftest.mjs`; this report,
`p35-validation.json`, `tasks/TASK-3.5A.md` and five screenshots.

Modified: project schema/reducer/compiler, application reconciliation and engine
installation; MCP catalogue/test; Studio App/Composition/SoundLibrary/controls/styles; package
script, test floor, CI; README/CONTRIBUTING/HANDOFF. No external dependencies added.

Delivery branch: `feat/p3.5a-sound-lab-core`. Draft PR base:
`feat/p3-composition-performance`. The delivery commit/PR and final clean-tree
confirmation are recorded in the accompanying handoff response and Git history.
Neither this PR nor P2.6/P3 is to be merged by this task.
