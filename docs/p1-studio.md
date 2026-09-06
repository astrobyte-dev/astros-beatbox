# P1 — Astro's Beatbox instrument interface

P1 introduces `/studio` alongside the classic dashboard at `/`. Both are served
by the existing local application and use the same P0a command queue and P0b
project service. P2–P5 have not been started.

## Baseline

Started from clean `e50942c` (completed P0b), following P0a `c03c545`. Read the
command, project, compiler, revision/history/storage, routing and adapter code,
their tests and the existing dashboard before editing. All **101 existing tests**
passed with no skips; server build/typecheck passed on Node 24.14.0/npm 11.9.0.
Inspected the P0b screenshot and ran the legacy Chromium journey. Its first run
hit a test timing race measuring a pad during a rerender; the rerun passed.

## Architecture

- React 19.2.8, TypeScript 5.9.3, Vite 8.2.2 and `@vitejs/plugin-react` 6.1.1,
  inside the existing `mcp` package. Node **24.14.0**, npm **11.9.0** are pinned in
  package metadata and `.nvmrc`; CI uses the same Node release. The lockfile pins
  dependencies; Playwright is pinned to 1.61.1.
- `studio/src/` contains the interface. `src/studio-client.ts` is a disposable
  server snapshot subscription and command adapter. The only project imports
  in browser code are TypeScript types. There is no browser project reducer,
  audio engine, music store, local musical persistence or code compiler.
- `npm run build` compiles the existing server and emits Vite assets to ignored
  `mcp/studio-dist/`. `dashboard.ts` serves `/studio`, `/studio/` and strictly
  matched generated assets under the existing loopback guard and CSP. Unknown
  studio assets return 404; request paths cannot resolve arbitrary files.
- Production needs one HTTP service. Optional `npm run dev:studio` proxies the
  four existing API routes to the normal application on port 3737, configurable
  with `TIDAL_DASH_PORT`.
