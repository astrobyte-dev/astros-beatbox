# Contributing

Thanks for wanting to hack on Astro's Beatbox! It's a small, friendly codebase.

## Project layout

```
mcp/
  src/
    server.ts     MCP tools + dashboard /cmd handler + /state
    engine.ts     owns the SuperDirt + Tidal processes, boot/reboot, device enum
    sclang.ts     drives headless sclang (SuperCollider)
    tidal.ts      drives ghci (TidalCycles)
    proc.ts       base child-process driver (stdout buffer + waitFor marker)
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
  client (Claude Code: `/mcp` → reconnect). Reconnect kills the old engine, so reconnect
  *once* — don't stack instances (they fight over port 3737 + the audio device).
- **Smoke test the whole chain:** `npm run selftest` (boots SuperDirt + Tidal and plays a beat).

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
