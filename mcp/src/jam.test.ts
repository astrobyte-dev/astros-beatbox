import { fixtureWav } from "./sampling-test-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Application, type CommandEngine } from "./application.js";
import {
  emptyProject,
  applyEdits,
  clone,
  validateProject,
  type ProjectDocument,
  type StepClip,
} from "./project.js";
import { pocketGroove } from "./studio-starter.js";
import { addSynth } from "./sound-lab-edits.js";
import { definition, defaults } from "./sound-lab.js";
import {
  jamCapabilities,
  macroOffset,
  type VariationRequest,
  type JamScope,
} from "./jam-model.js";
import {
  makeVariation,
  applyVerb,
  suggestedMacros,
  promoteJam,
} from "./jam.js";
import { ExplorationTrail } from "./project-service.js";
import { encodeProject, decodeProject } from "./project-storage.js";
import { rackCommand, SOUND_LAB_SYNTHS } from "./sound-lab-engine.js";
import { compileClip, compileArrangement } from "./project-compiler.js";
import { fxAutomationTargets } from "./fx-automation.js";
import { sceneProjection } from "./performance.js";
const fx = (id = "verb_fx", definitionId = "reverb") => ({
  id,
  definitionId,
  version: 1,
  enabled: true,
  values: defaults(definition("effect", definitionId)!),
});
function fixtureProject() {
  let p = emptyProject();
  p = applyEdits(p, pocketGroove(p));
  p = applyEdits(p, addSynth(p, p.sceneOrder[0]));
  const t = p.tracks.at(-1)!;
  p = applyEdits(p, [
    { type: "fx.put", trackId: t.id, effect: fx() },
    { type: "fx.put", trackId: t.id, effect: fx("dirty_fx", "distortion") },
    {
      type: "modulation.put",
      trackId: t.id,
      route: {
        id: "jam_motion",
        target: "synth.cutoff",
        source: "lfo",
        rate: 2,
        amount: 0.2,
        enabled: true,
      },
    },
    {
      type: "automation.put",
      automation: {
        id: "jam_auto",
        trackId: t.id,
        clipId: t.activeClipId,
        parameter: "synth.cutoff",
        bars: 2,
        values: [0.2, 0.8],
        enabled: true,
      },
    },
  ]);
  return p;
}
const request = (
  p: ProjectDocument,
  changes: Partial<VariationRequest> = {},
): VariationRequest => ({
  seed: 42,
  intensity: "fresh",
  operation: "variation",
  trackIds: p.tracks.map((t) => t.id),
  scopes: ["rhythm"],
  ...changes,
});
function lock(
  p: ProjectDocument,
  trackId: string,
  scopes: JamScope[],
  parameters: string[] = [],
) {
  p.jam ??= { locks: [], macros: [] };
  p.jam.locks = p.jam.locks.filter((l) => l.trackId !== trackId);
  p.jam.locks.push({ trackId, scopes, parameters });
  return p;
}
function macros(p: ProjectDocument) {
  p.jam ??= { locks: [], macros: [] };
  p.jam.macros = suggestedMacros(p);
  return p;
}
const steps = (p: ProjectDocument, trackId = p.tracks[0].id) =>
  p.clips.find(
    (c) => c.id === p.tracks.find((t) => t.id === trackId)!.activeClipId,
  ) as StepClip;
class FixtureEngine implements CommandEngine {
  generation = 0;
  running = false;
  state = "idle";
  error = null;
  calls: string[] = [];
  fail = "";
  async ensureBooted() {
    this.running = true;
    this.state = "ready";
  }
  async reboot() {
    throw new Error("Jam must never restart audio");
  }
  assertGeneration(g: number) {
    assert.equal(g, this.generation);
  }
  tidal = {
    eval: async (code: string, id = "fixture") => {
      this.calls.push(code);
      if (this.fail && code.includes(this.fail))
        throw new Error("Fixture failed");
      return {
        operationId: id,
        acknowledgement: "action" as const,
        output: code.includes("abxInstall") ? "ABX_SCHEDULED 3" : "",
      };
    },
    hush: async () => this.tidal.eval("hush"),
  };
  sclang = {
    eval: async (code: string, id = "fixture") => this.tidal.eval(code, id),
    evalRoutine: async (code: string, id = "fixture") =>
      this.tidal.eval(code, id),
  };
}
async function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-p4-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = new FixtureEngine(),
    app = new Application(engine, {
      sets: dir,
      recordings: path.join(dir, "rec"),
      projects: dir,
      recovery: path.join(dir, "recovery"),
      device: path.join(dir, "device"),
    });
  const send = (cmd: string, fields: object = {}) =>
    app.dispatchExternal({
      cmd,
      projectId: app.project.document.id,
      revision: app.project.document.revision,
      ...fields,
    });
  assert.equal((await send("jam.start", { starter: "groove" })).ok, true);
  return { app, engine, send, dir };
}

