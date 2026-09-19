# Windows native acceptance — 2026-09-07

**Result: P2.6 Windows desktop/audio revalidation and the current human
console-flash checkpoint pass after four targeted fixes. Final product acceptance
remains open for explicit listening/Jam results and usable microphone checks.
Do not merge the PR stack on this report.**

## Checkout and scope

- Windows checkout: `feat/p5-product-finish`, tracking `origin/feat/p5-product-finish`.
- Starting HEAD and origin both exactly `ea4b0ef3a82e1efd9b0584837c896639c557f2e2`;
  clean working tree, zero commits ahead/behind. The explicitly authorized switch
  created the local tracking branch without discrepancies, then HANDOFF and the
  linked P2.5–P5 tasks/reports were read again.
- Baseline validation tested that SHA. Successful native validation tests that SHA
  **plus the acceptance fixes described below**. It does not establish
  that the original unpatched handoff is native-safe.
- Delivery scope: commit and push these acceptance fixes, regression coverage and
  documentation to the same branch, as explicitly requested after human review.
  The acceptance commit containing this report identifies the reviewed source;
  the final delivery response records its exact SHA and remote synchronization.
  No merges, PR retargeting or new feature phase are authorized or included.
- Original running Pocket groove was saved as
  `projects/pre-windows-acceptance-20260907.abx.json` before its owned runtime was
  gracefully quit. Subsequent audio harnesses ran sequentially in isolated storage.

## Environment

| Component | Observed Windows installation |
| --- | --- |
| OS | Windows NT 10.0.26200.0, native PowerShell |
| Node / npm | 24.14.0 / 11.9.0 |
| SuperCollider / sclang | 3.14.1, `C:\Program Files\SuperCollider-3.14.1` |
| SuperDirt | `v1.7.4-14-gd66f20d` |
| Dirt-Samples | `c74fc80` |
| Quarks/plugins | SuperDirt, Dirt-Samples, Vowel, SC3plugins present |
| GHCup / GHC / GHCi | 0.2.3.0 / 9.6.7 / 9.6.7, `C:\ghcup` |
| cabal / Tidal | 3.14.2.0 / 1.10.1; user GHC package environment |
| Windows launcher | Actual `wscript.exe`, `cscript.exe`, ShellExecute URL association |
| Default browser | Opera, UA OPR/134 with Chromium/150 |
| Native audio | System default output, PortAudio, 48,000 Hz, stereo, 12 orbits |

No system dependency reinstall, driver change, global Haskell change, or copied
machine-specific audio configuration was needed. `npm ci` restored the locked
dependencies (122 packages; 123 audited). Its audit reported six advisories
(one low, two moderate, three high); no unrelated dependency upgrade was made.

## Automated and browser results

| Check | Result |
| --- | --- |
| Baseline `npm test` (includes production build) | 380 discovered; 371 passed; 9 Linux-only skips; 0 failures |
| Final `npm test` (includes production build) | 383 discovered; 374 passed; 9 Linux-only skips; 0 failures |
| Both TypeScript checks | Pass, before and after fixes |
| All browser journeys | Classic, Studio, P2, P3, P3.5A, P3.5B, P4, System, P5 pass |
| Affected browser reruns | P3, P3.5A, P3.5B, P4 and P5 pass |
| P5 accessibility | 24 fixture states, no reported accessibility violations |
| P5 layouts | 1024, 1280, 1440, 1920 widths, no horizontal overflow |
| Native inherited regressions | P0a, P0b, Studio, P2, persistent runtime, recording ordering, System lifecycle pass |
| Native compiler regressions | Tidal and sclang opt-in checks pass |

Final P5 fixture stress: 12 tracks, 16 scenes, 138 clips, 13 FX, 78 automation
lanes, 13 assets, 8 chops and 12 ideas. Final review rerun: render after navigation
49.957 ms; idle task 8.409 ms; JS heap 38.071 MiB; no idle project-list calls. These are browser
fixture measurements, not native DSP load or an acoustic timing benchmark.

## Windows ownership and lifecycle

The final `system-live-selftest.mjs` run passed real Windows Script Host cold
launch, Studio/System navigation, actual OS PID/port inventory, Restart audio
with restored music, second-launch session/generation/PID reuse, Stop with port
release, Restart services, resume, external port conflict protection, and Quit.
Quit finalized a non-silent WAV and exited every verified owned process and
descendant. Relaunch recovered stopped. All native harnesses released their
owned audio ports on completion.

