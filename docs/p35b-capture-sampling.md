# P3.5B — Capture & Sampling Lab

Implementation complete; native audio/input acceptance remains pending.
Validated on 2026-09-07, Ubuntu 24.04.4 LTS x86_64, Node 24.14.0 / npm 11.9.0.

## Development base and delivery

Before edits, the working tree was clean on `feat/p3.5b-capture-sampling` at exact
commit `3ea7f7b4441bdd456c83699f9a170c9e6c9a56d9`. Remote fetch succeeded.
The stack remains P3.5B → `feat/p3.5a-sound-lab-core` → P3 → P2.6 → main.
The delivery is a draft PR against P3.5A; no lower draft is merged.
The accompanying delivery commit/PR identify this report's revision. P4 and P5
were not started. No kernel, apt, audio packages, SuperCollider/Tidal installation,
or global audio configuration was changed.

## Source, storage and identity

Imported and retained captured audio extend the existing canonical sample asset
family with `user`/`captured` provenance and immutable audio metadata. They use
normal step clips, tracks, scenes, arrangements, mixer channels and Sound Lab FX.
There is no React-owned musical document, browser audio engine, or separate vocal
playback engine. ProjectService and the existing application command queue remain
the musical authority; SuperDirt owns native sample buffers.

Imports copy into `<projects>/audio/`. The whole WAV's SHA-256 gives the canonical
`audio_<hash>` identity, managed filename and reserved native `abx_<hash>` bank.
Saved references use `audio/<id>.wav`; original absolute paths are not serialized.
Changing filename does not create another asset. Changing WAV bytes, including
container metadata, creates a different identity even if the PCM sounds identical.
Managed names are lowercase ASCII, independent of source filename case.

Each asset has immutable original filename, duration, channels, sample rate, frame
count, byte size, creation time and provenance. Separate revision-checked library
metadata contains display name, tags, collection, favorite, one-shot/loop class and
optional explicitly authored BPM. A library rename does not rewrite every project
or change track names. Project identity cannot be silently replaced with new audio.

A `.abx.json` file references audio; it does not embed it. Move/copy the matching
`audio/` directory and its sidecars alongside the project store between machines.
Reimport/relink the exact original WAV if the managed copy is missing. A project
without its library still opens with missing sounds and retained edits; other
tracks remain usable. Content is verified before native use, with stat-stamp caching;
a changed managed WAV becomes missing, never a similarly named substitute.

## Import, library and waveforms

My Sounds offers Add Files and browser-supported Add Folder, selection review,
per-file progress, intelligent duplicates, Preview, Add track and Use on track.
Folder selection is user initiated: no backend recursion or filesystem search.
Hidden paths and non-WAVs are skipped. The picker caps the selection at 2,000 files,
100 accepted WAVs and 1 GiB per batch. Browsing supports search by name, filename,
tags or collection; Captured, Recent (latest ten), Favorites and Loops filters;
and editing sound details. Built-in Sounds stays available in its existing tab.

Supported imports are finalized RIFF/WAVE, PCM16, mono or stereo, 8–192 kHz,
up to 15 minutes and 256 MiB per sound. Compressed formats, float/24-bit WAV,
RF64, multichannel and unfinished/malformed containers are explicitly rejected.
Silence is valid audio. No broad codec or automatic BPM claim is made.

One streamed import runs at a time, writing a unique staging file. A worker validates
chunk boundaries, format, frame alignment and RIFF sizes, hashes the file, and
builds 512 peak bins with 64 KiB reads. File synchronization and atomic rename
precede publication of the catalogue entry. Same-content imports can repair a
missing/changed managed copy. Originals are never modified. Aborted uploads clean
their staging file and do not publish a sound.

Waveform sidecars are separate cached data, fetched by identity and rendered as
SVG. React never decodes audio or stores sample arrays in the project. Missing or
invalid waveform caches show unavailable; they do not prevent musical state from
opening. Automatic waveform-cache repair is not implemented in this phase.

## Shaping, loops and chops

The Sound Lab Sample tab supplies nondestructive start/end, reverse, pitch,
attack/release, shaped preview and loop phrase controls. Waveform gestures make
one revision-guarded Undo action; keyboard sliders are alternatives. Built-in
samples get these controls and preview, with numeric region controls instead of
new waveform analysis. Existing source gain remains distinct from channel level.

Pitch is native playback-rate change, ±24 semitones, and changes duration too.
Start/end are normalized with a minimum positive region. Attack (1 ms–2 s) and
release (1 ms–5 s) are fitted inside the native event lifetime, using Dirt's existing
envelope module. Preview uses the same shaped region, bounded to five seconds.

