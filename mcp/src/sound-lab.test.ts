import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  instruments,
  effects,
  defaults,
  definition,
  synthSource,
} from "./sound-lab.js";
import {
  emptyProject,
  applyEdits,
  validateProject,
  type ProjectEdit,
  type ProjectDocument,
} from "./project.js";
import { addSynth } from "./sound-lab-edits.js";
import { pocketGroove } from "./studio-starter.js";
import {
  compileClip,
  compileTrack,
  compileArrangement,
  mixerCommand,
} from "./project-compiler.js";
import { rackCommand, SOUND_LAB_SYNTHS } from "./sound-lab-engine.js";
import { sceneProjection } from "./performance.js";
import {
  encodeProject,
  decodeProject,
  ProjectStorage,
} from "./project-storage.js";
import { ProjectService } from "./project-service.js";
import { Application, type CommandEngine } from "./application.js";
const lab = () => {
  const p = emptyProject();
  return applyEdits(p, addSynth(p, p.sceneOrder[0]));
};
const fx = (id = "fx1", definitionId = "distortion") => ({
  id,
  definitionId,
  version: 1,
  enabled: true,
  values: defaults(definition("effect", definitionId)!),
});
const route = (target = "synth.cutoff", id = "mod1") => ({
  id,
  target,
  source: "lfo" as const,
  amount: 0.25,
  rate: 2,
  enabled: true,
});
const edit = (p: ProjectDocument, edits: ProjectEdit[]) => applyEdits(p, edits);
function full() {
  let p = lab(),
    t = p.tracks[0];
  return edit(p, [
    { type: "fx.put", trackId: t.id, effect: fx() },
    { type: "fx.put", trackId: t.id, effect: fx("space", "reverb") },
    { type: "modulation.put", trackId: t.id, route: route() },
    {
      type: "automation.put",
      automation: {
        id: "auto",
        trackId: t.id,
        clipId: t.activeClipId,
        parameter: "synth.cutoff",
        bars: 2,
        values: [0.2, 0.8],
        enabled: true,
      },
    },
  ]);
}