test("P4 seeded variation is repeatable and does not mutate input", () => {
  const p = fixtureProject(),
    before = clone(p);
  assert.deepEqual(makeVariation(p, request(p)), makeVariation(p, request(p)));
  assert.deepEqual(p, before);
});
test("P4 a different seed creates a different related rhythm", () => {
  const p = fixtureProject();
  assert.notDeepEqual(
    makeVariation(p, request(p)).document.clips,
    makeVariation(p, request(p, { seed: 902 })).document.clips,
  );
});
test("P4 seeded behavior is independent of track display order", () => {
  const p = fixtureProject(),
    reordered = applyEdits(p, [
      { type: "track.order", ids: p.tracks.map((t) => t.id).reverse() },
    ]);
  assert.deepEqual(
    makeVariation(p, request(p)).document.clips,
    makeVariation(reordered, request(p)).document.clips,
  );
});
for (const intensity of ["subtle", "fresh", "wild"] as const)
  test(`P4 ${intensity} keeps locked tracks byte-for-byte`, () => {
    const p = fixtureProject();
    lock(p, p.tracks[0].id, ["track"]);
    lock(p, p.tracks.at(-1)!.id, ["track"]);
    const result = makeVariation(p, request(p, { intensity }));
    for (const t of [p.tracks[0], p.tracks.at(-1)!]) {
      assert.deepEqual(
        result.document.tracks.find((n) => n.id === t.id),
        t,
      );
      assert.deepEqual(steps(result.document, t.id), steps(p, t.id));
    }
  });
