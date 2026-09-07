# P3.5A — Sound Lab Core

Authorized 2026-09-07. Branch `feat/p3.5a-sound-lab-core` starts at exact P3
commit `7f5971ab603c33f893071839c5880b57ed8569f1` and targets
`feat/p3-composition-performance` as an unmerged draft dependency.

Implement an approachable sound playground in Studio: canonical synth sources,
a small reusable instrument collection, tactile accessible controls, note patterns,
serial insert FX, engine-owned modulation, local patches, scenes, history,
persistence/recovery and structured MCP operations. ProjectService remains the
only authored authority; SuperCollider/SuperDirt remains the only synthesis engine.

Implementation and available portable validation are recorded in
[the completion report](../docs/p35-sound-lab-core.md). Native synthesis, sound
quality, timing, CPU and Windows desktop/audio acceptance remain pending.
P2.6 remains Ubuntu Runtime Safe with Windows revalidation pending; P3 remains
implementation complete with native audio/timing acceptance pending.

## Boundaries

- Preserve source → source processing → insert FX → channel mixer → master.
- Track-level instruments, patches and racks; clip-level notes and musical events.
- Smooth sound modulation belongs in scsynth, separate from P3 event automation.
- Retain revisions, retry metadata, grouped history and checksummed recovery.
- Unknown definitions/versions retain authored state and never substitute a sound.
- No changes to audio configuration, system packages, kernel state or native audio
  installation. No Windows acceptance inferred from Linux or CI.
- No P3.5B capture/import/input, P4 Jam/generation/macros, or P5 packaging work.
- Commit and push only this branch; draft PR targets P3, never main; do not merge.

## Available validation

Pinned Node 24.14.0 / npm 11.9.0, in `mcp`:

```sh
npm test
npm run typecheck
node p35-selftest.mjs
node browser-selftest.mjs
node studio-selftest.mjs
node p2-selftest.mjs
node p3-selftest.mjs
node system-selftest.mjs
node linux-runtime-selftest.mjs
```

Browser and application engines are deterministic fixtures. Source/contract checks
are not native SuperCollider/Tidal compilation or acoustic validation. Preserve
historical milestone screenshots after regression harnesses regenerate them.