Loop phrase repeats the authored pad pattern over 1–64 beats. Every enabled pad
retriggers its region at its chosen pitch; the initial Add track has one active pad.
This provides tempo-relative triggering, not independent tempo matching or audio
warping. Natural sample duration can leave gaps or overlap retriggers. Library loop
classification/BPM describes the sound; it does not secretly rewrite clip playback.

Chop to pads evenly divides the selected region into 2/4/8/16 regions. Manual
slice-point addition/splitting, individual region adjustment, removal, preview,
reordering and per-rhythm-pad assignment are available. At most 16 slices per clip
reference the same immutable asset. Stable slice IDs are independent of displayed
pad order. Null assignments use the full trim. Slice pitch/envelope/reverse inherit
clip playback. Rhythm velocity and placement use the established sequencer.
Source replacement resets source-specific shaping/slices while preserving rhythm
and track FX; Undo restores them. No audio blobs are duplicated by slicing.

## Input and capture

Input is an explicit transient runtime capability. Prepare input requires stopped
playback/output recording and no active capture because it reboots owned audio.
Where enumeration is supported, only reported devices are selectable; otherwise
Backend default uses the configured audio backend and the UI explains the limitation.
No WASAPI assumption or invented production device list is introduced.

The initial native path selects input 1 or 2 as mono. SuperCollider requests two
input channels only after explicit preparation. A dedicated SoundIn node applies
input gain (0–2), feeds an input bus and sends 10 Hz peak telemetry. Studio displays
unavailable, very low/no signal, signal present or clipping feedback. Meter updates
have their own endpoint/component and do not enter canonical history/recovery.

Monitoring is explicit, initially OFF, with a headphone/feedback note and bounded
output limiter. The input group follows the project recording tap, keeping both
monitor and trusted preview outside the performance recording. This routing is
implemented and protocol-tested; physical exclusion still requires native proof.

Capture deliberately records dry input **after input gain**, mono PCM16. There is
no live input FX rack or processed-capture option in this phase. Keep the dry source,
then use the existing track FX for reversible treatment. This avoids introducing
another effects graph into the established project-output path. Gain can still
clip a dry capture; the input meter tells the user to lower it.

Capture and project recording have separate identities, nodes, files and catalogues.
Capture files/sidecars live under `<recordings>/captures/`. The state machine is:

`preparing → recording → finalizing → ready → kept` (or `discarded`)

with explicit `failed`/`interrupted` outcomes. A native writer cutoff at 300 seconds
bounds recording even if the Node queue is delayed; a timer requests normal
finalization. Stop frees the writer, closes/synchronizes/frees its buffer, then
validates the completed WAV in a worker before announcing ready. Acknowledgement
alone is insufficient. Operation retries and exact take IDs prevent duplicate takes
or stopping a different take. Startup never promotes unfinished takes to ready.

Keep verifies the finalized hash, imports through the ordinary managed library,
persists the retained identity, then removes only the temporary capture WAV. Retry
is idempotent. Discard can remove unretained takes only. Retained library audio is
never deleted by musical Undo or capture Discard. Failed finalization cannot block
System Reset from recovering owned audio. Stop/Restart/Quit integrate capture cleanup;
input/monitor availability is invalidated when the engine generation changes.
Stopping a take leaves prepared input available for another take; System Stop audio
releases the hardware. Input configuration is session state, never project truth.

## FX, composition, history, MCP and recovery

User/captured samples travel through the P3.5A serial FX rack and existing channel
and master stages. Distortion, reverb, delay, bitcrush, filters, ring modulation and
existing modulation remain source independent. Existing source/speed automation and
FX semantic automation/modulation are preserved; authored sample pitch multiplies
the existing speed pattern. No new automatic trim/slice modulation targets are
exposed. FX base values and modulation/automation ownership remain separate.

Scene copies retain independent clip settings and slice maps; intentional silence
and arrangements use the unchanged P3 composition model. Save/reopen and recovery
retain audio identity, shaping, loop beats, slices, pad mapping, FX, automation,
modulation, scenes and arrangements. Reopened projects remain stopped. A moved
project's existing asset metadata is reused on assignment to avoid identity drift.

Assign/Add track and musical edits use project revision, session and operation
safety, with one meaningful Undo per gesture/action. Import/library details and
capture lifecycle are not musical Undo. Metadata has its own library revision.

MCP adds `user_audio_library`, `user_audio_import`, `user_audio_details`,
`user_audio_add`, `user_audio_assign`, `user_audio_preview`, `capture_status`,
`capture_prepare`, `capture_controls`, `capture_start`, `capture_stop`,
`capture_keep`, `capture_discard`, `capture_preview`. Existing structured
`project_edit` accepts `sample.playback` and `sample.slices`. Import accepts one
explicit absolute file, never an unknown folder. Real MCP/browser synchronization,
readback, edits and stale-write rejection are exercised by the browser journey.

## Security and performance review

