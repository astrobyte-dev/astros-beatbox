# Astro's Beatbox 🎛️

A free, **code-first live-coding music rig** for Windows — describe a beat in plain English (or click it out) and it's playing in seconds, no DAW required.

**Stack:** [TidalCycles](https://tidalcycles.org/) (pattern language) → [SuperCollider](https://supercollider.github.io/) / SuperDirt (synthesis) → WASAPI audio, driven headless by a custom **MCP server** (TypeScript) with a Matrix-themed **web dashboard**.

## What's in here
- `mcp/` — the MCP server (TypeScript) + `dashboard.html` (the web UI)
- `sc/` — SuperCollider startup (`superdirt_startup.scd`) + test scripts
- `tidal/` — `BootTidal.hs` (Tidal boot script)
- `sets/` — saved jams (`*.tidal`)
- `fullchain_test.ps1` — end-to-end boot/sound smoke test

## Dashboard features
Live d1–d16 layer cards, real-time meter + wavelength-coloured spectrum, a step sequencer (channel rack), per-channel modulation curves, sample browser, save/load sets, record-to-WAV, an audio-device switcher, "Set Loop" freeze-to-channel, keyboard shortcuts, a built-in cheat sheet, and a loop-progress bar + track timer.

## Setup (Windows)
Requires SuperCollider 3.14+ (with the SuperDirt, Vowel, Dirt-Samples and sc3-plugins quarks), GHCup + GHC + TidalCycles 1.10, and Node.js.

```sh
cd mcp
npm install
npm run build
```

Register `mcp/dist/server.js` as an MCP server (e.g. in Claude Code or Claude Desktop), call the `boot` tool, then open the dashboard at <http://127.0.0.1:3737>.

> **Note:** paths in `mcp/src/config.ts` and `sc/superdirt_startup.scd` are hard-coded for the author's machine (SuperCollider / GHCup install dirs, audio device). Adjust them for your own setup. The audio device can also be switched live from the dashboard.

## MCP tools
`boot` · `eval_tidal {code}` · `hush` · `eval_sc {code}` · `status`

```haskell
-- example pattern (paste into the dashboard console or eval_tidal)
do { setcps (140/60/4)
   ; d1 $ s "bd*4" # gain 1.1
   ; d2 $ s "~ cp" # room 0.2
   ; d3 $ s "hh*16" # gain 0.4 # pan rand
   ; d4 $ note "<c2 af1 g1 bf1>" # s "supersaw" # cutoff 600 # legato 1 }
```

---
🤖 Built collaboratively with [Claude Code](https://claude.com/claude-code).
