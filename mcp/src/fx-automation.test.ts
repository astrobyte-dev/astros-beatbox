import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyEdits, emptyProject, validateProject, type ProjectDocument } from "./project.js";
import { addSynth } from "./sound-lab-edits.js";
import { defaults, definition, effects } from "./sound-lab.js";
import { compileClip, compileTrack, compileArrangement } from "./project-compiler.js";
import { compileFxAutomation, fxAutomationTargets, INSTALL_FX_AUTOMATION, STOP_FX_AUTOMATION } from "./fx-automation.js";
import { rackCommand, SOUND_LAB_SYNTHS } from "./sound-lab-engine.js";
import { ProjectService } from "./project-service.js";
import { ProjectStorage, encodeProject, decodeProject } from "./project-storage.js";
import { Application, type CommandEngine } from "./application.js";
const effect = (id = "insert", definitionId = "distortion") => ({ id, definitionId, version: 1, enabled: true, values: defaults(definition("effect", definitionId)!) });
function fixture() {
  const empty = emptyProject(), p = applyEdits(empty, addSynth(empty, empty.sceneOrder[0])), t = p.tracks[0];
  return applyEdits(p, [
    { type: "fx.put", trackId: t.id, effect: effect() },
    { type: "fx.put", trackId: t.id, effect: effect("space", "reverb") },
    { type: "automation.put", automation: { id: "motion", trackId: t.id, clipId: t.activeClipId, parameter: "fx.insert.drive", enabled: true, bars: 2, values: [0.2, 0.8] } },
    { type: "modulation.put", trackId: t.id, route: { id: "lfo", target: "fx.insert.drive", source: "lfo", enabled: true, amount: 0.15, rate: 2 } },
  ]);
}
const targets = (p: ProjectDocument) => fxAutomationTargets(p, p.tracks[0]);
const drive = (p: ProjectDocument) => targets(p).find(t => t.target === "fx.insert.drive")!;
const disable = (p: ProjectDocument) => applyEdits(p, [{ type: "automation.put", automation: { ...p.automation[0], enabled: false } }]);
test("FX automation allowlist is explicit, stable and musically bounded", () => {
  assert.deepEqual(Object.fromEntries(effects.map(d => [d.id, d.parameters.filter(p => p.automatable).map(p => p.id)])), {
    filter: ["cutoff", "resonance"], distortion: ["drive", "mix"], crush: ["bits", "mix"], reverb: ["size", "mix"], delay: ["feedback", "mix"], chorus: ["depth", "mix"], compressor: ["amount"], ring: ["mix"],
  });
  for (const d of effects) for (const param of d.parameters.filter(p => p.automatable)) {
    const p = fixture(), t = p.tracks[0];
    assert.doesNotThrow(() => applyEdits(p, [{ type: "fx.put", trackId: t.id, effect: effect("probe", d.id) }, { type: "automation.put", automation: { ...p.automation[0], id: "probeauto", parameter: `fx.probe.${param.id}` } }]));
  }
});
test("FX automation targets use instance and semantic identity, independent of rack position", () => {
  const p = fixture(), q = applyEdits(p, [{ type: "fx.order", trackId: p.tracks[0].id, ids: ["space", "insert"] }]);
  assert.deepEqual(drive(p), drive(q));
  assert.deepEqual(compileFxAutomation(p, p.tracks[0], p.tracks[0].activeClipId), compileFxAutomation(q, q.tracks[0], q.tracks[0].activeClipId));
  assert.notEqual(rackCommand(p), rackCommand(q));
});
test("FX controls compile independently of note onsets and survive an all-rest clip", () => {
  const p = fixture(), c = p.clips[0]; if (c.kind !== "steps") throw Error(); c.steps.fill(0);
  assert.doesNotMatch(compileClip(p, c), /abx_fxcontrol|abxtoken/);
  assert.match(compileTrack(p, p.tracks[0])!, /stack \[.*\n.*slow 2 \$ s "abx_fxcontrol\*2"/);
  assert.match(compileTrack(p, p.tracks[0])!, /pF "abxvalue" "0.2 0.8"/);
});
test("FX clip automation overrides track lane; silence resets or retains track-wide motion", () => {
  let p = fixture();
  assert.match(compileTrack(p, p.tracks[0], null)!, /abxactive" 0/);
  p = applyEdits(p, [{ type: "automation.put", automation: { ...p.automation[0], id: "trackmotion", clipId: null, values: [0.1, 0.3] } }]);
  assert.match(compileTrack(p, p.tracks[0])!, /abxvalue" "0.2 0.8"/);
  assert.match(compileTrack(p, p.tracks[0], null)!, /abxvalue" "0.1 0.3"/);
  assert.match(compileTrack(disable(p), p.tracks[0])!, /abxvalue" "0.1 0.3"/);
});
test("FX removal clears only that instance's lanes and modulation", () => {
  let p = fixture(); p = applyEdits(p, [{ type: "automation.put", automation: { ...p.automation[0], id: "spaceauto", parameter: "fx.space.mix" } }]);
  const q = applyEdits(p, [{ type: "fx.remove", trackId: p.tracks[0].id, effectId: "insert" }]);
  assert.deepEqual(q.automation.map(a => a.parameter), ["fx.space.mix"]);
  assert.deepEqual(q.tracks[0].modulation, []);
  assert.doesNotMatch(rackCommand(q), /0_insert_distortion_1/);
});
test("FX removal Undo and Redo restore complete relevant authoring atomically", () => {
  const s = new ProjectService(), p = fixture(); s.acceptSwitch(p);
  s.commit(s.prepare([{ type: "fx.remove", trackId: p.tracks[0].id, effectId: "insert" }]), "Remove effect");
  s.acceptHistory(false, s.historyTarget(false));
  assert.deepEqual({ ...s.document, revision: p.revision }, p);
  s.acceptHistory(true, s.historyTarget(true)); assert.equal(s.document.automation.length, 0);
});
test("FX base edits preserve automation token, lane and engine modulation", () => {
  const p = fixture(), t = p.tracks[0], q = applyEdits(p, [{ type: "fx.put", trackId: t.id, effect: { ...t.effects![0], values: { ...t.effects![0].values, drive: 0.61 } } }]);
  assert.equal(drive(p).token, drive(q).token); assert.deepEqual(q.automation, p.automation); assert.deepEqual(q.tracks[0].modulation, t.modulation);
  assert.match(rackCommand(q), /\\abxdrive, 0.61/); assert.match(rackCommand(q), /\\mdriveamount, 0.15/);
});
test("FX automation disable resets selector to stored base while retaining modulation", () => {
  const p = fixture(), q = disable(p);
  assert.notEqual(drive(p).token, drive(q).token);
  assert.deepEqual(q.tracks, p.tracks);
  const command = rackCommand(q); assert.match(command, /removeAt\(authorization\)/); assert.match(command, /node.set\(\("a" \+\+ parts\[1\] \+\+ "enabled"\).asSymbol, 0\)/); assert.match(command, /\\mdriveamount, 0.15/);
  assert.match(SOUND_LAB_SYNTHS, /Select.kr\(\\adriveenabled.kr\(0\), \[\\abxdrive.kr\([\d.]+\), \\adrivevalue.kr/);
});
for (const remove of [false, true]) test(`FX modulation ${remove ? "removal" : "disable"} preserves automation and base`, () => {
  const p = fixture(), t = p.tracks[0], q = applyEdits(p, [remove ? { type: "modulation.remove", trackId: t.id, routeId: "lfo" } : { type: "modulation.put", trackId: t.id, route: { ...t.modulation![0], enabled: false } }]);
  assert.deepEqual(q.automation, p.automation); assert.deepEqual(q.tracks[0].effects, t.effects); assert.equal(drive(q).token, drive(p).token);
  assert.match(rackCommand(q), /\\mdriveamount, 0/);
});
test("FX save/reopen and process recovery preserve all three authored layers", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "fx-auto-store-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = fixture(), storage = new ProjectStorage(dir, path.join(dir, "recover")); storage.save("fx", p); storage.checkpoint(p);
  assert.deepEqual(storage.load("fx"), p); assert.deepEqual(new ProjectService(storage).document, p); assert.deepEqual(decodeProject(encodeProject(p)).document, p);
});
test("FX scene duplication copies clip lanes independently while retaining shared track FX identity", () => {
  const p = fixture(), q = applyEdits(p, [{ type: "scene.duplicate", sceneId: p.sceneOrder[0], newSceneId: "copy", name: "Copy" }]);
  const lane = q.automation.find(a => a.id !== "motion")!;
  assert.equal(lane.parameter, "fx.insert.drive"); assert.notEqual(lane.clipId, p.automation[0].clipId);
  const edited = applyEdits(q, [{ type: "automation.put", automation: { ...lane, values: [0.4, 0.5] } }]);
  assert.deepEqual(edited.automation.find(a => a.id === "motion"), p.automation[0]); assert.deepEqual(edited.tracks[0].effects, p.tracks[0].effects);
});
test("FX arrangement carries scene-specific controls in existing owned slots", () => {
  const p = fixture(), q = applyEdits(p, [{ type: "arrangement.set", entries: [{ id: "entry", sceneId: p.sceneOrder[0], cycles: 4 }] }]);
  assert.deepEqual(Object.keys(compileArrangement(q)), ["d1"]); assert.match(compileArrangement(q).d1, /timeCat.*\n.*abx_fxcontrol/);
});
test("Unsupported, missing and component/rack-position FX targets reject without mutation", () => {
  const p = fixture(), before = JSON.stringify(p);
  for (const parameter of ["fx.insert.time", "fx.missing.drive", "fx.0.drive", "fx.insert.nodeId", "rack.0.drive"]) assert.throws(() => applyEdits(p, [{ type: "automation.put", automation: { ...p.automation[0], parameter } }]));
  const invalid = structuredClone(p); invalid.automation[0].parameter = "fx.insert.nope"; assert.throws(() => validateProject(invalid), /Unsupported FX automation target/);
  assert.equal(JSON.stringify(p), before);
});
test("Unknown future FX definitions retain inert saved lanes but reject new authoring", () => {
  const p = fixture(); p.tracks[0].effects![0].version = 99;
  assert.deepEqual(decodeProject(encodeProject(p)).document, p); assert.equal(drive(p), undefined);
  assert.throws(() => applyEdits(p, [{ type: "automation.put", automation: p.automation[0] }]), /Unsupported FX/);
});
test("FX receiver guards queued callbacks, expires finite events and creates no audio voice", () => {
  assert.match(INSTALL_FX_AUTOMATION, /SystemClock.sched\(latency/); assert.match(INSTALL_FX_AUTOMATION, /SystemClock.sched\(duration/);
  for (const guard of ["tokens[authorization] == token", "versions[authorization] == version", "nodes[key] === node", "serials[target] == serial", "state[\\epoch] == epoch"]) assert.ok(INSTALL_FX_AUTOMATION.includes(guard), guard);
  assert.match(INSTALL_FX_AUTOMATION, /\}\); true;/); assert.doesNotMatch(INSTALL_FX_AUTOMATION, /Synth\.|Out\.ar|Routine/);
  assert.match(STOP_FX_AUTOMATION, /running\] = false/); assert.match(STOP_FX_AUTOMATION, /enabled.*0/);
  assert.match(rackCommand(fixture(), false), /\\running\] = false/);
  assert.match(rackCommand(fixture()), /abxFXAutoVersions.*abxFXAutoState/);
});
test("Existing synth automation and modulation compiler output stays unchanged when adding FX lanes", () => {
  let p = fixture(); p = applyEdits(p, [{ type: "automation.put", automation: { ...p.automation[0], id: "synthauto", parameter: "synth.cutoff" } }, { type: "modulation.put", trackId: p.tracks[0].id, route: { ...p.tracks[0].modulation![0], id: "synthmod", target: "synth.cutoff" } }]);
  const q = applyEdits(p, [{ type: "automation.delete", automationId: "motion" }]); assert.equal(compileClip(p, p.clips[0]), compileClip(q, q.clips[0]));
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

test("FX canonical application edits reject stale revisions and preserve all layers through engine recovery", async t => {
  const { app, engine, send } = application(t); app.project.acceptSwitch(fixture());
  assert.equal((await send("resume")).ok, true);
  assert.ok(engine.calls.some(c => c.includes("abx_fxcontrol")));
  const before = app.project.document, count = engine.calls.length;
  assert.equal((await send("project.edit", { revision: before.revision - 1, label: "Stale FX lane", edits: [{ type: "automation.put", automation: { ...before.automation[0], values: [0.1, 0.9] } }] })).ok, false);
  assert.equal(engine.calls.length, count); assert.deepEqual(app.project.document, before);
  assert.equal((await send("project.edit", { label: "Disable FX automation", edits: [{ type: "automation.put", automation: { ...before.automation[0], enabled: false } }] })).ok, true);
  assert.equal(app.project.document.tracks[0].modulation![0].enabled, true);
  assert.equal((await send("project.undo")).ok, true);
  assert.deepEqual(app.project.document.automation, before.automation);
  assert.equal((await send("reset")).ok, true); assert.equal(engine.generation, 1);
  assert.deepEqual(app.project.document.tracks, before.tracks);
  assert.equal((await send("stop")).ok, true); assert.equal(engine.calls.at(-1), STOP_FX_AUTOMATION);
  assert.equal((await send("resume")).ok, true);
  assert.ok(engine.calls.some(c => c.includes("abxFXAutoState[\\running] = true")));
});
test("FX scene performance keeps disabled automation disabled across recovery", async t => {
  const { app, engine, send } = application(t); app.project.acceptSwitch(fixture());
  const before = app.project.document;
  assert.equal((await send("scene.launch", { sceneId: before.sceneOrder[0], boundary: "immediate" })).ok, true);
  assert.equal((await send("project.edit", { label: "Disable FX lane", edits: [{ type: "automation.put", automation: { ...before.automation[0], enabled: false } }] })).ok, true);
  engine.calls.length = 0;
  assert.equal((await send("reset")).ok, true);
  const batch = engine.calls.find(c => c.includes("abxInstall"))!;
  assert.match(batch, /abxactive" 0/); assert.doesNotMatch(batch, /abxactive" 1/);
  assert.equal(app.project.document.tracks[0].modulation![0].enabled, true);
  assert.equal((await send("song.stop")).ok, true); assert.equal(engine.calls.at(-1), STOP_FX_AUTOMATION);
});

test("Editing or duplicating another scene preserves the active FX lane authorization", () => {
  const p = fixture(), q = applyEdits(p, [{ type: "scene.duplicate", sceneId: p.sceneOrder[0], newSceneId: "another", name: "Another" }]);
  assert.deepEqual(drive(p).authorizations, drive(q).authorizations.filter(a => !a.laneId || a.laneId === "motion"));
  assert.deepEqual(compileFxAutomation(p, p.tracks[0], p.tracks[0].activeClipId), compileFxAutomation(q, q.tracks[0], p.tracks[0].activeClipId));
  const edited = applyEdits(q, [{ type: "automation.put", automation: { ...q.automation.find(a => a.id !== "motion")!, values: [0.1, 0.4] } }]);
  assert.deepEqual(drive(p).authorizations, drive(edited).authorizations.filter(a => !a.laneId || a.laneId === "motion"));
});