- [React's external-store subscription](https://react.dev/reference/react/useSyncExternalStore)
  renders acknowledged snapshots. Polls wait for the previous read and run again
  after 600 ms. Outdated HTTP responses are ignored. Commands trigger a fresh
  read, carry session/operation/project/revision metadata, and are not retried
  automatically after uncertain network outcomes. One command is submitted at a
  time, with explicit pending feedback.
- Fast `/clock` SSE updates an imperative playhead. Meter/scope/wave/hit fields
  are excluded from React's subscription. Project reference identity is retained
  between revisions. Pause, clock loss and stale telemetry hide the playhead.
- Local React state is selection, panel visibility, dialogs and short-lived input
  drafts. Paint and slider drafts keep their starting project, session and
  revision. External changes reject those drafts rather than rebasing them.
  Reopening the same saved project also invalidates old drafts through P0b's
  monotonic revision. Save/Open/New and Undo/Redo use the existing API unchanged.

See [Vite's build/tooling documentation](https://vite.dev/guide/) and the retained
[P0a](p0a-command-boundary.md) / [P0b](p0b-project-model.md) contracts.

## Visual and interaction decisions

Warm ivory surfaces, deep ink structure, cobalt actions and coral/butter/mint/lilac
instruments replace the Matrix presentation in `/studio`. Outfit display text and
DM Sans UI fonts are bundled locally. CSS artwork supplies the groove sleeve and
instrument portraits. There are no external font requests or image services.

The top transport contains the project name, Play/Pause, tempo, existing Record,
meaningful Undo/Redo and Save. Preparation, connection and engine failures are
explicit. Diagnostics, audio-device selection and technical restart remain in
the classic interface. There is no existing master-volume command; supported
independent track levels/balance are exposed through a deliberate Mixer view.

Grooves, Sounds and My Jams have a stable left home. The only starter is **Pocket
groove**: kick, snare, hi-hat and clap at 108 BPM. It is one atomic `project.edit`,
undoable as one intention, and available only for empty projects. It does not
replace existing music. An already-running empty transport is paused before
preparing it. Opening the studio itself never starts playback.

Named tracks keep their identity/accent through selection, inspector and mixer;
the accent derives from the stable route, so reorder does not recolor tracks.
Pads toggle or paint a rhythm; one painted gesture is one history entry. Four-step
grouping and visible velocity marks retain useful legacy interaction knowledge.
The fixed inspector provides selected-step velocity, swing, tone and room.
Long rhythms scroll inside their lane, without widening the page.

Generated Tidal is discoverable in a read-only disclosure, taken from the server's
slot projection. Opaque code tracks retain their original code and expose no
pretend step/effect editing. Existing automation is reported and retained; its
editing remains in classic. If arrangement playback is active, a notice offers
the existing command to hear the active instruments instead.

Save uses complete `.abx.json` projects and a named local file, with explicit
replacement wording for an existing filename. My Jams opens those files. New
warns about saving and history reset. The Record entry uses P0a's acknowledged
record/finalize path and reports the existing recording result; there is no new
recording library or download workflow.

## Accessibility and layout

Native buttons and labelled fields/ranges, `aria-pressed` musical states, a skip
link, visible focus, status/error announcements and native modal focus containment.
Pads support Enter/Space, Left/Right and Home/End; each lane has a roving tab stop.
Velocity and swing are operable with arrow keys and do not require dragging,
right-clicking or scrolling. Pending pads/ranges retain keyboard focus while
blocking mutation. Save returns focus to its trigger. External project switching
or deletion moves focus to the stable workspace heading. Motion respects reduced
motion preferences; the playhead conveys live timing without decorative animation.

Rendered at 1280×900, 1440×1000 and 1920×1080. The inspector occupies a reserved
column, so opening controls does not shift the sequencer horizontally. Shorter
desktop viewports use tighter spacing; page scrolling keeps lower tools reachable.
Narrow layouts stack rather than overflow the whole page. Full touch/mobile and
assistive-technology audits remain later work; this is an accessible baseline,
not a claim of comprehensive WCAG certification.

## Validation

**107 automated tests pass, zero failed/skipped**, preserving all 101 baseline
tests. Build and both server/frontend type checks pass. The six new tests cover
the starter, snapshot/telemetry subscription, canonical rhythm and engine
projection, shared undo/redo and persistence, stale edits and same-file reopen,
response ordering/network uncertainty, and guarded production asset serving.

`selftest:browser` passes the retained classic journey. `selftest:studio` exercises
the real built frontend in Chromium with actual application/storage services and
fake audio, plus a real MCP stdio process:

- Starter snapshot, Play/Pause, keyboard toggles/navigation and pointer painting.
- Grouped history, velocity and mixing without rewriting pad dynamics.
- Focus through acknowledgement, modal focus/return and external track deletion.
- Track selection across revisions, read-only generated/opaque code.
- Stale pointer and held-slider rejection after an external revision.
- Save/New/Open/reload and bidirectional classic/studio updates.
- Actual MCP edits appearing in studio and studio Undo visible through MCP.
- No rhythm DOM mutation from clock/meter traffic; Pause clears the playhead.
- Three desktop widths, no page horizontal overflow, no JavaScript/CSP errors.
  The deliberate stale requests correctly return HTTP 409.

The in-app Browser connection reported no available browsers after its documented
discovery checks. Validation used the repository's standalone Playwright Chromium
fallback (Chrome for Testing 149), with its required browser installed locally.

Live checks ran sequentially against owned Windows SuperDirt/Tidal engines:

| Check | Result |
| --- | --- |
| Original audio chain | Passed; master L+R peak **0.604** |
| P0a runtime regression | Passed; meter **0.170**, WAV **389,932 bytes**, PCM peak **4,056**; faults, timeout/reset and ownership cleanup passed |
| P0b live mixing | Passed twice after fixture isolation; final held L/R **0.041/0.017**, quarter level **0.009/0.004**, left **0.037/0.000**, right **0.000/0.017**; mute/solo, route isolation, compiler, arrangement, persistence and history passed; owned ports released |
| P1 live Chromium journey | Passed; starter master L+R peak **0.356**; rhythm acknowledgement and evaluated Tidal events, Undo, Save/New/reopen, Record and Pause |
| P1 finalized recording | **436,268 bytes**, PCM data peak **8,046**, no JS/engine errors; owned ports released |

Screenshots were inspected, then spacing, pad labels, focus and status behavior
were revised. Evidence: [empty studio](p1-studio-empty.png),
[1280 desktop](p1-studio-1280.png), [1440 desktop](p1-studio-1440.png),
[1920 desktop](p1-studio-1920.png), [live saved/reopened session](p1-studio-live.png).

## Review fixes and limits

Browser/final review caught and fixed a native fetch binding error, invalid HTML
pattern syntax, focus lost when pads became disabled, a lingering imperative
playhead on Pause, a wrong development proxy default, polling starvation on slow
responses, and an empty starter inheriting live playback. The legacy browser test
now waits for its acknowledged revision to render before measuring pads. The live
studio fixture now sets its temporary storage environment before importing config.

The P0b held-sine test intermittently failed stereo level thresholds. Inspection
of installed SuperDirt confirmed persistent modulated reverb from its preceding
`room=0.2` compiler exercise, which invalidates the assumption of a steady dry
input. Its test fixture isolates reverb output for the held probe and logs each
measurement; no thresholds or assertions are relaxed and production routing is
unchanged. Final results are recorded above.

Diff review and searches found no second authored music model, local musical
storage, arbitrary eval from studio, browser compilation or new audio routing.
The P0a command/process code and P0b schema/reducer/service/storage/compiler are
unchanged. Existing deeper functionality remains accessible in classic.

Remaining P1 limits: selection is editing context and resets on full page reload;
only one in-flight command is accepted; external changes appear on the next poll;
unsent drafts are not durable; the existing active-clip/arrangement distinctions
remain. Master volume, per-track scopes, sample audition/replacement, new scene
workflows, advanced automation/generation and recording retrieval are not added.
Human listening quality and every physical audio device were not assessed.
The dependency audit reports six existing MCP transitive advisories; this phase
does not update those unrelated backend dependencies.

## Files

Added: `mcp/studio/` (HTML, App, TrackLane, controls, session subscription, main and
styles), `mcp/src/studio-client.ts`, `studio-starter.ts`, `studio.test.ts`, Vite and
frontend TypeScript configs, `studio-selftest.mjs`, `studio-live-selftest.mjs`,
`.nvmrc`, this report and five screenshots.

Modified: static serving in `mcp/src/dashboard.ts`; package/lock/test runner; CI;
README/CONTRIBUTING; `.gitignore`; two existing test-fixture waits/isolation fixes.

## Exit criteria

All functional P1 criteria are implemented and exercised: application-served
`/studio`, new identity, retained classic UI, canonical named tracks, managed
playback/rhythm editing reaching the engine, Undo, complete Save/reopen, external
revision synchronization, keyboard baseline and rendered browser validation.
P0a and P0b regression checks pass, including the real engine tests and owned-port
cleanup. **P1 exit criteria are met.** No P2 implementation is included.
