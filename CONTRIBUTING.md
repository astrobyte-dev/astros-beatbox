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
  dashboard.html  the entire web UI (vanilla JS, no build step)
sc/superdirt_startup.scd   SuperCollider boot (headless-safe; reads audio_device.txt)
tidal/BootTidal.hs         Tidal boot script
sets/*.tidal               saved jams
```

## Dev workflow

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