HTTP resources inherit loopback Host protection and security headers. Uploads also
require the active session header, same-origin checks, WAV content type, validated
name/relink ID, streaming size limits and a 90-second inactivity timeout. Native
paths are escaped as data. File imports reject relative/traversing paths, control
characters, symlinks (including parents and broken links), directories and excessive
sizes. Container metadata is never executed. Managed native bank names derive only
from validated hashes. No arbitrary path retrieval/download endpoint was added.

The library/catalogue cap is 4,096 entries each; sidecar reads have size bounds.
Analysis has a 60-second worker deadline and fixed-size buffers. One import at a
time prevents unbounded workers; catalogue stat scans are bounded but not a benchmark
of a full 4,096-item library. Verification caches 128 file stamps; waveform responses
are 512 bins. Native user buffers have a 512 MiB per-generation budget and refuse
further loads instead of evicting active voices; restarting audio releases them.
One transient preview buffer may additionally retain a file (up to approximately
512 MiB decoded) until replacement, Stop preview or engine shutdown. Existing bundled
buffers/FX memory are additional. No CPU/latency claim is inferred from these bounds.

Reviewed file mutations are limited to managed import publication, metadata/cache
sidecars and explicit unretained capture cleanup. There is no destructive sample
editor or retained-asset deletion. Searches found no added browser AudioContext,
getUserMedia player, alternate project authority or hardcoded production home/drive
path. Local filesystem changes by another process between verification and native
loading cannot be treated as a secure filesystem transaction. Symlinked storage
roots are intentionally rejected, including linked parent components.

## Validation and regressions

Baseline, before implementation: **259 discovered, 256 passed, 3 Windows-only
skips**, production build and both typechecks passed. All six existing browser
journeys and the Linux lifecycle harness passed.

Final full suite: **304 discovered, 301 passed, 3 Windows-only skips, 0 failures**.
The 45 added sampling tests cover import/container failures, copies/deduplication,
identity and metadata revisions, missing/relink and moved roots, playback bounds,
compiler output, grouped Undo, stable slices/scenes/save, shared preview, capture
barriers/retries/failure/interruption/keep/discard, separate output recording,
capabilities/monitoring, FX/automation/modulation/recovery, HTTP guards, aborted
uploads and worker responsiveness. The input protocol assertion includes the
native five-minute cutoff. The MCP tool inventory test preserves prior tools and
asserts the complete new family; no old tests were removed or relaxed.

Production build and both server/Studio typechecks: **PASS**.
Browser journeys: **PASS** for classic, Studio, P2, P3, P3.5A, P3.5B and System.
Linux runtime harness: **PASS**, including actual Node cold/second launch, session
reuse, HTTP/Studio/System, process inventory, Stop/Quit, signals, owner/port cleanup
and protection of unrelated owners. These are runtime tests, not audio tests.

The P3.5B browser journey uses production UI/HTTP/storage and a real MCP client with
an explicitly synthetic microphone engine. It exercises the requested creative
workflow: import/folder filtering/deduplicate, preview/Add track, drag trim/reverse/
pitch, Distortion + Reverb, save/reopen, input preparation/meter, record/finalize/
preview/Keep, assign retained capture through those FX, chop/preview/reorder/Undo/
Redo, sequence and duplicate scene, save/reopen and Play's buffer-load contract.
The waveform is deterministic amplitude-modulated PCM, not recorded human speech.
There are no browser JavaScript errors or horizontal page overflow at 1280/1440/1920.
The final small numeric-display adjustment was followed by build/typechecks,
all 45 sampling tests and another P3.5B browser run.

Reviewed screenshots: [Capture + FX](p35b-capture-1440.png),
[Sampling 1280](p35b-sampling-1280.png), [Sampling 1440](p35b-sampling-1440.png),
[Sampling 1920](p35b-sampling-1920.png). Full-page vertical scrolling is intentional.
Historical screenshots regenerated by regression harnesses were restored to preserve
their original milestone evidence. [Machine-readable results](p35b-validation.json).

Issues found and fixed during implementation include config import side effects in
fixture/native port setup, managed fingerprint leakage into visible labels and
horizontal overflow, sample control contrast, millisecond envelope display precision,
a nullable-library-label type error, unavailable shaped built-in previews, changed
assets preventing other tracks from playing, missing-ready-take status, storage
failure leaving misleading capture state, input preparation interrupting playback,
reset being blocked by failed capture close, and moved-project asset metadata drift.

## Acceptance gates and remaining limits

**Ubuntu implementation/runtime validation passes. Native audio/input acceptance
is not complete.** There is no physical microphone, audition, timing, CPU or native
buffer/envelope/routing evidence for P3.5B on this host. Windows is unavailable.
Device names, backend combinations and channel availability require hardware tests.
The source review below informs implementation; it does not replace installed-version
SuperCollider/SuperDirt/Tidal execution.