test("P4 rhythm lock preserves velocities swing and pad placement during sound variation", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  lock(p, t.id, ["rhythm"]);
  const next = makeVariation(
    p,
    request(p, { trackIds: [t.id], scopes: ["rhythm", "sound"] }),
  ).document;
  assert.deepEqual(steps(next, t.id).steps, steps(p, t.id).steps);
  assert.equal(steps(next, t.id).swing, steps(p, t.id).swing);
});
test("P4 sound lock preserves source notes and sample playback during rhythm changes", () => {
  const p = fixtureProject();
  p.tracks.forEach((t) => lock(p, t.id, ["sound"]));
  const next = makeVariation(
    p,
    request(p, { scopes: ["rhythm", "sound"] }),
  ).document;
  for (const t of p.tracks) {
    assert.deepEqual(next.tracks.find((n) => n.id === t.id)!.source, t.source);
    assert.deepEqual(steps(next, t.id).notes, steps(p, t.id).notes);
    assert.deepEqual(steps(next, t.id).playback, steps(p, t.id).playback);
  }
});
test("P4 FX lock preserves effects and FX-targeted motion", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  t.modulation!.push({
    id: "fx_motion",
    target: "fx.verb_fx.mix",
    source: "lfo",
    rate: 1,
    amount: 0.3,
    enabled: true,
  });
  lock(p, t.id, ["fx"]);
  const next = makeVariation(
    p,
    request(p, { trackIds: [t.id], scopes: ["fx", "motion"] }),
  ).document;
  assert.deepEqual(next.tracks.at(-1)!.effects, t.effects);
  assert.deepEqual(next.tracks.at(-1)!.modulation![1], t.modulation![1]);
});
test("P4 selected parameter locks protect semantic targets", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  lock(p, t.id, [], ["synth.drive"]);
  const n = applyVerb(p, "dirt", [t.id]).document;
  assert.equal(n.tracks.at(-1)!.source!.type, "synth");
  assert.deepEqual(n.tracks.at(-1)!.source, t.source);
  assert.notDeepEqual(n.tracks.at(-1)!.effects, t.effects);
});
test("P4 explicit scope changes no unselected entity", () => {
  const p = fixtureProject(),
    id = p.tracks[2].id;
  const next = makeVariation(p, request(p, { trackIds: [id] })).document;
  const expected = clone(p);
  expected.clips[2] = next.clips[2];
  assert.deepEqual(next, expected);
});
test("P4 subtle rhythm changes at most one pad on a 16-pad clip", () => {
  const p = fixtureProject(),
    next = makeVariation(p, request(p, { intensity: "subtle" })).document;
  assert.equal(
    steps(p).steps.filter((v, i) => v !== steps(next).steps[i]).length,
    1,
  );
});
test("P4 wild permits more changes while preserving the anchor", () => {
  const p = fixtureProject(),
    next = makeVariation(p, request(p, { intensity: "wild" })).document;
  assert.ok(
    steps(p).steps.filter((v, i) => v !== steps(next).steps[i]).length > 1,
  );
  assert.equal(steps(next).steps[0], steps(p).steps[0]);
});
test("P4 deliberate silent clips stay silent at maximum Chaos", () => {
  const p = fixtureProject();
  steps(p).steps.fill(0);
  const n = makeVariation(
    p,
    request(p, { intensity: "wild", operation: "chaos" }),
  ).document;
  assert.deepEqual(steps(n).steps, steps(p).steps);
});
test("P4 wholly silent or wholly kept transformations reject with no change", () => {
  const p = fixtureProject();
  p.tracks.forEach((t) => lock(p, t.id, ["track"]));
  assert.throws(() => makeVariation(p, request(p)), /Nothing eligible/);
});
test("P4 unsupported unlocked scope rejects the entire transaction", () => {
  const p = fixtureProject();
  assert.throws(
    () => makeVariation(p, request(p, { scopes: ["fx"] })),
    /does not support fx/,
  );
});
test("P4 unknown and duplicate track/scope requests reject", () => {
  const p = fixtureProject();
  for (const changes of [
    { trackIds: ["missing"] },
    { trackIds: [p.tracks[0].id, p.tracks[0].id] },
    { scopes: ["rhythm", "rhythm"] as "rhythm"[] },
  ])
    assert.throws(() => makeVariation(p, request(p, changes)));
});
test("P4 managed and arbitrary code capabilities never offer rewriting", () => {
  const p = fixtureProject(),
    t = p.tracks[0];
  p.clips[0] = {
    id: t.activeClipId!,
    trackId: t.id,
    kind: "code",
    name: "Opaque",
    source: 's "bd*4"',
    managed: true,
    dependencyIds: [],
  };
  t.source = { type: "code" };
  t.effects = [fx("code_fx")];
  assert.deepEqual(jamCapabilities(p)[0].scopes, []);
  assert.throws(() => makeVariation(p, request(p)), /does not support/);
  lock(p, t.id, ["track"]);
  const n = makeVariation(p, request(p)).document;
  assert.deepEqual(n.clips[0], p.clips[0]);
  assert.deepEqual(n.sources, p.sources);
});
test("P4 unavailable synth definitions reject sound guesses", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  if (t.source?.type === "synth") t.source.version = 999;
  assert.equal(jamCapabilities(p).at(-1)!.source, "unavailable synth");
  assert.throws(
    () => makeVariation(p, request(p, { trackIds: [t.id], scopes: ["sound"] })),
    /does not support/,
  );
});
test("P4 sample sound changes retain asset identity trim reverse and source data", () => {
  const p = fixtureProject(),
    c = steps(p);
  c.playback = {
    start: 0.1,
    end: 0.8,
    reverse: true,
    pitch: 0,
    attack: 0.02,
    release: 0.3,
    mode: "loop",
    beats: 8,
  };
  const n = makeVariation(
    p,
    request(p, { trackIds: [p.tracks[0].id], scopes: ["sound"] }),
  ).document;
  assert.deepEqual(n.assets, p.assets);
  assert.deepEqual({ ...steps(n).playback, pitch: 0 }, c.playback);
  assert.notEqual(steps(n).playback!.pitch, 0);
});
test("P4 chop ordering uses stable existing slice IDs", () => {
  const p = fixtureProject(),
    c = steps(p);
  c.slices = [
    { id: "chop_a", name: "A", start: 0, end: 0.5 },
    { id: "chop_b", name: "B", start: 0.5, end: 1 },
  ];
  c.sliceSteps = c.steps.map(() => "chop_a");
  let changed = false;
  for (let seed = 0; seed < 20; seed++) {
    try {
      const n = makeVariation(
        p,
        request(p, {
          trackIds: [p.tracks[0].id],
          scopes: ["sound"],
          intensity: "wild",
          seed,
        }),
      ).document;
      assert.deepEqual(steps(n).slices, c.slices);
      assert.ok(
        steps(n).sliceSteps!.every((id) => ["chop_a", "chop_b"].includes(id!)),
      );
      changed = true;
    } catch (e) {
      assert.match(String(e), /Nothing eligible/);
    }
  }
  assert.ok(changed);
});
test("P4 variation bounds hold across 100 seeds including normalized effects and pitch", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  for (let seed = 0; seed < 100; seed++) {
    const n = makeVariation(
      p,
      request(p, {
        trackIds: [t.id],
        scopes: ["rhythm", "sound", "fx", "motion"],
        seed,
        intensity: "wild",
        operation: "chaos",
      }),
    ).document;
    validateProject(n);
    assert.ok(steps(n, t.id).notes!.every((n) => n >= 24 && n <= 84));
    assert.deepEqual(n.assets, p.assets);
    assert.deepEqual(n.automation, p.automation);
  }
});
test("P4 fill authors only final-quarter hits and respects rhythm locks", () => {
  const p = fixtureProject(),
    n = makeVariation(p, request(p, { operation: "fill" })).document;
  for (const t of p.tracks)
    assert.deepEqual(
      steps(n, t.id).steps.slice(
        0,
        Math.floor(steps(p, t.id).steps.length * 0.75),
      ),
      steps(p, t.id).steps.slice(
        0,
        Math.floor(steps(p, t.id).steps.length * 0.75),
      ),
    );
});
test("P4 verbs use signed semantic controls and keep safe bounds", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  t.effects!.push(fx("crushed", "crush"));
  const n = applyVerb(p, "dirt", [t.id]).document;
  assert.ok(
    n.tracks.at(-1)!.effects!.at(-1)!.values.bits <
      t.effects!.at(-1)!.values.bits,
  );
  assert.deepEqual(n.automation, p.automation);
  validateProject(n);
});
test("P4 brightness verbs are predictable inverses away from clamps", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  const open = applyVerb(p, "open", [t.id]).document;
  const dark = applyVerb(open, "dark", [t.id]).document;
  const source = dark.tracks.at(-1)!.source;
  if (t.source?.type === "synth" && source?.type === "synth")
    assert.equal(source.values.cutoff, t.source.values.cutoff);
});
test("P4 strip and build maintain an active anchor", () => {
  const p = fixtureProject(),
    ids = p.tracks.map((t) => t.id);
  const strip = applyVerb(p, "strip", ids).document;
  const build = applyVerb(strip, "build", ids).document;
  assert.equal(steps(strip).steps[0], 1);
  assert.equal(steps(build).steps[0], 1);
  assert.ok(
    steps(build).steps.filter(Boolean).length >
      steps(strip).steps.filter(Boolean).length,
  );
});
test("P4 summaries identify changed and kept instruments without source dumps", () => {
  const p = fixtureProject();
  lock(p, p.tracks[0].id, ["track"]);
  const s = makeVariation(p, request(p)).summary;
  assert.ok(s.kept.includes("Kick"));
  assert.ok(s.changed.includes("Hi-hat rhythm"));
  assert.equal(s.sourceRevision, p.revision);
  assert.equal(s.seed, 42);
  assert.ok(!JSON.stringify(s).includes("sclang"));
});
test("P4 unsupported verb does not fabricate a target", () => {
  const p = emptyProject();
  const groove = applyEdits(p, pocketGroove(p));
  assert.throws(
    () =>
      applyVerb(
        groove,
        "space",
        groove.tracks.map((t) => t.id),
      ),
    /Nothing eligible/,
  );
});
test("P4 macros map multiple targets by existing semantic metadata", () => {
  const p = macros(fixtureProject());
  const space = p.jam!.macros.find((m) => m.name === "Space")!;
  assert.ok(space.targets.length >= 2);
  assert.ok(space.targets.every((t) => t.parameter.startsWith("fx.verb_fx.")));
  assert.equal(space.value, 0);
});
test("P4 macro offset never overwrites base automation or modulation", () => {
  const p = macros(fixtureProject()),
    before = clone(p);
  p.jam!.macros.forEach((m) => (m.value = 0.8));
  const t = p.tracks.at(-1)!;
  assert.ok(macroOffset(p, t.id, "synth.cutoff") > 0);
  compileClip(p, steps(p, t.id));
  rackCommand(p);
  assert.deepEqual(p.tracks, before.tracks);
  assert.deepEqual(p.automation, before.automation);
  assert.deepEqual(p.clips, before.clips);
});
test("P4 synth compiler carries independent macro and modulation beside automation", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!;
  p.jam!.macros.forEach((m) => (m.value = 0.8));
  const body = compileClip(p, steps(p, t.id));
  assert.match(body, /pF "jcutoff" 0.28/);
  assert.match(body, /pF "mcutoffamount" 0.2/);
  assert.match(body, /pF "abxcutoff" \(slow 2 "0.2 0.8"\)/);
});