test("Sound Lab definitions have stable unique controls and compatible bounded patches", () => {
  for (const collection of [instruments, effects]) {
    assert.equal(new Set(collection.map((d) => d.id)).size, collection.length);
    for (const d of collection) {
      assert.equal(d.version, 1);
      assert.equal(
        new Set(d.parameters.map((p) => p.id)).size,
        d.parameters.length,
      );
      assert.ok(d.description && d.engine && d.presets.length);
      for (const patch of d.presets) {
        assert.deepEqual(
          Object.keys(patch.values).sort(),
          Object.keys(defaults(d)).sort(),
        );
        assert.ok(Object.values(patch.values).every((v) => v >= 0 && v <= 1));
      }
    }
  }
});
for (const instrument of instruments)
  test(`Sound Lab ${instrument.name} compiles with pitch, identity and stable orbit`, () => {
    const p = emptyProject(),
      next = edit(p, addSynth(p, p.sceneOrder[0], instrument.id));
    const body = compileTrack(next, next.tracks[0])!;
    assert.match(body, new RegExp(instrument.engine));
    assert.match(body, /midinote "36 36 36 43 43 43 39 36"/);
    assert.match(body, /orbit 0$/);
    assert.match(body, /pF "abx/);
    assert.equal(next.tracks[0].source?.type, "synth");
  });
test("Sound Lab source swaps preserve clips, scenes, arrangement, mixer and rack", () => {
  const p = full(),
    t = p.tracks[0];
  const next = edit(p, [
    { type: "source.set", trackId: t.id, source: synthSource("reese") },
  ]);
  assert.deepEqual(next.clips, p.clips);
  assert.deepEqual(next.scenes, p.scenes);
  assert.deepEqual(next.tracks[0].mixer, t.mixer);
  assert.deepEqual(next.tracks[0].effects, t.effects);
  assert.equal(mixerCommand(next), mixerCommand(p));
});
test("Sound Lab sample tracks remain distinct and unrelated source compiles identically", () => {
  let p = emptyProject();
  p = edit(p, pocketGroove(p));
  const body = compileTrack(p, p.tracks[0]);
  p = edit(p, addSynth(p, p.sceneOrder[0]));
  assert.equal(compileTrack(p, p.tracks[0]), body);
  assert.equal(p.assets[0].kind, "sample");
  assert.equal(p.tracks.at(-1)!.source?.type, "synth");
});
test("Sound Lab pitch edits are bounded, length checked and octave transposition clips MIDI safely", () => {
  const p = lab(),
    c = p.clips[0];
  assert.throws(() =>
    edit(p, [{ type: "notes.set", clipId: c.id, notes: [36], octave: 0 }]),
  );
  assert.throws(() =>
    edit(p, [
      { type: "notes.set", clipId: c.id, notes: Array(8).fill(128), octave: 0 },
    ]),
  );
  const next = edit(p, [
    { type: "notes.set", clipId: c.id, notes: Array(8).fill(120), octave: 4 },
  ]);
  assert.match(compileClip(next, next.clips[0]), /midinote "127 127/);
});
test("Sound Lab bounds reject NaN, unsafe values and unknown parameter keys atomically", () => {
  const p = lab(),
    trackId = p.tracks[0].id;
  for (const value of [NaN, Infinity, -1, 1.1])
    assert.throws(() =>
      edit(p, [
        { type: "synth.parameter", trackId, parameter: "cutoff", value },
      ]),
    );
  assert.throws(() =>
    edit(p, [
      { type: "project.rename", name: "wrong" },
      { type: "synth.parameter", trackId, parameter: "fake", value: 0.5 },
    ]),
  );
  assert.equal(p.name, "Untitled");
  assert.throws(() =>
    edit(p, [
      {
        type: "fx.put",
        trackId,
        effect: { ...fx(), values: { drive: 0.2, fake: 0.3 } },
      },
    ]),
  );
});
test("Sound Lab unknown definitions and future versions roundtrip silently without substitution", () => {
  for (const source of [
    { ...synthSource("dirtymono"), definitionId: "missing" },
    { ...synthSource("dirtymono"), version: 99 },
  ]) {
    const p = full();
    p.tracks[0].source = source;
    const decoded = decodeProject(encodeProject(p)).document;
    assert.deepEqual(decoded, p);
    assert.equal(compileClip(decoded, decoded.clips[0]), "silence");
  }
  const p = full();
  p.tracks[0].effects![0].version = 99;
  assert.ok(!rackCommand(p).includes("abxfx_distortion"));
});
test("Sound Lab missing parameter definitions fail before project mutation", () => {
  const p = lab(),
    source = synthSource("dirtymono");
  delete source.values.cutoff;
  assert.throws(() =>
    edit(p, [{ type: "source.set", trackId: p.tracks[0].id, source }]),
  );
  assert.throws(() => synthSource("missing"));
});
test("Sound Lab rack operations preserve identity, exact order and bypass values", () => {
  let p = full();
  const trackId = p.tracks[0].id;
  p = edit(p, [
    { type: "fx.order", trackId, ids: ["space", "fx1"] },
    {
      type: "fx.put",
      trackId,
      effect: { ...fx(), enabled: false, values: { drive: 0.9, mix: 0.2 } },
    },
  ]);
  assert.deepEqual(
    p.tracks[0].effects!.map((f) => f.id),
    ["space", "fx1"],
  );
  assert.equal(p.tracks[0].effects![1].enabled, false);
  assert.equal(p.tracks[0].effects![1].values.drive, 0.9);
  assert.throws(() =>
    edit(p, [{ type: "fx.order", trackId, ids: ["space", "space"] }]),
  );
  assert.throws(() =>
    edit(p, [{ type: "fx.put", trackId, effect: fx("fx1", "filter") }]),
  );
  assert.equal(
    edit(p, [{ type: "fx.remove", trackId, effectId: "fx1" }]).tracks[0]
      .effects!.length,
    1,
  );
});
test("Sound Lab rack limits and globally unique instance identities prevent node collisions", () => {
  const p = lab(),
    trackId = p.tracks[0].id;
  assert.throws(() =>
    edit(
      p,
      Array.from({ length: 9 }, (_, i) => ({
        type: "fx.put" as const,
        trackId,
        effect: fx("fx" + i),
      })),
    ),
  );
  assert.throws(() =>
    edit(p, [{ type: "fx.put", trackId, effect: fx(trackId) }]),
  );
});
test("Sound Lab rack command places processors in order before channel with bounded cleanup", () => {
  const p = full(),
    command = rackCommand(p);
  assert.ok(
    command.indexOf("abxfx_distortion") < command.indexOf("abxfx_reverb"),
  );
  assert.match(command, /Synth.before\(~abxChannels\[0\]/);
  assert.match(command, /removeAt\(key\).free/);
  assert.match(
    command,
    /includesEqual\(key\)/,
    "SC strings require equality, not object identity",
  );
  assert.match(command, /\.isNil/);
  assert.match(command, /\.set\(/);
  assert.match(command, /moveBefore/);
  const next = edit(p, [
    { type: "fx.order", trackId: p.tracks[0].id, ids: ["space", "fx1"] },
  ]);
  assert.ok(
    rackCommand(next).indexOf("abxfx_reverb") <
      rackCommand(next).indexOf("abxfx_distortion"),
  );
});
test("Sound Lab removing an effect removes only its modulation routes", () => {
  let p = full();
  const trackId = p.tracks[0].id;
  p = edit(p, [
    { type: "modulation.put", trackId, route: route("fx.fx1.drive", "fxmod") },
  ]);
  const next = edit(p, [{ type: "fx.remove", trackId, effectId: "fx1" }]);
  assert.deepEqual(
    next.tracks[0].modulation!.map((m) => m.id),
    ["mod1"],
  );
  assert.deepEqual(next.automation, p.automation);
});
test("Sound Lab modulation rejects collisions, stale targets and unsafe rates/depth", () => {
  const p = full(),
    trackId = p.tracks[0].id;
  for (const r of [
    route("synth.cutoff", "duplicate"),
    route("synth.fake"),
    route("fx.missing.drive"),
    { ...route(), amount: 2 },
    { ...route(), rate: 0 },
  ])
    assert.throws(() =>
      edit(p, [{ type: "modulation.put", trackId, route: r }]),
    );
});
test("Sound Lab automation overrides base while engine modulation stays a separate bounded offset", () => {
  const p = full(),
    before = p.tracks[0].source,
    body = compileClip(p, p.clips[0]);
  assert.match(body, /pF "abxcutoff" \(slow 2 "0.2 0.8"\)/);
  assert.match(body, /pF "mcutoffamount" 0.25/);
  assert.deepEqual(p.tracks[0].source, before);
  const noMod = edit(p, [
    { type: "modulation.remove", trackId: p.tracks[0].id, routeId: "mod1" },
  ]);
  assert.match(compileClip(noMod, noMod.clips[0]), /abxcutoff.*slow 2/);
  assert.ok(!compileClip(noMod, noMod.clips[0]).includes("mcutoffamount"));
  const noAuto = edit(p, [{ type: "automation.delete", automationId: "auto" }]);
  assert.match(compileClip(noAuto, noAuto.clips[0]), /pF "abxcutoff" 0.58/);
  assert.match(compileClip(noAuto, noAuto.clips[0]), /mcutoffamount/);
});
test("Sound Lab disabling modulation emits zero depth and retains authored amount", () => {
  const p = full(),
    next = edit(p, [
      {
        type: "modulation.put",
        trackId: p.tracks[0].id,
        route: { ...route(), enabled: false },
      },
    ]);
  assert.match(compileClip(next, next.clips[0]), /mcutoffamount" 0(?: |$)/);
  assert.equal(next.tracks[0].modulation![0].amount, 0.25);
});
test("Sound Lab effect modulation removal explicitly resets live node offsets", () => {
  let p = full();
  p = edit(p, [
    {
      type: "modulation.put",
      trackId: p.tracks[0].id,
      route: route("fx.fx1.drive", "fxmod"),
    },
  ]);
  assert.match(rackCommand(p), /mdriveamount, 0.25/);
  p = edit(p, [
    { type: "modulation.remove", trackId: p.tracks[0].id, routeId: "fxmod" },
  ]);
  assert.match(rackCommand(p), /mdriveamount, 0,/);
});
test("Sound Lab engine DSP contains bounded safety and no browser audio dependencies", () => {
  for (const d of instruments)
    assert.ok(SOUND_LAB_SYNTHS.includes("SynthDef(\\" + d.engine));
  for (const d of effects)
    assert.ok(SOUND_LAB_SYNTHS.includes("SynthDef(\\abxfx_" + d.id));
  assert.match(SOUND_LAB_SYNTHS, /LeakDC/);
  assert.match(SOUND_LAB_SYNTHS, /Limiter/);
  assert.match(SOUND_LAB_SYNTHS, /doneAction: 2/);
  assert.match(SOUND_LAB_SYNTHS, /\.clip\(0, 1\)/);
  assert.ok(!SOUND_LAB_SYNTHS.includes("SoundIn"));
  assert.ok(!SOUND_LAB_SYNTHS.includes("MouseX"));
});
test("Sound Lab scene duplicate copies notes/automation independently, source and rack stay track-owned", () => {
  const p = full(),
    t = p.tracks[0],
    next = edit(p, [
      {
        type: "scene.duplicate",
        sceneId: p.sceneOrder[0],
        newSceneId: "copy",
        name: "Copy",
      },
    ]);
  const copy = next.clips.find(
    (c) => c.id === next.scenes.find((s) => s.id === "copy")!.clips[t.id],
  )!;
  assert.notEqual(copy.id, t.activeClipId);
  assert.deepEqual(
    copy.kind === "steps" && copy.notes,
    p.clips[0].kind === "steps" && p.clips[0].notes,
  );
  assert.equal(next.automation.length, 2);
  const changed = edit(next, [
    { type: "notes.set", clipId: copy.id, notes: Array(8).fill(48), octave: 1 },
  ]);
  assert.deepEqual(changed.clips[0], p.clips[0]);
  assert.deepEqual(changed.tracks[0], t);
  assert.match(
    compileTrack(sceneProjection(changed, "copy"), t, copy.id)!,
    /midinote "60/,
  );
});
test("Sound Lab arrangement supports synth sections and intentional silence", () => {
  let p = full();
  p = edit(p, [
    {
      type: "arrangement.set",
      entries: [
        { id: "one", sceneId: p.sceneOrder[0], cycles: 2 },
        { id: "two", sceneId: p.sceneOrder[1], cycles: 1 },
      ],
    },
  ]);
  const body = compileArrangement(p).d1;
  assert.match(body, /abx_dirtymono/);
  assert.match(body, /silence/);
  assert.match(body, /orbit 0/);
});
test("Sound Lab full persistence and recovery retain patches and authored state only", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-lab-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let p = full();
  p = edit(p, [
    {
      type: "patch.put",
      patch: {
        id: "user",
        name: "Mine",
        kind: "instrument",
        definitionId: "dirtymono",
        version: 1,
        values: defaults(instruments[0]),
      },
    },
  ]);
  assert.deepEqual(decodeProject(encodeProject(p)).document, p);
  const storage = new ProjectStorage(dir, path.join(dir, "recovery"));
  storage.save("lab", p);
  storage.checkpoint(p);
  assert.deepEqual(storage.load("lab"), p);
  assert.deepEqual(new ProjectService(storage).document, p);
  assert.ok(!encodeProject(p).includes("nodeId"));
});
test("Sound Lab curated and user presets load atomically with version compatibility", () => {
  let p = lab(),
    trackId = p.tracks[0].id;
  p = edit(p, [{ type: "patch.load", trackId, presetId: "dirtymono_1" }]);
  assert.equal(
    p.tracks[0].source?.type === "synth" && p.tracks[0].source.values.drive,
    0.65,
  );
  assert.throws(() =>
    edit(p, [{ type: "patch.load", trackId, presetId: "reese_0" }]),
  );
  p = edit(p, [
    {
      type: "patch.put",
      patch: {
        id: "user",
        name: "Mine",
        kind: "instrument",
        definitionId: "dirtymono",
        version: 1,
        values: { ...defaults(instruments[0]), drive: 0.77 },
      },
    },
    { type: "patch.load", trackId, presetId: "user" },
  ]);
  assert.equal(
    p.tracks[0].source?.type === "synth" && p.tracks[0].source.values.drive,
    0.77,
  );
});
test("Sound Lab each intention and grouped gestures undo/redo exact authored state", () => {
  const service = new ProjectService();
  service.acceptSwitch(full());
  const original = service.document,
    trackId = original.tracks[0].id;
  for (const value of [0.2, 0.3, 0.4])
    service.commit(
      service.prepare([
        { type: "synth.parameter", trackId, parameter: "drive", value },
      ]),
      "Turn Drive",
      "gesture",
    );
  assert.equal(service.history.undo, 1);
  service.acceptHistory(false, service.historyTarget(false));
  assert.deepEqual(service.document.tracks, original.tracks);
  service.acceptHistory(true, service.historyTarget(true));
  for (const edits of [
    [{ type: "patch.load", trackId, presetId: "dirtymono_1" }],
    [{ type: "fx.order", trackId, ids: ["space", "fx1"] }],
    [
      {
        type: "modulation.put",
        trackId,
        route: route("synth.drive", "second"),
      },
    ],
    [{ type: "source.set", trackId, source: synthSource("sub808") }],
  ]) {
    const before = service.document;
    service.commit(service.prepare(edits), "intention");
    const after = service.document;
    service.acceptHistory(false, service.historyTarget(false));
    assert.deepEqual(service.document.tracks, before.tracks);
    service.acceptHistory(true, service.historyTarget(true));
    assert.deepEqual(service.document.tracks, after.tracks);
  }
});
class LabEngine implements CommandEngine {
  generation = 0;
  running = false;
  state = "idle";
  error = null;
  calls: string[] = [];
  fail = "";
  tidal = {
    eval: async (code: string, id = "test") => {
      this.calls.push(code);
      if (this.fail && code.includes(this.fail)) throw Error("Fixture failure");
      return {
        operationId: id,
        acknowledgement: "action" as const,
        output: code.includes("abxInstall") ? "ABX_SCHEDULED 2" : "",
      };
    },
    hush: async () => this.tidal.eval("hush"),
  };
  sclang = {
    eval: async (code: string, id = "test") => this.tidal.eval(code, id),
    evalRoutine: async (code: string, id = "test") => this.tidal.eval(code, id),
  };
  async ensureBooted() {
    this.running = true;
    this.state = "ready";
  }
  async reboot() {
    this.generation++;
    await this.ensureBooted();
  }
  assertGeneration(g: number) {
    assert.equal(g, this.generation);
  }
}
function application(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-lab-app-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = new LabEngine(),
    app = new Application(engine, {
      sets: dir,
      projects: dir,
      recordings: path.join(dir, "recordings"),
      recovery: path.join(dir, "recover"),
      device: path.join(dir, "device"),
    });
  const send = (cmd: string, extra = {}) =>
    app.dispatchExternal({
      cmd,
      projectId: app.project.document.id,
      revision: app.project.document.revision,
      ...extra,
    });
  return { app, engine, send };
}
test("Sound Lab application rejects stale revisions without parameter traffic", async (t) => {
  const { app, engine, send } = application(t);
  const p = app.project.document;
  assert.equal(
    (
      await send("project.edit", {
        label: "Add synth",
        edits: addSynth(p, p.sceneOrder[0]),
      })
    ).ok,
    true,
  );
  const count = engine.calls.length;
  const result = await send("project.edit", {
    revision: p.revision,
    label: "Stale",
    edits: [
      {
        type: "synth.parameter",
        trackId: app.project.document.tracks[0].id,
        parameter: "drive",
        value: 0.9,
      },
    ],
  });
  assert.ok(!result.ok && result.code === "STALE_PROJECT");
  assert.equal(engine.calls.length, count);
});
test("Sound Lab application applies only changed slot and preserves channel levels", async (t) => {
  const { app, engine, send } = application(t);
  const p = app.project.document;
  await send("project.edit", {
    label: "Add",
    edits: addSynth(p, p.sceneOrder[0]),
  });
  assert.equal((await send("resume")).ok, true);
  engine.calls = [];
  await send("project.edit", {
    label: "Cutoff",
    edits: [
      {
        type: "synth.parameter",
        trackId: app.project.document.tracks[0].id,
        parameter: "cutoff",
        value: 0.8,
      },
    ],
  });
  assert.equal(engine.calls.length, 1);
  assert.match(engine.calls[0], /^d1/);
  assert.ok(!engine.calls[0].includes("abxChannels"));
});
test("Sound Lab FX edit does not reschedule notes; removal reconciles cleanup", async (t) => {
  const { app, engine, send } = application(t);
  const p = app.project.document;
  await send("project.edit", {
    label: "Add",
    edits: addSynth(p, p.sceneOrder[0]),
  });
  assert.equal((await send("resume")).ok, true);
  engine.calls = [];
  await send("project.edit", {
    label: "FX",
    edits: [
      {
        type: "fx.put",
        trackId: app.project.document.tracks[0].id,
        effect: fx(),
      },
    ],
  });
  assert.equal(engine.calls.length, 1);
  assert.match(engine.calls[0], /abxFX/);
  assert.ok(!engine.calls[0].includes("d1 $"));
  engine.calls = [];
  await send("project.edit", {
    label: "Remove",
    edits: [
      {
        type: "fx.remove",
        trackId: app.project.document.tracks[0].id,
        effectId: "fx1",
      },
    ],
  });
  assert.match(engine.calls[0], /removeAt/);
});
test("Sound Lab failed engine rack acknowledgement does not commit state or history", async (t) => {
  const { app, engine, send } = application(t);
  const p = app.project.document;
  await send("project.edit", {
    label: "Add",
    edits: addSynth(p, p.sceneOrder[0]),
  });
  assert.equal((await send("resume")).ok, true);
  const before = app.project.document,
    history = app.project.history;
  engine.fail = "abxfx_distortion";
  const result = await send("project.edit", {
    label: "FX",
    edits: [{ type: "fx.put", trackId: before.tracks[0].id, effect: fx() }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(app.project.document, before);
  assert.deepEqual(app.project.history, history);
  assert.equal(app.runtime.appliedRevision, null);
});
test("Sound Lab scene launch and reopen use managed synth path and stopped persistence", async (t) => {
  const { app, engine, send } = application(t);
  const p = app.project.document;
  await send("project.edit", {
    label: "Add",
    edits: addSynth(p, p.sceneOrder[0]),
  });
  await send("scene.launch", { sceneId: p.sceneOrder[0] });
  assert.ok(
    engine.calls.some(
      (c) => c.includes("abxInstall") && c.includes("abx_dirtymono"),
    ),
  );
  await send("project.save", { value: "soundlab" });
  const saved = app.project.document;
  await send("project.new");
  await send("project.load", { value: "soundlab" });
  assert.deepEqual(app.project.document.tracks, saved.tracks);
  assert.equal(app.rig.stopped, true);
});

test("Sound Lab project switches with reused effect IDs cannot retain the wrong processor", () => {
  const p = full(),
    before = rackCommand(p);
  p.tracks[0].effects![0] = fx("fx1", "filter");
  const after = rackCommand(validateProject(p));
  assert.ok(before.includes("fx1_distortion_1"));
  assert.ok(after.includes("fx1_filter_1"));
  assert.ok(!after.includes("fx1_distortion_1"));
});
test("Sound Lab performance reset restores live insert edits without changing staged synth content", async (t) => {
  const { app, engine, send } = application(t),
    p = app.project.document;
  await send("project.edit", {
    label: "Add",
    edits: addSynth(p, p.sceneOrder[0]),
  });
  await send("scene.launch", { sceneId: p.sceneOrder[0] });
  await send("project.edit", {
    label: "FX live",
    edits: [
      {
        type: "fx.put",
        trackId: app.project.document.tracks[0].id,
        effect: fx(),
      },
    ],
  });
  engine.calls = [];
  assert.equal((await send("reset")).ok, true);
  assert.ok(engine.calls.some((c) => c.includes("abxfx_distortion")));
});
test("Sound Lab sample replacement removes incompatible synth routes but preserves notes and inserts", () => {
  const p = full(),
    track = p.tracks[0];
  const next = edit(p, [
    {
      type: "asset.put",
      asset: {
        id: "sample",
        kind: "sample",
        reference: "bd",
        name: "bd",
        index: 0,
      },
    },
    { type: "sound.set", clipId: track.activeClipId!, assetId: "sample" },
  ]);
  assert.equal(next.tracks[0].source?.type, "sample");
  assert.deepEqual(next.tracks[0].effects, track.effects);
  assert.equal(next.tracks[0].modulation!.length, 0);
  assert.equal(next.automation.length, 0);
  assert.deepEqual(
    next.clips[0].kind === "steps" && next.clips[0].notes,
    p.clips[0].kind === "steps" && p.clips[0].notes,
  );
  assert.ok(!compileClip(next, next.clips[0]).includes("abx_dirtymono"));
});

test("Sound Lab SC arithmetic preserves base at zero depth and dry signal at zero delay mix", () => {
  // SC binary operators have equal precedence; these products must be grouped.
  assert.match(SOUND_LAB_SYNTHS, /\+ \(Select\.kr/);
  assert.match(SOUND_LAB_SYNTHS, /amount\.kr\(0\), 0\.02\)\)\)\.clip/);
  assert.match(SOUND_LAB_SYNTHS, /wet = dry \+ \(CombC/);
  assert.match(SOUND_LAB_SYNTHS, /1 \+ \(EnvGen\.kr/);
  assert.match(SOUND_LAB_SYNTHS, /1 \+ \(LFNoise1\.kr/);
  assert.match(SOUND_LAB_SYNTHS, /sig\[0\] \+ \(sig\[1\] \* \(1-width\)\)/);
});