The full lifecycle watcher observed **zero console-show events**. The actual
default-browser association test also passed with zero such events. That test
uses a compatible runtime stub to prove ShellExecute/default-browser navigation;
the full native lifecycle uses `--no-open` and navigates production UI through
Playwright. These are separate pieces of evidence, not an invented visual
observation. The additional normal root launcher cold/reuse check also passed:
two actual default-browser launches retained runtime PID 18500, session
`2184031a-3dd4-418a-a4f7-dfead85b518e`, generation and owned process identities,
with zero console-show events. Studio and System responded successfully. It
left the recovered original project stopped for the human checkpoint; see
`desktop-final.json`.

The pre-existing unrelated OpenClaw, Adobe and external server processes were
not terminated. Tests use identity-based ownership; no process-name/port-wide
kill or ownership weakening was introduced.

**Human console-flash confirmation: PASS.** The user explicitly reported no
visible console windows during the full lifecycle sequence. This is current
P2.6–P5 confirmation, separate from historical P2.5 approval. The user's earlier
desktop UX finding also confirmed that music continued after closing Studio.
Together with native audio, recording, ownership and lifecycle evidence, this
closes P2.6 Windows desktop/audio revalidation and the shared Windows desktop
subchecks for later phases. It does not establish synth/Jam musical quality.

## Native audio, timing and recording

- Tidal/GHCi, SuperCollider, SuperDirt, sample load, repeated playback and real
  WAV finalization passed. Pocket groove PCM peak was 8036. Nonzero native audio
  and measured routing do not substitute for a person confirming speaker output.
- Sustained stereo test: baseline L/R 0.036/0.018; quarter gain 0.009/0.005;
  left 0.036/0; right 0/0.018; mute and solo exclusions zero. Channel isolation
  and sustained-note mixer updates passed.
- Preview-only output recording peak 18981, simultaneous project recording
  peak zero and project input tap zero: measured preview isolation passed.
- Persistent runtime retained session/generation and music across frontend/MCP
  disappearance and reconnect. Stereo meter sums were 0.224 before, 0.232
  disconnected and 0.228 after reconnect. Its 5.911-second WAV had peak 8037.
- Recording ordering regression passed 13 takes: ten non-silent musical takes
  and three intentionally silent takes. It covers immediate first Play,
  project switch, mixer changes, reset, preview teardown and lifecycle admission.
- Scene queuing, silent-scene transition, repeats, finite ending and loop wrap
  ran on the native Tidal clock. At 120 BPM (two seconds/cycle), a finite run
  started at cycle 46; measured activity began by 46.051739 and its final
  measured transient was at 47.8736835. The later silent region stayed silent
  through 50.528206. The recording was 10.289 seconds, PCM peak 7869.
- That run had no browser/MCP client and explicitly disabled the Node display
  clock observer. Tidal continued the finite arrangement correctly; later
  observation marked it ended. The browser is not the musical clock.
- These clock/meter samples are approximately 100 ms apart. They validate
  scheduled behavior and silence, **not** sample-accurate multi-track alignment,
  latency/jitter bounds or absence of audible clicks.
- Managed code draft/apply passed. Raw SC evaluation marked external state;
  implicit resume was rejected; explicit return to managed performance restored
  native playback.

## Sound Lab and Jam

All five synths produced non-silent native WAVs: Dirty Mono peak 7948, 808/Sub
4101, Reese 2931, Prism 3069, Static Bloom 3690. All factory patches and note
changes (36/43), including glide-capable instrument paths, were exercised.
Listening, pitch accuracy and glide quality are still human checks.

All eight insert FX were added individually, bypassed and removed with live
signal, then combined and reordered. The FX dictionary returned from one to
zero on removal. All eight together measured average CPU 5.0103%, peak 7.258%,
110 synth nodes. After removal and nine seconds of paused voice expiry, it
returned to the observed 88-node baseline, zero FX and average CPU 1.6665%.
Individual synth samples were approximately 2.94–3.79% average CPU, with peaks
approximately 3.4–5.8%. No runaway level or accumulating FX nodes was observed
in these bounded tests. This is not a long-session soak or worst-case load proof.

Base values, FX automation, engine modulation and macros coexisted in live
audio; changing a macro preserved authored base values. Native negative synth
modulation and macro controls compile successfully after the fix.

Native Jam checks passed locked-track preservation, repeatable seeded rhythm
variation from the same saved baseline, Keep, Chaos, build verb, performance
event notebook retention, scene promotion and exact save/reopen. Real MCP
passed inspect, locks, variation, negative synth/FX macro values, Keep,
promotion and stale rejection. Closing/reconnecting its client retained native
music (disconnected meter 0.026/0.027), session and generation.

The full P4 browser journey was also rerun against the real native runtime and
passed intensity, A/B/return/branch, verbs, macro layering/stale gestures, Bench
pins, event notebook, promotion, MCP and reconnect (maximum stereo meter sum
0.268). Results are recorded in `p4-native-full.log`; portable tests separately
cover bounded history. Technical preservation is separate
from whether these choices sound good or are fun. **Human Jam acceptance is pending.**