All inherited gates remain open: P2.6 Windows desktop/audio; P3 native audio/timing
and Windows; P3.5A native audio/timing/CPU and Windows. P3.5B additionally needs native
input enumeration/default/channel selection, gain/meters/clipping, explicit monitor
feedback/headroom, dry/output/preview routing isolation, simultaneous recording,
finalization and five-minute cutoff, failure/device-loss/restart/reconnect, retained
sample sound, pitch/reverse/trim/envelope/chops/loops/FX timing, CPU/buffer lifetime,
and Windows launcher/runtime/audio regression acceptance. Do not close them from CI.

Deliberate limits: PCM16 WAV only; two selectable mono input channels; dry capture
only; five-minute captures; no live input FX; rate-based pitch and phrase retriggering;
no elastic audio, transient/BPM detection, multisample instrument or sample presets;
no retained-asset delete/garbage collection, project packaging or automatic cache
repair. The Capture panel shows the eight latest nondiscarded takes from a 100-take
runtime view; older entries remain on disk. Folder picking depends on browser support.
These are bounded P3.5B choices, not P4/P5 implementations.

## Exit criteria

| Requested criterion | Result / evidence |
| --- | --- |
| Safe import, user library, stable asset identity | Implemented; worker/storage/security tests and browser upload/folder/dedup journey |
| Trusted previews | Implemented in existing native group; history/routing protocol tests; physical routing pending |
| Persistent captured identity and microphone architecture | Implemented; separate input/capture catalogue and managed Keep path; hardware pending |
| Trustworthy lifecycle and normal playable retained samples | Implemented; barriers, invalid output/interruption/retry/reopen tests; native finalization pending |
| Useful sample shaping and nondestructive edits | Implemented; trim/reverse/rate pitch/envelope, guarded gestures and unchanged originals |
| Initial loop and slicing/chopping model | Implemented; explicit phrase semantics, stable region IDs, sequenced mappings |
| Existing FX and source-agnostic scenes/arrangements | Implemented; unchanged rack/channel/composition authority, fixture regressions |
| Save/reopen, recovery and meaningful Undo/Redo | Implemented and tested; files are not deleted by musical Undo |
| Canonical MCP and honest missing assets | Implemented; real MCP synchronization/stale rejection and exact-content relink tests |
| P4/P5 not started | Confirmed |
| Native audio/input acceptance complete | **No — pending**, including all inherited Windows/native gates |

## Files changed

- Domain/storage: `mcp/src/sampling.ts`, `audio-worker.ts`, `user-audio.ts`,
  `capture.ts`, `sampling-engine.ts`, `audio-http.ts` (new); `project.ts`,
  `project-compiler.ts`, `application.ts`, `commands.ts`.
- Runtime/integration: `engine.ts`, `sclang.ts`, `preview.ts`, `meter.ts`,
  `runtime.ts`, `dashboard.ts`, `server.ts`, `studio-client.ts`;
  `sc/superdirt_startup.scd`.
- Studio: new `mcp/studio/src/Sampling.tsx`; `App.tsx`, `SoundLab.tsx`,
  `SoundLibrary.tsx`, `controls.tsx`, `style.css`; `mcp/vite.config.ts`.
- Validation: new `mcp/src/sampling-test-fixture.ts`, `sampling.test.ts`,
  `mcp/p35b-selftest.mjs`; `mcp/src/mcp.test.ts`, `mcp/run-tests.mjs`,
  `mcp/package.json`, `.github/workflows/ci.yml`.
- Documentation: `README.md`, `CONTRIBUTING.md`, `HANDOFF.md`,
  `tasks/TASK-3.5B.md`, this report, `docs/p35b-validation.json` and four screenshots.

## Native contract references reviewed

SuperDirt's [DirtSoundLibrary](https://raw.githubusercontent.com/musikinformatik/SuperDirt/master/classes/DirtSoundLibrary.sc)
provides `loadSoundFile`; [DirtEvent](https://raw.githubusercontent.com/musikinformatik/SuperDirt/master/classes/DirtEvent.sc)
provides rate/region/lifetime semantics. The existing
[core synths](https://raw.githubusercontent.com/musikinformatik/SuperDirt/master/synths/core-synths.scd)
and [modules](https://raw.githubusercontent.com/musikinformatik/SuperDirt/master/synths/core-modules.scd)
define Dirt envelopes. SuperCollider documents
[ServerOptions](https://doc.sccode.org/Classes/ServerOptions.html) input configuration
and [Recorder](https://doc.sccode.org/Classes/Recorder.html) recording conventions.
Tidal's [Pattern implementation](https://raw.githubusercontent.com/tidalcycles/Tidal/main/tidal-core/src/Sound/Tidal/Pattern.hs)
was reviewed for value-map multiplication used by sample rate composition.
