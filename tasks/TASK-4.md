# P4 — Jam & Exploration

Authorized scope: P4 only, on `feat/p4-jam-exploration`, starting at exact
`63d99d0f61fc62f1430db8abebb60f540f90b164`. Stacked draft PR targets
`feat/p3.5b-capture-sampling`, never main. Do not merge lower drafts or begin P5.

Implementation and available Ubuntu validation: **complete**. Physical/native
musical-quality and Windows acceptance: **pending**, including all inherited gates.
See [the complete architecture, validation and exit report](../docs/p4-jam-exploration.md)
and [machine-readable results](../docs/p4-validation.json).

The delivered scope includes canonical seeded variations/Chaos, source capabilities,
Keep/Change and persisted locks, intensity, bounded Original/variation/favorite
history, A/B/return/branch, scene promotion, seven semantic musical verbs, bounded
project macros and software assignments, separate automation/modulation/native
macro offsets, Studio Jam quick starts/play surface, bench pins, optional suggestions,
canonical Fill, bounded performance event notebook, MCP and persistence/recovery.

Explicit limits: gestures commit on release; synth macro changes affect new notes;
scene clips are independent while instruments/FX/macros remain shared; session ideas
require project Save for disk retention; the performance notebook has no replay or
arrangement conversion. Temporary moment/stutter/drop events are deferred rather
than browser-timed. No LLM service, MIDI mapping, VST, collaboration, cloud sharing,
advanced mastering, packaging or native Linux installation was introduced.

Validation: preserve all P0a–P3.5B tests, add lock/determinism/bounds/history/macro/
coexistence/source/capture/persistence tests, run the complete suite/build/two
typechecks, all eight browser journeys, Linux runtime/lifecycle, inspect rendered
screenshots and the full diff. The test floor is 377.
