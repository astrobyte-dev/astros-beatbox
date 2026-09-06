# P2.5 silent-take investigation

P2.5 is complete and accepted on 2026-09-07. P3 has not started. The user
confirmed real Windows Studio launch in Opera GX, the expected browser request,
zero console-show events, and preservation of the existing runtime/session.
This acceptance is real launcher/default-browser evidence, not just a unit test.
The original silent take remains unexplained; acceptance does not imply a proven
root-cause fix.

## Original evidence and limits

The original local failure log is excluded from Git; its essential evidence is
transcribed here so the investigation does not depend on that machine. Take
`9d41783f-bbed-44de-a7d9-dd74fcdf75da` began at 2026-09-06 12:57:07.757 UTC and
finished at 12:57:10.391 UTC. Its finalized stereo PCM16 WAV had 120,192 frames,
48 kHz sample rate, duration 2.504 seconds, 480,812 bytes, and exactly zero peak
and RMS. SHA256: `d3309c925a62c10defe8ba98995e2e3e312634a0aff7f15db029c20734882555`.
The original test deleted its temporary directory, so that failed WAV cannot be
re-examined. No contemporaneous meter history or interpreter tail was saved.

The snapshot had engine generation 0, ready/no error, playback active, project
revision 7 matching applied revision 7 and applied generation 0, matching project
identity, no queued work, and Preview idle. This was the direct Application/Engine
browser fixture, not a disposable MCP-owned engine. Browser reload did not change
generation. Three immediate P2 repeats passed before this investigation.

The later legacy rig on TCP 3737 was started at 13:02:07 UTC, after the failed take;
that identified instance does not explain the earlier failure. During this followup
it occupied the audio ports too. The user explicitly authorized stopping it. Its
status reported recording=false; its exact PID/creation identity and descendant
handles were verified before termination. The ports were then free.

## Path review