test("P4 negative synth macro and modulation are valid Haskell function arguments", () => {
  const p = macros(fixtureProject()), t = p.tracks.at(-1)!;
  p.jam!.macros.forEach(m => m.value = -0.8);
  t.modulation!.forEach(m => m.amount = -0.2);
  const body = compileClip(p, steps(p, t.id));
  assert.match(body, /pF "jcutoff" \(-0.28\)/);
  assert.match(body, /pF "mcutoffamount" \(-0.2\)/);
});
test("P4 native normalized macro addition is clamped with modulation before DSP mapping", () => {
  assert.match(SOUND_LAB_SYNTHS, /Lag.kr\(\\jcutoff.kr\(0\), 0.02\)/);
  assert.match(SOUND_LAB_SYNTHS, /amount.kr\(0\), 0.02\)\)\).clip\(0, 1\)/);
  assert.match(SOUND_LAB_SYNTHS, /Limiter/);
});
test("P4 insert macro values retain automation authorization tokens", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!;
  p.automation.push({
    id: "fxauto",
    trackId: t.id,
    clipId: t.activeClipId,
    parameter: "fx.verb_fx.mix",
    bars: 1,
    enabled: true,
    values: [0.1, 0.5],
  });
  const tokens = fxAutomationTargets(p, t);
  p.jam!.macros.forEach((m) => (m.value = 1));
  assert.deepEqual(fxAutomationTargets(p, t), tokens);
  assert.match(rackCommand(p), /\\jmix, 0.35/);
  assert.match(rackCommand(p), /\\abxmix, 0.2/);
});
test("P4 reset and independent macro disable restore the authored projection", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!,
    original = compileClip(p, steps(p, t.id));
  p.jam!.macros.forEach((m) => (m.value = 1));
  assert.notEqual(compileClip(p, steps(p, t.id)), original);
  p.jam!.macros.forEach((m) => (m.enabled = false));
  assert.equal(compileClip(p, steps(p, t.id)), original);
  p.jam!.macros.forEach((m) => {
    m.enabled = true;
    m.value = 0;
  });
  assert.equal(compileClip(p, steps(p, t.id)), original);
});
test("P4 track sound FX and selected-parameter locks suppress only their macro offsets", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!;
  p.jam!.macros.forEach((m) => (m.value = 1));
  lock(p, t.id, ["sound"]);
  assert.equal(macroOffset(p, t.id, "synth.cutoff"), 0);
  assert.ok(macroOffset(p, t.id, "fx.verb_fx.mix") > 0);
  lock(p, t.id, [], ["fx.verb_fx.mix"]);
  assert.equal(macroOffset(p, t.id, "fx.verb_fx.mix"), 0);
  assert.ok(macroOffset(p, t.id, "fx.verb_fx.size") > 0);
  lock(p, t.id, ["track"]);
  assert.equal(macroOffset(p, t.id, "fx.verb_fx.size"), 0);
});
test("P4 additive overlapping macro offsets remain bounded", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!;
  const m = p.jam!.macros.find((m) => m.name === "Brightness")!;
  p.jam!.macros = Array.from({ length: 8 }, (_, i) => ({
    ...clone(m),
    id: "overlap" + i,
    value: 1,
  }));
  assert.equal(macroOffset(p, t.id, "synth.cutoff"), 1);
  p.jam!.macros.forEach((m) => (m.value = -1));
  assert.equal(macroOffset(p, t.id, "synth.cutoff"), -1);
});
test("P4 FX reorder preserves macro IDs and mappings; deletion prunes safely", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!;
  const reordered = applyEdits(p, [
    {
      type: "fx.order",
      trackId: t.id,
      ids: t.effects!.map((f) => f.id).reverse(),
    },
  ]);
  assert.deepEqual(reordered.jam, p.jam);
  const removed = applyEdits(p, [
    { type: "fx.remove", trackId: t.id, effectId: "verb_fx" },
  ]);
  assert.ok(
    removed.jam!.macros.every((m) =>
      m.targets.every((x) => !x.parameter.startsWith("fx.verb_fx.")),
    ),
  );
});
test("P4 bypass suspends macro targets and preserves mappings for later enable", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!;
  p.jam!.macros.forEach((m) => (m.value = 1));
  const n = applyEdits(p, [
    {
      type: "fx.put",
      trackId: t.id,
      effect: { ...t.effects![0], enabled: false },
    },
  ]);
  assert.deepEqual(n.jam, p.jam);
  assert.equal(macroOffset(n, t.id, "fx.verb_fx.mix"), 0);
});
test("P4 malformed mappings duplicate constraints and unknown targets reject", () => {
  for (const change of [
    (p: ProjectDocument) =>
      p.jam!.locks.push({
        trackId: "missing",
        scopes: ["track"],
        parameters: [],
      }),
    (p: ProjectDocument) =>
      p.jam!.macros[0].targets.push(clone(p.jam!.macros[0].targets[0])),
    (p: ProjectDocument) =>
      (p.jam!.macros[0].targets[0].parameter = "fx.verb_fx.time"),
    (p: ProjectDocument) => (p.jam!.macros[0].value = Infinity),
  ]) {
    const p = macros(fixtureProject());
    change(p);
    assert.throws(() => validateProject(p));
  }
});
test("P4 scene and arrangement projections retain independent macro layer", () => {
  const p = macros(fixtureProject());
  p.jam!.macros.forEach((m) => (m.value = 0.5));
  p.arrangement = [{ id: "chain", sceneId: p.sceneOrder[0], cycles: 2 }];
  assert.deepEqual(sceneProjection(p, p.sceneOrder[0]).jam, p.jam);
  assert.match(
    Object.values(compileArrangement(p)).join(" "),
    /pF "jcutoff" 0.175/,
  );
});
test("P4 promotion copies active rhythms and clip lanes without altering the source scene", () => {
  const p = fixtureProject(),
    original = clone(p.scenes);
  const n = promoteJam(p, "drop", "Drop"),
    scene = n.scenes.find((s) => s.id === "drop")!;
  assert.deepEqual(
    n.scenes.filter((s) => s.id !== "drop"),
    original,
  );
  for (const t of p.tracks) {
    assert.notEqual(scene.clips[t.id], t.activeClipId);
    const copy = n.clips.find((c) => c.id === scene.clips[t.id])!;
    assert.deepEqual(
      { ...copy, id: t.activeClipId, name: steps(p, t.id).name },
      steps(p, t.id),
    );
  }
  assert.equal(n.automation.length, p.automation.length * 2);
  assert.deepEqual(n.tracks, p.tracks);
});
test("P4 promotion preserves intentional silent tracks", () => {
  const p = fixtureProject();
  p.tracks[0].activeClipId = null;
  const n = promoteJam(p, "silent", "Break");
  assert.equal(
    n.scenes.find((s) => s.id === "silent")!.clips[p.tracks[0].id],
    null,
  );
});
test("P4 trail bounds alternatives and never mutates canonical input", () => {
  const trail = new ExplorationTrail();
  let p = fixtureProject();
  for (let seed = 0; seed < 35; seed++) {
    const next = makeVariation(p, request(p, { seed })).document;
    trail.record(p, next, "Variation " + seed);
    p = next;
  }
  assert.ok(trail.inspect(p).length <= 12);
  assert.ok(trail.inspect(p).at(-1)!.current);
});
test("P4 trail compare return and branch use independent canonical snapshots", () => {
  const trail = new ExplorationTrail(),
    p = fixtureProject(),
    a = makeVariation(p, request(p)).document;
  trail.record(p, a, "V1");
  const original = trail.inspect(a)[0];
  const returned = trail.target(a, original.id);
  assert.deepEqual(returned, p);
  returned.name = "Caller cannot mutate snapshots";
  assert.equal(trail.target(a, original.id).name, p.name);
  const b = makeVariation(p, request(p, { seed: 600 })).document;
  trail.record(p, b, "Branch");
  assert.equal(trail.inspect(b).at(-1)!.parentId, original.id);
});
test("P4 kept trail marks remain workspace state and project switches reset alternatives", () => {
  const trail = new ExplorationTrail(),
    p = fixtureProject();
  trail.keep(p);
  assert.ok(trail.inspect(p)[0].kept);
  assert.equal(p.jam, undefined);
  assert.deepEqual(trail.inspect(emptyProject()), []);
});
test("P4 project round trip persists locks macros scenes but no transient trail", () => {
  const p = macros(fixtureProject());
  lock(p, p.tracks[0].id, ["track"]);
  const n = promoteJam(p, "drop", "Drop");
  assert.deepEqual(decodeProject(encodeProject(n)).document, n);
  assert.ok(!encodeProject(n).includes('"trail"'));
});

