# Contributing

Thanks for wanting to hack on Astro's Beatbox! It's a small, friendly codebase.

## Project layout

```
mcp/
  src/
    server.ts     MCP/HTTP adapters + launch/shutdown wiring
    application.ts serialized commands, acknowledged legacy rig state and retry cache
    commands.ts   shared command validation and result contract
    protocol.ts   interpreter frames, in-action acknowledgements and diagnostics
    owned-process.ts Windows creation identities + verified descendant cleanup
    engine.ts     owns the SuperDirt + Tidal processes, boot/reboot, device enum
    sclang.ts     drives headless sclang (SuperCollider)
    tidal.ts      drives ghci (TidalCycles)
    proc.ts       owned process driver, framed queue, timeouts and live faults
    meter.ts      UDP listener for live level / spectrum / hit data
    dashboard.ts  tiny HTTP server (serves dashboard.html, /state, /cmd, /sets, /samples)
    config.ts     all paths/ports (auto-detected, env-overridable)
  dashboard.html  retained classic UI (vanilla JS, no frontend build step)
  studio/src/     React instrument UI, contextual inspector and gesture drafts
  studio-dist/    generated Vite assets, served at /studio by dashboard.ts
  src/studio-client.ts  disposable server snapshot subscription + guarded commands
  src/studio-starter.ts curated P0b edit intention, no independent music model
sc/superdirt_startup.scd   SuperCollider boot (headless-safe; reads audio_device.txt)
tidal/BootTidal.hs         Tidal boot script
sets/*.tidal               saved jams
```

## Dev workflow

Use **Node 24.14.0 / npm 11.9.0** (`.nvmrc`) and `npm ci` in `mcp`.
The frontend pins React 19.2.8, Vite 8.2.2, TypeScript 5.9.3 and the React plugin
6.1.1. `npm run build` builds server and studio; `npm run typecheck` checks both.
Outfit and DM Sans are bundled locally, with no font CDN dependency.

- **Studio changes:** `npm run build`, then refresh `/studio`. For hot reload,
  keep the normal application running and use `npm run dev:studio`; Vite proxies
  `/state`, `/cmd`, `/clock` and `/projects` to `127.0.0.1:3737` (override with
  `TIDAL_DASH_PORT`). Vite is development-only. Production uses the existing service.
- **Studio browser regression:** `npm run selftest:studio` checks the built frontend
  in Chromium against real project/storage services, fake audio, the classic UI,
  and a real MCP stdio server. Screenshots go to `docs/p1-studio-*.png`.
- **Studio live proof:** `npm run selftest:studio:live` uses Chromium and real owned
  engines to test starter playback, rhythm application, Undo, Save/reopen, recording
  and Pause. Run all audio selftests sequentially; they refuse occupied ports.
- Read [the P1 report](docs/p1-studio.md) before extending the studio. React holds
  input drafts and selection only; do not introduce a second authored document.

- **Dashboard-only change** (anything in `dashboard.html`): it's served fresh per request —
  just **refresh the browser**. No build, no reconnect.
- **Server change** (`src/*.ts`): `npm run build`, then **reconnect** the MCP server in your
  client (Claude Code: `/mcp` → reconnect). Close the previous connection first. EOF and
  normal shutdown release owned engines; new instances refuse occupied ports and never
  evict their owners. A forced termination may require manual cleanup.
- **Automated tests:** `npm test` builds first; `npm run typecheck` checks types separately.
- **Smoke test the whole chain:** `npm run selftest` (boots SuperDirt + Tidal and plays a beat).
- **P0a runtime regression:** `npm run selftest:p0a` checks command errors, Stop/Play,
  save/load, non-silent WAV recording, retries, timeout quarantine and Reset. It uses
  a temporary directory and refuses occupied ports.
- Read [the P0a command contract](docs/p0a-command-boundary.md) before changing acknowledgements or lifecycle code.
- **P0b audio regression:** `npm run selftest:p0b` verifies the compiler, arrangement,
  persistent channel stage, sustained stereo audio, level, balance, mute/solo, route
  isolation, complete save/reopen and undo/redo using owned Windows engines.
- **Existing dashboard browser test:** run `npx playwright install chromium`, then
  `npm run selftest:browser`. This runs real Chromium pointer gestures against the
  real project service with a fake audio engine. `ABX_CHROMIUM` can select an existing
  Chromium executable. It writes `docs/p0b-dashboard-validation.png`.
- Read [the P0b project contract](docs/p0b-project-model.md) before adding musical
  state or editing controls. Browser caches and telemetry must not become authored
  state. Complete saves use `.abx.json`; `.tidal` files remain source artifacts.

## Gotchas worth knowing

- **Headless SuperCollider** must schedule on `SystemClock` (not `fork`/`AppClock`, which don't
  tick when spawned by Node). See `superdirt_startup.scd`.
- **No `var` inside a top-level `( )` block** in `.scd` files — it breaks the whole file's
  compile. Use environment vars (`~x`).
- **WASAPI**, not ASIO/FlexASIO — ASIO's callback needs a message pump a Node-spawned process
  lacks, so the DSP freezes. Pick a `Windows WASAPI : <output>` device.
- **Echo-proof ready markers** — sclang echoes piped stdin, so readiness strings are assembled
  at runtime in the `.scd` so they can't match the echo.
- Drive sclang by writing `code\n\x0c\n` (form-feed) to stdin; drive ghci line-by-line,
  wrapping multi-line blocks in `:{ … :}`.

## Pull requests

1. Fork & branch off `main`.
2. Keep changes focused; match the surrounding style.
3. For server changes, confirm `npm run build` is clean and `npm run selftest` still plays.
4. Describe what you changed and how you verified it.

Issues and ideas welcome too — open one on GitHub.