## Capture and sampling

Real default-input Capture prepared, recorded 8.349 seconds, finalized, kept an
asset, added it to a track and survived save/reopen. Monitoring was off. Input
meter stayed zero; waveform peak was one PCM bit (0.0000305 full scale); retained
playback meter was zero. The simultaneous project recording was silent.

This establishes lifecycle/file handling only. **No usable microphone signal was
established.** Input metering with speech, monitoring, retained audible input and
signal-dependent input/Capture isolation remain blocked pending device choice
and a deliberate signal. Silence cannot prove microphone isolation.

Separately, a genuinely non-silent native project WAV passed import, preview,
retained playback, waveform UI, trim, reverse, +7-semitone pitch, envelope,
phrase loop, alternating chops, scene/FX integration and save/reopen. The reverse
case exposed and now verifies the negative-argument compiler fix.

## P5 whole-product native journey

Production Studio with native audio passed Start Playing → keyboard rhythm edit
→ Undo/Redo → Dirty Mono and cutoff → FX/modulation → Jam lock/variation/Keep
and macros → scene promotion → arrangement → actual WAV import/reverse/loop/chops
→ save/status/new/reopen stopped → Perform arrangement → recording → System
“Everything is in tune” → return to Studio. The resulting stereo 48 kHz WAV was
3.592 seconds, PCM peak 11576. No browser JS errors; 1280 layout and reduced
motion passed. Native screenshots were inspected. Capture's signal-dependent
subset remains separate as described above. Empty/error states, focus,
keyboard and project protection also passed the broader fixture journey.

## Defects and targeted changes

1. **Tidal boot helper failed:** transitive `containers`/`tidal-core` packages
   were hidden by the user GHC environment, and helper `let` indentation was
   invalid. Boot explicitly exposes its imports before stream creation and uses
   correct layout. No installed package environment was changed.
2. **Prepared commands/clock failed:** generated multiline `do` layout was
   invalid in GHCi, and clock parsing rejected its `tidal> ` prompt. Explicit
   braces preserve comments/newlines; parsing permits that exact prompt while
   retaining strict marker/number boundaries.
3. **Sound Lab installation failed:** wrapping large SC source in one inline
   `.compile` string hit the interpreter's string lexer limit. Frames over
   7000 UTF-8 bytes now compile a temporary source file while preserving queued
   execution, SystemClock routines, ACK/error barriers and cleanup. Native tests
   cover 9 KB and 70 KB source, async work, rejection and recovery.
4. **Reverse/negative controls failed:** bare Haskell negative function arguments
   parsed as subtraction. Compiler output now parenthesizes negative sample
   speed, clip parameters, synth modulation and macro offsets. Portable and real
   GHCi/native-audio regression checks pass.

Three portable regression tests were added (floor now 383), with two opt-in
native compiler harnesses documented in CONTRIBUTING. The inherited Studio
live harness was corrected to assert stopped-on-reopen and explicitly Play
before testing Pause; product behavior was preserved.

Exploratory harness failures included a guessed recording filename, selecting
an old asset, comparing full-file versus PCM hashes, attempting a code source
on a track with retained step clips, and suggesting already-existing macros.
Those test setup errors were corrected; separate successful sampling, managed
code and MCP logs supersede those failed stages. The initial aggregate
`native-product.json` is retained as partial evidence, not labeled an overall pass.

## Post-acceptance requirement: KNURL Windows tray presence

**Human UX finding, reported during native acceptance:** closing Studio/the
browser window correctly left the persistent runtime and music running. Without
a visible Windows tray presence or another persistent desktop shell, the app
appeared closed while music continued, leaving no obvious visible place to
reopen, stop or quit it.

Record this for the **post-acceptance KNURL rename/desktop-shell work**. KNURL
must have a persistent Windows tray presence while its runtime is active, with
at minimum:

- Running/health indication.
- Open Studio.
- Open System / Runtime Control Center.
- Stop Audio.
- Restart Audio.
- Quit KNURL.

The persistent runtime is desirable and must remain: closing a browser window
must **not** automatically kill an active musical session. Launching KNURL while
already running must continue to reuse the existing verified runtime.

This is a deferred desktop UX requirement, not a new feature authorized for the
current native acceptance campaign. Do not implement it during acceptance unless
it becomes necessary to resolve an actual acceptance blocker. No tray or rename
implementation is included in these acceptance changes. This observation alone does
not close the separate console-flash, Jam-quality or microphone checkpoints.

## Remaining acceptance and human steps