test("P4 canonical variation creates one Undo and Redo restores exact authored result", async (t) => {
  const { app, send } = await fixture(t);
  const before = app.project.document,
    history = app.project.history.undo;
  assert.equal(
    (await send("jam.variation", { request: request(before) })).ok,
    true,
  );
  const after = app.project.document;
  assert.equal(app.project.history.undo, history + 1);
  await send("project.undo");
  assert.deepEqual(
    { ...app.project.document, revision: before.revision },
    before,
  );
  await send("project.redo");
  assert.deepEqual(
    { ...app.project.document, revision: after.revision },
    after,
  );
});
test("P4 canonical verb and scene promotion are single history intentions", async (t) => {
  const { app, send } = await fixture(t);
  let history = app.project.history.undo;
  assert.equal(
    (
      await send("jam.verb", {
        verb: "dirt",
        trackIds: app.project.document.tracks.map((t) => t.id),
      })
    ).ok,
    true,
  );
  assert.equal(app.project.history.undo, ++history);
  assert.equal(
    (await send("jam.promote", { sceneId: "drop", name: "Drop" })).ok,
    true,
  );
  assert.equal(app.project.history.undo, ++history);
  await send("project.undo");
  assert.ok(!app.project.document.scenes.some((s) => s.id === "drop"));
});
test("P4 external Jam calls require current revision and session safety", async (t) => {
  const { app, send, engine } = await fixture(t);
  const before = app.project.document,
    calls = engine.calls.length;
  assert.equal((await app.dispatchExternal({ cmd: "jam.keep" })).ok, false);
  assert.equal(
    (await send("jam.variation", { revision: 0, request: request(before) })).ok,
    false,
  );
  assert.equal((await send("jam.keep", { sessionId: "stale" })).ok, false);
  assert.equal(engine.calls.length, calls);
  assert.deepEqual(app.project.document, before);
});
test("P4 retries deduplicate seeded transformations and history", async (t) => {
  const { app, send } = await fixture(t);
  const c = {
    cmd: "jam.variation",
    projectId: app.project.document.id,
    revision: app.project.document.revision,
    sessionId: app.sessionId,
    issuedAt: Date.now(),
    operationId: "same-idea",
    request: request(app.project.document),
  };
  const a = await app.dispatchExternal(c),
    h = app.project.history.undo;
  const b = await app.dispatchExternal(c);
  assert.deepEqual(a, b);
  assert.equal(app.project.history.undo, h);
  void send;
});
test("P4 engine failure does not publish a variation or a trail", async (t) => {
  const { app, send, engine } = await fixture(t);
  await send("resume");
  const before = app.project.document;
  engine.fail = "d1 $";
  const result = await send("jam.variation", { request: request(before) });
  assert.equal(result.ok, false);
  assert.deepEqual(app.project.document, before);
  assert.deepEqual(app.projectState().jam.trail, []);
});
test("P4 changing a macro gesture makes one revision; grouped followups one Undo", async (t) => {
  const { app, send } = await fixture(t);
  const macro = app.project.document.jam!.macros[0],
    history = app.project.history.undo;
  await send("jam.macro.value", {
    macroId: macro.id,
    value: 0.2,
    groupId: "gesture",
  });
  await send("jam.macro.value", {
    macroId: macro.id,
    value: 0.4,
    groupId: "gesture",
  });
  assert.equal(app.project.history.undo, history + 1);
  await send("project.undo");
  assert.equal(app.project.document.jam!.macros[0].value, 0);
});
test("P4 FX removal Undo restores mappings with the effect", async (t) => {
  const { app, send } = await fixture(t);
  const p = app.project.document,
    track = p.tracks[2];
  await send("project.edit", {
    label: "Remove reverb",
    edits: [
      { type: "fx.remove", trackId: track.id, effectId: track.effects![0].id },
    ],
  });
  assert.ok(!app.project.document.jam!.macros.some((m) => m.name === "Space"));
  await send("project.undo");
  assert.deepEqual(app.project.document.jam, p.jam);
});
test("P4 saved/recovered macros stay authored while playback reopens stopped", async (t) => {
  const { app, send, dir } = await fixture(t);
  await send("jam.macro.value", {
    macroId: app.project.document.jam!.macros[0].id,
    value: 0.6,
  });
  await send("jam.lock", {
    lock: {
      trackId: app.project.document.tracks[0].id,
      scopes: ["track"],
      parameters: [],
    },
  });
  await send("project.save", { value: "p4" });
  const p = app.project.document,
    disk = readFileSync(path.join(dir, "p4.abx.json"), "utf8");
  assert.deepEqual(decodeProject(disk).document, p);
  await send("project.new");
  await send("project.load", { value: "p4" });
  assert.deepEqual({ ...app.project.document, revision: p.revision }, p);
  assert.equal(app.rig.stopped, true);
  assert.deepEqual(app.projectState().jam.trail, []);
  const recovered = new Application(new FixtureEngine(), {
    sets: dir,
    recordings: path.join(dir, "rec"),
    projects: dir,
    recovery: path.join(dir, "recovery"),
    device: path.join(dir, "device"),
  });
  assert.deepEqual(recovered.project.document.jam, p.jam);
  assert.equal(recovered.rig.stopped, true);
});
test("P4 prepared P3 performances reject Jam edits until explicit return", async (t) => {
  const { app, send } = await fixture(t);
  await send("scene.launch", { sceneId: app.project.document.sceneOrder[0] });
  const before = app.project.document;
  assert.equal(
    (await send("jam.variation", { request: request(before) })).ok,
    false,
  );
  assert.deepEqual(app.project.document, before);
  assert.equal((await send("performance.return")).ok, true);
  assert.equal(
    (await send("jam.variation", { request: request(before) })).ok,
    true,
  );
});
test("P4 locks and capabilities are identical in readback and command execution", async (t) => {
  const { app, send } = await fixture(t);
  const p = app.project.document,
    kick = p.tracks[0];
  await send("jam.lock", {
    lock: { trackId: kick.id, scopes: ["track"], parameters: [] },
  });
  const readback = app.projectState();
  assert.deepEqual(
    readback.jam.capabilities,
    jamCapabilities(app.project.document),
  );
  await send("jam.variation", { request: request(app.project.document) });
  assert.deepEqual(steps(app.project.document, kick.id), steps(p, kick.id));
});
test("P4 starter refuses to overwrite an existing project", async (t) => {
  const { app, send } = await fixture(t);
  const p = app.project.document;
  assert.equal(
    (await send("jam.start", { starter: "surprise", seed: 9 })).ok,
    false,
  );
  assert.deepEqual(app.project.document, p);
});
test("P4 all-locked macro rejects and preserves authored gesture history", async (t) => {
  const { app, send } = await fixture(t);
  const p = app.project.document,
    m = p.jam!.macros[0];
  for (const id of new Set(m.targets.map((t) => t.trackId)))
    await send("jam.lock", {
      lock: { trackId: id, scopes: ["track"], parameters: [] },
    });
  const history = app.project.history,
    before = app.project.document;
  assert.equal(
    (await send("jam.macro.value", { macroId: m.id, value: 1 })).ok,
    false,
  );
  assert.deepEqual(app.project.history, history);
  assert.deepEqual(app.project.document, before);
});
test("P4 performance notebook captures successful intentions only without Undo noise", async (t) => {
  const { app, send } = await fixture(t);
  const history = app.project.history.undo;
  await send("jam.capture.start");
  assert.equal(app.project.history.undo, history);
  await send("jam.variation", { request: request(app.project.document) });
  await send("jam.variation", {
    revision: 0,
    request: request(app.project.document),
  });
  assert.equal(app.projectState().jam.capture!.take.events.length, 1);
  assert.equal(app.projectState().jam.capture!.take.events[0].cycle, null);
  assert.equal(
    app.projectState().jam.capture!.take.events[0].timing,
    "unavailable",
  );
  await send("jam.capture.stop");
  assert.equal(app.project.history.undo, history + 1);
  await send("jam.capture.keep");
  assert.equal(app.project.document.jam!.takes!.length, 1);
  assert.equal(app.project.history.undo, history + 2);
  await send("project.undo");
  assert.equal(app.project.document.jam!.takes, undefined);
});
test("P4 performance notebook records engine-scheduled scene cycles without conversion", async (t) => {
  const { app, send } = await fixture(t);
  await send("jam.capture.start");
  await send("scene.launch", { sceneId: app.project.document.sceneOrder[0] });
  const event = app.projectState().jam.capture!.take.events[0];
  assert.equal(event.cycle, 3);
  assert.equal(event.timing, "scheduled");
  assert.equal(app.project.document.arrangement.length, 0);
  await send("jam.capture.stop");
  assert.equal((await send("jam.capture.keep")).ok, true);
});
test("P4 performance notebook is bounded and survives browser readback", async (t) => {
  const { app, send } = await fixture(t);
  await send("jam.capture.start");
  const macroId = app.project.document.jam!.macros[0].id;
  for (let i = 0; i < 130; i++)
    await send("jam.macro.value", {
      macroId,
      value: i % 2 ? 0.1 : 0.2,
      groupId: "bounded",
    });
  const capture = app.projectState().jam.capture!;
  assert.equal(capture.take.events.length, 128);
  assert.equal(capture.active, false);
  assert.deepEqual(app.projectState().jam.capture, capture);
});
test("P4 new engine generation and new projects do not restore live event capture", async (t) => {
  const { app, engine, send } = await fixture(t);
  await send("jam.capture.start");
  engine.generation++;
  assert.equal(app.projectState().jam.capture!.active, false);
  await send("project.new");
  assert.equal(app.projectState().jam.capture, null);
});
test("P4 kept performance notebook persists with honest timing limitations", async (t) => {
  const { app, send } = await fixture(t);
  await send("jam.capture.start");
  await send("jam.macro.value", {
    macroId: app.project.document.jam!.macros[0].id,
    value: 0.3,
  });
  await send("jam.capture.stop");
  await send("jam.capture.keep");
  await send("jam.capture.keep");
  assert.equal(app.project.document.jam!.takes!.length, 1);
  const p = decodeProject(encodeProject(app.project.document)).document;
  assert.match(p.jam!.takes![0].limitation, /No automatic replay/);
  assert.equal(p.jam!.takes![0].events[0].value, 0.3);
});
test("P4 Original and kept alternatives survive bounded trail eviction", () => {
  const trail = new ExplorationTrail(),
    original = fixtureProject();
  let p = makeVariation(original, request(original)).document;
  trail.record(original, p, "First");
  trail.keep(p);
  const kept = trail.inspect(p).find((e) => e.kept)!.id;
  for (let seed = 0; seed < 35; seed++) {
    const n = makeVariation(p, request(p, { seed })).document;
    trail.record(p, n, "V" + seed);
    p = n;
  }
  assert.deepEqual(trail.target(p, trail.inspect(p)[0].id), original);
  assert.ok(trail.inspect(p).some((e) => e.id === kept && e.kept));
  assert.ok(trail.inspect(p).length <= 12);
});
test("P4 favorite capacity rejects instead of silently evicting kept ideas", () => {
  const trail = new ExplorationTrail();
  let p = fixtureProject();
  trail.keep(p);
  for (let seed = 0; seed < 6; seed++) {
    const n = makeVariation(p, request(p, { seed })).document;
    trail.record(p, n, "V" + seed);
    trail.keep(n);
    p = n;
  }
  const n = makeVariation(p, request(p, { seed: 800 })).document;
  trail.record(p, n, "Next");
  assert.throws(() => trail.keep(n), /favorites are full/);
  assert.equal(trail.inspect(n).filter((e) => e.kept).length, 7);
});
test("P4 user/captured sample Chaos never changes original or managed audio bytes", async (t) => {
  const { app, send, dir } = await fixture(t),
    original = path.join(dir, "source.wav"),
    bytes = fixtureWav();
  writeFileSync(original, bytes);
  const imported = await app.userAudio.importFile(original, "captured");
  assert.equal(
    (await send("audio.add", { value: imported.entry.id })).ok,
    true,
  );
  const track = app.project.document.tracks.at(-1)!;
  for (let seed = 0; seed < 12; seed++)
    assert.equal(
      (
        await send("jam.variation", {
          request: request(app.project.document, {
            seed,
            operation: "chaos",
            intensity: "wild",
            trackIds: [track.id],
            scopes: ["sound", "rhythm"],
          }),
        })
      ).ok,
      true,
    );
  assert.deepEqual(readFileSync(original), bytes);
  assert.deepEqual(
    readFileSync(await app.userAudio.verify(imported.entry.id)),
    bytes,
  );
  assert.equal(
    app.projectState().jam.capabilities.at(-1)!.source,
    "captured sample",
  );
});
test("P4 high synth notes remain in their authored register under octave exploration", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!,
    c = steps(p, t.id);
  c.notes = [110, 112, 117, 110, 112, 117, 110, 112];
  const n = makeVariation(
    p,
    request(p, { trackIds: [t.id], scopes: ["sound"], intensity: "fresh" }),
  ).document;
  assert.ok(
    steps(n, t.id).notes!.every(
      (note, i) => Math.abs(note - c.notes![i]) <= 12,
    ),
  );
});
test("P4 trail byte limit preserves Original and current on large valid documents", () => {
  const trail = new ExplorationTrail();
  let p = fixtureProject();
  p.sources = Array.from({ length: 45 }, (_, i) => ({
    id: "source_" + i,
    name: "Retained code",
    source: "x".repeat(65536),
  }));
  const original = clone(p);
  for (let i = 0; i < 9; i++) {
    const n = { ...clone(p), name: "Large idea " + i };
    trail.record(p, n, n.name);
    p = n;
  }
  assert.ok(trail.inspect(p).length <= 5);
  assert.deepEqual(trail.target(p, trail.inspect(p)[0].id), original);
  assert.ok(trail.inspect(p).at(-1)!.current);
});
test("P4 locking an already-macroed track freezes the audible offset", async (t) => {
  const { app, send } = await fixture(t),
    p = app.project.document,
    macro = p.jam!.macros.find((m) => m.name === "Space")!,
    target = macro.targets[0];
  await send("jam.macro.value", { macroId: macro.id, value: 0.7 });
  const offset = macroOffset(
    app.project.document,
    target.trackId,
    target.parameter,
  );
  await send("jam.lock", {
    lock: { trackId: target.trackId, scopes: ["fx"], parameters: [] },
  });
  assert.equal(
    macroOffset(app.project.document, target.trackId, target.parameter),
    offset,
  );
  await send("jam.macros.reset");
  assert.equal(
    macroOffset(app.project.document, target.trackId, target.parameter),
    offset,
  );
  const saved = decodeProject(encodeProject(app.project.document)).document;
  assert.equal(macroOffset(saved, target.trackId, target.parameter), offset);
  await send("jam.lock", {
    lock: { trackId: target.trackId, scopes: [], parameters: [] },
  });
  assert.equal(
    macroOffset(app.project.document, target.trackId, target.parameter),
    0,
  );
});
test("P4 partial macro lock freezes kept targets while free targets still move", async (t) => {
  const { app, send } = await fixture(t),
    macro = app.project.document.jam!.macros.find((m) => m.name === "Space")!,
    [a, b] = macro.targets;
  await send("jam.macro.value", { macroId: macro.id, value: 0.4 });
  await send("jam.lock", {
    lock: { trackId: a.trackId, scopes: [], parameters: [a.parameter] },
  });
  await send("jam.macro.value", { macroId: macro.id, value: 0.8 });
  assert.equal(
    macroOffset(app.project.document, a.trackId, a.parameter),
    0.4 * a.amount,
  );
  assert.equal(
    macroOffset(app.project.document, b.trackId, b.parameter),
    0.8 * b.amount,
  );
});
test("P4 unavailable definitions retain macro mappings but emit no guessed controls", () => {
  const p = macros(fixtureProject()),
    t = p.tracks.at(-1)!;
  p.jam!.macros.forEach((m) => (m.value = 1));
  if (t.source?.type === "synth") t.source.version = 999;
  t.effects!.forEach((f) => (f.version = 999));
  const n = decodeProject(encodeProject(p)).document;
  assert.deepEqual(n.jam, p.jam);
  assert.equal(macroOffset(n, t.id, "synth.cutoff"), 0);
  assert.equal(macroOffset(n, t.id, "fx.verb_fx.mix"), 0);
  assert.equal(jamCapabilities(n).at(-1)!.targets.length, 0);
  const renamed = applyEdits(n, [{ type: "project.rename", name: "Retained" }]);
  assert.deepEqual(renamed.jam, p.jam);
});
test("P4 boundary variations change audible parameters rather than only preset metadata", () => {
  const p = fixtureProject(),
    t = p.tracks.at(-1)!;
  if (t.source?.type !== "synth") throw new Error("Fixture synth required");
  const values = t.source.values;
  Object.keys(values).forEach((k) => {
    values[k] = 1;
  });
  for (let seed = 0; seed < 20; seed++) {
    const n = makeVariation(
        p,
        request(p, {
          trackIds: [t.id],
          scopes: ["sound"],
          intensity: "subtle",
          seed,
        }),
      ).document,
      source = n.tracks.at(-1)!.source;
    assert.ok(
      source?.type === "synth" &&
        Object.values(source.values).some((v) => v < 1),
    );
  }
});
test("P4 reopened session trail cannot reuse an expired idea identity", () => {
  const trail = new ExplorationTrail(),
    p = fixtureProject();
  trail.keep(p);
  const expired = trail.inspect(p)[0].id;
  trail.reset(p);
  trail.keep(p);
  assert.notEqual(trail.inspect(p)[0].id, expired);
  assert.throws(() => trail.target(p, expired), /no longer/);
});