| Path | Finding |
| --- | --- |
| Runtime ownership/reconnect | P2's sole persistent runtime remains unchanged. MCP and browser sessions do not own the recorder. The original failure had no generation change. |
| Boot/readiness | Boot awaits SuperDirt, the actual Tidal binding, channels, master/tap/Preview, scope and server acknowledgements. This proves preparation, not that future Tidal events will produce useful audio. Recording while stopped must remain possible. |
| Routing/order | SuperDirt orbit output buses feed twelve channel synths, then the limiter/master meter and project tap. Preview is a later group writing physical bus 0. The recorder remains at the root tail reading the dedicated project bus. Preview stop frees only children of its own group. |
| SC bus semantics | `In.ar` reads audio produced earlier in the current server block. Incorrect node order can produce silence. No application path in this journey was found moving the recorder before its tap. See the [SC In reference](https://doc.sccode.org/Classes/In.html). |
| Mixer/sample state | Managed project switches force all twelve channel levels/balances and pattern slots through acknowledged commands. Mixer level/balance lag is 20 ms, far shorter than this 2.504-second take. The installed DirtOrbit setter rebuilds orbit effects; scope setup completes before ready. Exact saved sample identity is checked before application. |
| New/load/Undo/Redo | The project commits only after engine application; failures mark synchronization uncertain. Save/new/load retain playback state. Tidal pattern/tempo acknowledgements complete IO actions; they do not acknowledge individual scheduled audio events. |
| Lifecycle | Recording finalization precedes hush, Preview teardown, engine stop/restart and Quit. The common queue blocks new work during lifecycle changes and checks generation before executing queued commands. |
| Recorder | Buffer allocation, disk open, writer creation and finalization use server barriers. Correct file size/header/frame count establish a finalized PCM file, not musical content. The failed file's frame count shows samples were written; it does not prove nonzero audio reached DiskOut. |
| Test timing | The P2 journey records for roughly one 108-BPM cycle after opening a saved project. Its nonzero assertion was correct. The investigation retains immediate starts and adds repeated switches at different delays, instead of waiting for nonzero audio before Record. |

No root cause for the original silent take has been established. Remaining
plausible categories are a Tidal scheduling/event-delivery interruption after the
rapid project changes, or a transient SuperDirt/channel/tap state producing zero
audio despite prepared interpreters. A recorder receiving zeros on a wrong or
inactive bus can also make a valid WAV, but no application path causing that was
found. These are hypotheses, not diagnoses. A complete frozen DSP is less
consistent with the full-length PCM data than a silent upstream path. The evidence
does not distinguish the remaining categories.

## Changes made during this investigation

- Each take saves optional backward-compatible diagnostics in its existing
  `.recording.json` sidecar: session/operation identity, project/applied revisions
  and generation, transport, tempo, mixer, Preview state, start/finish times,
  routing node/bus IDs, and a bounded 32-event command history (no code payloads).
- A dedicated recorder synth reads the same signal for DiskOut and an independent
  cumulative audio-rate input peak. A control bus records that peak and DSP elapsed
  time. Finalization freezes the measurement by stopping the writer before reading
  it. This adds no audio output, node movement, project-bus reuse, or Preview routing
  changes. Peak behavior follows the [SC Peak reference](https://doc.sccode.org/Classes/Peak.html).
- Counts of received Tidal `/dirt/play` events are captured at recorder start and
  final probe. These count received events, not guaranteed audible onsets, and the
  final count is observed just after writer finalization.
- Probe replies carry the take ID; delayed replies cannot confirm another take.
  A timed-out diagnostic control bus remains reserved until its own reply or
  engine reset, avoiding reuse under a delayed reply. Missing diagnostics are
  explicitly `unavailable` and do not block a structurally valid take.
- Runtime recording logs identify the take, generation/revision, route, frames,
  PCM peak/RMS and independent input result. The sidecar persists beyond reconnect
  and Quit; the runtime log is a bounded recent-history view.
- Zero-PCM takes remain ready, playable and downloadable. Studio labels them
  **Silent WAV saved**, not **Ready to keep**. Active playback gets a conditional
  review warning; disagreement between nonzero recorder input and zero PCM gets
  a specific investigation warning. Silence itself is never globally rejected.
- Studio Record now pins the displayed project/revision and generation. A legacy
  Record queued behind a project switch is rejected rather than recording the new
  project. Requests are rechecked for expiry at execution. Expired Quit restores
  its previous admission state. These are separately verified stale-command gaps;
  they are not claimed as the original failure's cause.
- The live P2 test now preserves the failing WAV, sidecar, project fixture, bounded
  50-ms meter/orbit/clock history, state, and interpreter tails before cleanup.
  The new ordering harness captures the same evidence at 25 ms. Evidence lives
  under `recordings/p25-investigation/`; pass summaries are copied into docs.
- Expected-musical live tests require nonzero actual PCM, nonzero recorder input,
  and advancing DSP. The ordering harness additionally requires an independent
  fresh project-master signal. Preview-only validation requires exactly zero at
  both recorder input and PCM while physical Preview output is nonzero.

The first development run caught an invalid SC array maximum in the new probe;
the next caught a diagnostic marker sharing the interpreter prompt line. Both
were corrected before final repeated validation. Those were instrumentation
failures with explicit test failures, not reproduction of the unexplained P2 take.

## Validation

All final runs passed. Full values, take hashes and per-scenario peaks are in
[p25-investigation-validation.json](p25-investigation-validation.json). Raw take sidecars and runtime process inventories stay local;
[portable Windows evidence](p25-windows-validation.json) is included in Git.

| Check | Result |
| --- | --- |
| Recording/audio/application/mixer/DSP/protocol tests | 91 passed per run, three consecutive runs; no skips |
| Complete automated suite | 157 passed, zero failed/skipped; original 124 retained |
| Immediate-transition live harness | Three final runs, 39 takes: 30 expected musical takes nonzero; nine intentional-silence takes preserved; independent input/DSP/master evidence passed |
| P2 live browser + Preview isolation | Three consecutive passes; musical take peaks 8,035 / 8,034 / 8,033; Preview physical peak 21,299 in each; project WAV and recorder input exactly zero during Preview-only capture |
| Persistent MCP/browser reconnect | Same session/generation and active recorder; master peaks 0.222 / 0.248 / 0.216; spanning take 6.023 seconds, peak 8,047 |
| P2.5 Windows lifecycle | Launch, reuse, restart audio/services, stop, active-recording Quit, verified process/port cleanup, and relaunch passed |
| Native console observer | Zero console-show events; user confirmed real Windows acceptance on 2026-09-07 |
| Browser regression checks | Legacy dashboard, Studio, P2 fake journey and System passed; no JS/CSP errors |
| Build and typechecks | Production build and both server/Studio typechecks passed |
| Final diff review | Reviewed recorder, queue, generation, ownership, lifecycle, status/log and UI changes; whitespace check passed; no dependency changes or P3 work |

Two earlier successful timing runs added 26 exploratory takes before final probe
correlation hardening. They are retained in local evidence but are not included in
the 39 final takes above. The two explicit instrumentation-development failures
are retained too. None is represented as a passing run or as the original silent
take reproduced.

If silence recurs, keep its WAV and adjacent `.recording.json`, and copy System's
recording/SuperCollider/Tidal logs before restarting. The input peak versus PCM
peak identifies whether nonzero signal reached DiskOut; DSP time and event-count
changes help separate upstream event/routing silence from a recorder discrepancy.
The recorded identities and contexts reveal generation/revision/mixer transitions.
This is substantially better evidence, but it cannot retrospectively prove what
happened in the original take. The intermittent defect remains unexplained.

## Human console-flash checklist (acceptance completed)

Retained for validation on the next Windows laptop. The final Opera GX launcher
check was accepted by the user on 2026-09-07.

Watch the desktop and taskbar throughout, including several seconds after each
action. A brief black console, Command Prompt, PowerShell or Windows Terminal
window counts as a flash. Browser windows and Beatbox confirmation dialogs are
expected. No terminal commands are needed for this check.

1. Double-click **Launch Beatbox.vbs** in this repository. In Studio, open a jam
   (or start Pocket groove) and press **Play**. Wait until you hear music.
2. Double-click **Launch Beatbox.vbs** again while music plays. Confirm it reports
   the existing instance and music continues.
3. In Studio press **Record**, wait three seconds, open **System**, choose
   **Restart audio**, and confirm. Wait for completion and resumed music.
4. Choose **Stop audio** and confirm. Wait for completion and silence.
5. Choose **Restart services** and confirm. Open Studio, press **Play**, return
   to System, and repeat **Restart services** while music is playing.
6. Open Studio, press **Record**, wait three seconds, then use System →
   **Quit Astro’s Beatbox** and confirm. Wait for the closed confirmation.
7. Double-click **Launch Beatbox.vbs** once more, press **Play** in Studio, then
   use System → **Quit Astro’s Beatbox** again.

For a new-machine replay, report **no flashes in steps 1–7**, or identify the
step, window and approximate timing of any flash. The current milestone
acceptance was explicitly confirmed by the user; do not treat automated
observation alone as a replacement for future human checks.