**Closed: P2.6 Windows desktop/audio revalidation and the shared Windows
desktop/console-flash subchecks for P3 through P5.** This closes a Windows gate;
Ubuntu remains Level B / Runtime Safe, with native Linux audio unvalidated.

The human response explicitly selected console PASS. Its musical section still
said “PASS / ISSUES FOUND” with empty notes, and the microphone section still
said “PASS / BLOCKED” with `[device name]` and `[what happened]` placeholders.
These establish neither a musical pass nor a specific defect nor a microphone
outcome. Clarification was requested; until supplied, the following gates remain
open. No source fix was inferred from those placeholders.

| Gate | Remaining evidence |
| --- | --- |
| P3 native timing/audio | Native functional scheduling passes; listening confirmation of transitions remains unspecified; no claim of precise acoustic timing bounds |
| P3.5A native audio/timing/CPU/Windows | Synth/FX pitch/glide/transition quality and representative longer listening/load session |
| P3.5B native microphone/audio/Windows | Usable input, metering, monitoring, retained signal and signal-dependent isolation |
| P4 native audio/timing/CPU/musical quality/Windows | Human extended Jam usefulness/fun and listening/load observations |
| P5 native whole-product/musical usability | Explicit human Jam outcome and input-dependent subset |

1. **Console check — completed, human PASS:** the sequence was System → Quit,
   then double-click
   root `Launch Beatbox.vbs`; press Play (or Start Playing). In System, use
   Restart audio, then Restart services, waiting for each to finish. Double-click
   the launcher again while music plays. Then System → Stop audio → Quit.
   The user reported no CMD, PowerShell, conhost, Node, GHCi or SC console flashes.
   This checkpoint does not need to be repeated for the unchanged launch code.
2. **Listening/Jam check:** relaunch and spend at least 10–15 minutes jamming.
   Confirm audible stereo; try all five synths/patches, notes/glide, FX and
   transitions. Keep Kick/Bass, compare variations at all intensities using A/B,
   try verbs/macros/Chaos, promote a scene and save/reopen. Report usefulness/fun,
   unwanted clicks/pops, level surprises, dropouts or sluggishness.
3. **Input check:** select a known working microphone/input and make deliberate
   speech or instrument sound. Confirm input meter movement, test monitoring
   with suitable listening setup, record Capture, Keep as Sample and play it.
   Check simultaneous project recording for unintended input/preview leakage.

These are observations requiring the user's eyes, ears and physical input;
they are not requests for authorization to make further feature changes.

## Evidence and repository hygiene

The final review reran `npm test` (production build; 374 passes, nine Linux-only
skips, zero failures), both typechecks, the native Tidal and sclang compiler
checks, native Studio and Windows System lifecycle checks, the real-audio P5
horizontal journey, and P3/P3.5A/P3.5B/P4/P5 browser journeys. All passed. The
lifecycle watcher again recorded zero console-show events. The final native P5
take was stereo 48 kHz, 3.594667 seconds, PCM peak 10969, with no browser errors.
Logs use the `review-` prefix; its result is `review-native-p5.json`.

Critical diff review checked package exposure before Tidal stream creation,
Haskell layout/comment preservation and negative arguments, strict clock markers,
SC queue/ACK/routine/error and file-lifetime behavior, and regression assertions.
No additional defect was found. Ownership, recording routes, persistent runtime
semantics, installed dependencies and Linux process-management code are unchanged.
The normal runtime's current project was preserved as
`projects/pre-acceptance-review-20260907-220443.abx.json` before graceful Quit.
All final native harnesses finished with owned audio ports released; the normal
runtime was left stopped. `git diff --check` passed. The commit is restricted to
the reviewed fixes, tests and documentation; historical generated evidence is
restored, and no local music or configuration is included.

Raw logs, scripts, projects, WAVs, machine inventory and native screenshots are
kept locally in ignored `.abx-recovery/windows-acceptance-20260907/`. Principal
files: `npm-test-baseline.log`, `npm-test-fix5.log`, `typecheck-final.log`,
`browser-*.log`, `final-*-selftest.log`, `native-product.json`,
`native-sampling-code.json`, `native-managed-code.json`, `native-capture.json`,
`native-mcp.json`, `native-p5.json`, and `p4-native-full.log`.

Regenerated historical tracked screenshots/JSON are copied into that evidence
directory and restored in Git. Personal recordings/configuration are not staged.
The reviewed source/tests and documentation are the acceptance commit's scope;
personal music, machine inventories and generated historical files are excluded.
Linux-only tests are skipped on Windows: portable coverage passed here, but no
new Linux native validation is claimed. Finish the unresolved human checks and
resolve any resulting defects before changing full acceptance or beginning the
stacked-PR merge process. Committing/pushing this partial acceptance evidence
does not authorize a merge or imply the remaining gates passed.
