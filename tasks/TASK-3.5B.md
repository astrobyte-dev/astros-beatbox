# TASK-3.5B — Capture & Sampling Lab

Status: implementation complete; native input/audio and Windows acceptance pending.
Approved branch: `feat/p3.5b-capture-sampling`.
Exact starting head: `3ea7f7b4441bdd456c83699f9a170c9e6c9a56d9`.
Draft PR base: `feat/p3.5a-sound-lab-core`; do not merge.

Deliver user WAV import/library, immutable portable audio identity, cached waveforms,
trusted previews, nondestructive sample playback, a bounded loop/chop workflow,
explicit input/monitoring and safe capture → Keep as Sample. Reuse canonical project,
command, FX, scene, automation, persistence and MCP architecture.

[Full implementation, validation, exit criteria and limitations](../docs/p35b-capture-sampling.md).
[Validation summary](../docs/p35b-validation.json).

Available validation: 304 tests (301 pass, three Windows-only skips), production
build and both typechecks, all seven browser journeys and Linux runtime lifecycle.
The creative capture workflow uses deterministic fixtures and real Studio/HTTP/MCP;
it is not proof of physical microphone/audio behavior.

P2.6 Windows desktop/audio, P3 native timing/audio/Windows and P3.5A native
audio/timing/CPU/Windows gates remain open. P3.5B native input/audio/Windows remains
open too. No system package/toolchain/audio configuration changes. P4/P5 not started.
