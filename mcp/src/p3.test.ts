import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Application, type CommandEngine } from "./application.js";
import { applyEdits, emptyProject, type ProjectEdit } from "./project.js";
import { pocketGroove } from "./studio-starter.js";
import { compileClip, compileTrack, compileArrangement } from "./project-compiler.js";
import { nextBoundary, arrangementPosition, preparedBatch, sceneProjection } from "./performance.js";

class ClockEngine implements CommandEngine {
  generation = 0; running = false; state = "idle"; error = null;
  cycle = 2.25; calls: string[] = []; fail = "";
  tidal = { eval: async (code: string, id = "fixture") => {
    this.calls.push(code);
    if (this.fail && code.includes(this.fail)) throw new Error("Injected preparation failure");
    return { operationId: id, acknowledgement: "action" as const, output: code.includes("abxInstall") ? "ABX_SCHEDULED " + nextBoundary(this.cycle, code.includes("abxInstall True") ? "cycle" : "immediate") : "" };
  }, hush: async () => this.tidal.eval("hush") };
  sclang = { eval: async (code: string, id = "fixture") => { this.calls.push(code); return { operationId: id, acknowledgement: "action" as const, output: "" }; }, evalRoutine: async (code: string, id?: string) => this.sclang.eval(code, id) };
  async ensureBooted() { this.running = true; this.state = "ready"; }
  async reboot() { this.generation++; await this.ensureBooted(); }
  stop() { this.running = false; this.state = "idle"; }
  assertGeneration(g: number) { assert.equal(g, this.generation); }
}
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-p3-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = new ClockEngine(), app = new Application(engine, { sets: dir, recordings: dir, projects: dir, recovery: path.join(dir, "recovery"), device: path.join(dir, "device") });
  const send = (cmd: string, args: object = {}) => app.dispatchExternal({ cmd, projectId: app.project.document.id, revision: app.project.document.revision, ...args });
  const edit = (edits: ProjectEdit[], label = "P3 gesture") => send("project.edit", { edits, label });
  return { app, engine, send, edit, dir };
}
function groove() { const p = emptyProject(); return applyEdits(p, pocketGroove(p)); }
test("P3 scene duplication copies independent clips and clip motion, preserving track IDs", () => {
  let p = groove(); const source = p.scenes[0], track = p.tracks[0];
  p = applyEdits(p, [{ type: "automation.put", automation: { id: "motion", trackId: track.id, clipId: track.activeClipId, parameter: "room", enabled: true, values: [0, 1], bars: 4 } }, { type: "scene.duplicate", sceneId: source.id, newSceneId: "lift", name: "Lift" }]);
  const originalDocument = groove();
  const edits = [{ type: "scene.duplicate" as const, sceneId: originalDocument.scenes[0].id, newSceneId: "deterministic-copy", name: "Copy" }];
  assert.deepEqual(applyEdits(originalDocument, edits), applyEdits(originalDocument, edits), "duplicate reducer is deterministic");
  const copy = p.scenes.find(s => s.id === "lift")!;
  assert.notEqual(copy.clips[track.id], source.clips[track.id]); assert.equal(p.automation.length, 2);
  const before = p.clips.find(c => c.id === source.clips[track.id]);
  p = applyEdits(p, [{ type: "steps.set", clipId: copy.clips[track.id]!, steps: [0, 1] }]);
  assert.deepEqual(p.clips.find(c => c.id === before!.id), before);
  assert.deepEqual(sceneProjection(p, "lift").tracks.map(t => t.id), p.tracks.map(t => t.id));
});
test("P3 create rename reorder silence and safe deletion preserve stable arrangement references", () => {
  let p = groove(); const first = p.scenes[0].id, tid = p.tracks[0].id;
  p = applyEdits(p, [{ type: "scene.create", sceneId: "break", name: "Break" }, { type: "scene.rename", sceneId: first, name: "Groove" }, { type: "scene.silence", sceneId: first, trackId: tid }, { type: "arrangement.set", entries: [{ id: "entry", sceneId: first, cycles: 4 }] }]);
  p = applyEdits(p, [{ type: "scene.order", ids: [...p.sceneOrder].reverse() }, { type: "track.order", ids: p.tracks.map(t => t.id).reverse() }]);
  assert.equal(p.arrangement[0].sceneId, first); assert.equal(p.scenes.find(s => s.id === first)!.clips[tid], null);
  p = applyEdits(p, [{ type: "scene.delete", sceneId: first }]); assert.equal(p.arrangement.length, 0);
  assert.throws(() => applyEdits(p, p.scenes.map(s => ({ type: "scene.delete", sceneId: s.id }))));
});
test("P3 scene duplicate and delete each undo in one intention including references", async t => {
  const { app, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const before = app.project.document;
  await edit([{ type: "scene.duplicate", sceneId: before.scenes[0].id, newSceneId: "lift", name: "Lift" }], "Duplicate scene");
  assert.equal(app.project.history.undoLabel, "Duplicate scene"); await send("project.undo"); assert.deepEqual(app.project.document.clips, before.clips);
  await send("project.redo"); await edit([{ type: "arrangement.set", entries: [{ id: "entry", sceneId: "lift", cycles: 2 }] }]);
  await edit([{ type: "scene.delete", sceneId: "lift" }]); assert.equal(app.project.document.arrangement.length, 0);
  await send("project.undo"); assert.equal(app.project.document.arrangement[0].sceneId, "lift");
});
test("P3 cycle boundaries are strictly next cycle, independent of tempo or wall time", () => {
  for (const [now, expected] of [[0, 1], [2.99999, 3], [3, 4], [9000.5, 9001]]) assert.equal(nextBoundary(now, "cycle"), expected);
  assert.equal(nextBoundary(2.25, "immediate"), 2.25); assert.throws(() => nextBoundary(NaN, "cycle"));
});
test("P3 queued multi-track launch uses one prepared engine action; repeat clicks deduplicate", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const sceneId = app.project.document.scenes[0].id, history = app.project.history;
  assert.equal((await send("scene.launch", { sceneId })).ok, true);
  assert.equal(app.performance.queuedSceneId, sceneId); assert.equal(app.performance.startCycle, 3);
  const calls = engine.calls.length; await send("scene.launch", { sceneId }); assert.equal(engine.calls.length, calls);
  const batch = engine.calls.find(c => c.includes("abxInstall"))!; assert.match(batch, /"1"/); assert.match(batch, /"16"/);
  assert.equal(engine.calls.filter(c => c.includes("abxInstall")).length, 1);
  app.observeCycle(2.99); assert.equal(app.performance.sceneId, null); app.observeCycle(3); assert.equal(app.performance.sceneId, sceneId);
  assert.deepEqual(app.project.history, history);
});
test("P3 immediate launch and explicit repeat are performance state, never authored history", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const sceneId = app.project.document.scenes[0].id;
  await send("scene.launch", { sceneId, boundary: "immediate" }); assert.equal(app.performance.sceneId, sceneId);
  const count = engine.calls.length; await send("scene.launch", { sceneId, repeat: true }); assert.ok(engine.calls.length > count);
});
test("P3 stale scene commands reject before audio, and opening a project cancels old performance", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const p = app.project.document;
  await edit([{ type: "project.rename", name: "New revision" }]); const count = engine.calls.length;
  const stale = await send("scene.launch", { sceneId: p.scenes[0].id, revision: p.revision }); assert.ok(!stale.ok && stale.code === "STALE_PROJECT"); assert.equal(engine.calls.length, count);
  await send("scene.launch", { sceneId: p.scenes[0].id }); await send("project.new");
  app.observeCycle(99); assert.equal(app.performance.sceneId, null); assert.equal(app.rig.stopped, true); assert.equal(app.runtime.song, false);
});
test("P3 preparation failure never claims a scene was queued or document committed", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const before = app.project.document;
  engine.fail = "abxInstall"; const r = await send("scene.launch", { sceneId: before.scenes[0].id });
  assert.equal(r.ok, false); assert.equal(app.performance.queuedSceneId, null); assert.equal(app.runtime.appliedRevision, null); assert.deepEqual(app.project.document, before); assert.match(app.runtime.error!, /unconfirmed/);
});
test("P3 arrangement repeats, looping, finite end and silent sections use cycle positions", () => {
  let p = groove(); p.arrangement = [{ id: "groove", sceneId: p.scenes[0].id, cycles: 4 }, { id: "silence", sceneId: p.scenes[1].id, cycles: 2 }];
  assert.equal(arrangementPosition(p, 10, 13.9).repeat, 4); assert.equal(arrangementPosition(p, 10, 14).entryId, "silence");
  assert.equal(arrangementPosition(p, 10, 16).entryId, "groove"); p.arrangementLoop = false; assert.equal(arrangementPosition(p, 10, 16).ended, true);
  const source = preparedBatch(compileArrangement(p), "cycle", { cycles: 6, loop: false }); assert.match(source, /filterWhen/); assert.match(source, /rotR abxStart/); assert.match(source, /silence/);
});
test("P3 arrangement continues with zero clients; observations never send engine commands", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document));
  await edit([{ type: "arrangement.set", entries: [{ id: "a", sceneId: app.project.document.scenes[0].id, cycles: 2 }, { id: "b", sceneId: app.project.document.scenes[1].id, cycles: 1 }] }]);
  await send("song.start"); const count = engine.calls.length;
  for (const cycle of [3, 4, 5, 6, 33, 303]) app.observeCycle(cycle);
  assert.equal(app.performance.entryId, "a"); assert.equal(engine.calls.length, count); assert.equal(app.projectState().projectRuntime.performance.startCycle, 3);
  await edit([{ type: "tempo.set", bpm: 180, beatsPerCycle: 4 }]); assert.equal(app.performance.startCycle, 3); assert.equal(engine.calls.filter(c => c.includes("abxInstall")).length, 1);
});
test("P3 live composition edits retain launched revision until explicit relaunch", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const p = app.project.document;
  await send("scene.launch", { sceneId: p.scenes[0].id }); const n = engine.calls.filter(c => c.includes("abxInstall")).length;
  await edit([{ type: "steps.set", clipId: p.tracks[0].activeClipId!, steps: [0, 1] }]); assert.equal(engine.calls.filter(c => c.includes("abxInstall")).length, n);
  assert.equal(app.runtime.appliedRevision, p.revision); await send("scene.launch", { sceneId: p.scenes[0].id }); assert.equal(app.runtime.appliedRevision, app.project.document.revision);
});
test("P3 active references cannot be removed until Stop, then deletion is reversible", async t => {
  const { app, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const p = app.project.document;
  await send("scene.launch", { sceneId: p.scenes[0].id }); assert.equal((await edit([{ type: "scene.delete", sceneId: p.scenes[0].id }])).ok, false);
  await send("stop"); assert.equal((await edit([{ type: "scene.delete", sceneId: p.scenes[0].id }])).ok, true);
});
test("P3 automation overrides base gain but preserves velocity; disable restores exact base", () => {
  let p = groove(); const clip = p.clips[0]; assert.ok(clip.kind === "steps"); clip.parameters.gain = 0.5;
  const original = compileClip(p, clip);
  p = applyEdits(p, [{ type: "automation.put", automation: { id: "gain-motion", trackId: clip.trackId, clipId: clip.id, parameter: "gain", enabled: true, bars: 2, values: [0, 1] } }]);
  const automated = compileClip(p, p.clips[0]); assert.ok(!automated.includes("|* gain 0.5")); assert.match(automated, /# gain "/);
  p.automation[0].enabled = false; assert.equal(compileClip(p, p.clips[0]), original);
});
test("P3 automation collision rejected; clip scope explicitly overrides track scope", () => {
  let p = groove(); const clip = p.clips[0], lane = { id: "lane", trackId: clip.trackId, clipId: null, parameter: "room" as const, enabled: true, bars: 1, values: [0, 1] };
  p = applyEdits(p, [{ type: "automation.put", automation: lane }]);
  assert.throws(() => applyEdits(p, [{ type: "automation.put", automation: { ...lane, id: "collision" } }]));
  p = applyEdits(p, [{ type: "automation.put", automation: { ...lane, id: "specific", clipId: clip.id, values: [0.2, 0.4] } }]); assert.match(compileClip(p, p.clips[0]), /room "0.2 0.4"/);
});
test("P3 managed draft failure retains playing source, exact text, dependencies and mixer", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const clip = app.project.document.clips[0];
  const source = '  s "supersaw"\n # sustain 8  -- retained tail comment';
  await edit([{ type: "dependencies.set", dependencies: [{ id: "dep", kind: "tidal", name: "Tidal", version: "1.10", source: "-- retained" }] }, { type: "clip.put", clip: { id: clip.id, trackId: clip.trackId, kind: "code", name: "Synth code", source, managed: true, dependencyIds: ["dep"] } }]);
  assert.ok(compileTrack(app.project.document, app.project.document.tracks[0])!.includes(source + "\n) # orbit"), "routing must not be swallowed by a trailing source comment");
  await send("resume"); await edit([{ type: "code.draft", clipId: clip.id, source: "  broken draft  " }]); engine.fail = "broken draft";
  assert.equal((await send("code.apply", { clipId: clip.id })).ok, false);
  const retained = app.project.document.clips[0]; assert.ok(retained.kind === "code"); assert.equal(retained.source, source); assert.equal(retained.draft, "  broken draft  ");
  await edit([{ type: "mixer.set", trackId: clip.trackId, values: { level: 0.2 } }]); assert.deepEqual(app.project.document.clips[0], retained);
  engine.fail = ""; await edit([{ type: "code.draft", clipId: clip.id, source: 's "bd"' }]); assert.equal((await send("code.apply", { clipId: clip.id })).ok, true);
  const applied = app.project.document.clips[0]; assert.ok(applied.kind === "code"); assert.equal(applied.source, 's "bd"'); assert.deepEqual(applied.dependencyIds, ["dep"]);
});
test("P3 external mutation stays explicit; authored edits never overwrite it automatically", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document));
  await send("eval", { value: 'once $ s "bd"' }); assert.equal(app.projectState().projectRuntime.externallyModified, true);
  const count = engine.calls.length; await edit([{ type: "parameter.set", clipId: app.project.document.clips[0].id, parameter: "room", value: 0.5 }]); assert.equal(engine.calls.length, count);
  assert.equal((await send("scene.launch", { sceneId: app.project.document.scenes[0].id })).ok, false);
  assert.equal((await send("performance.return")).ok, true); assert.equal(app.projectState().projectRuntime.externallyModified, false);
});
test("P3 save reopen preserves composition, drafts, loop, motion and history; runtime reopens stopped", async t => {
  const { app, edit, send } = fixture(t); await edit(pocketGroove(app.project.document));
  await edit([{ type: "scene.duplicate", sceneId: app.project.document.scenes[0].id, newSceneId: "lift", name: "Lift" }, { type: "arrangement.set", entries: [{ id: "one", sceneId: "lift", cycles: 8 }] }, { type: "arrangement.loop", enabled: false }]);
  const clip = app.project.document.clips[0];
  await edit([{ type: "automation.put", automation: { id: "motion", trackId: clip.trackId, clipId: clip.id, parameter: "room", values: [0, 1], bars: 4, enabled: true } }]);
  const saved = app.project.document; await send("project.save", { value: "composition" }); await send("song.start"); await send("project.new"); await send("project.load", { value: "composition" });
  const reopened = app.project.document; assert.deepEqual({ ...reopened, revision: saved.revision }, saved); assert.equal(app.rig.stopped, true); assert.equal(app.performance.startCycle, null); assert.equal(app.project.history.undo, 0);
});
test("P3 generation changes and backwards observations cannot fabricate a transition", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); await send("scene.launch", { sceneId: app.project.document.scenes[0].id });
  app.observeCycle(9, engine.generation + 1); assert.equal(app.performance.sceneId, null);
  app.observeCycle(2.9); app.observeCycle(1); assert.equal(app.performance.clock, "unavailable"); assert.equal(app.performance.sceneId, null);
});
test("P3 Tidal batch installs under the existing lock with cycle transition, no thread scheduling", () => {
  const source = readFileSync(new URL("../../tidal/BootTidal.hs", import.meta.url), "utf8");
  assert.match(source, /modifyMVar \(ABXStream.sPMapMV tidal\)/); assert.match(source, /ABXTransition.jumpIn' 0 now/); assert.match(source, /mapM_ \(abxPrepare/);
  assert.doesNotMatch(source, /threadDelay|forkIO/);
});
test("P3 restart keeps live tempo and mix while preserving launched scene material", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const before = app.project.document;
  await send("scene.launch", { sceneId: before.scenes[0].id }); app.observeCycle(3);
  await edit([{ type: "tempo.set", bpm: 180, beatsPerCycle: 4 }, { type: "mixer.set", trackId: before.tracks[0].id, values: { level: 0.2 } }, { type: "steps.set", clipId: before.clips[0].id, steps: [0, 1] }]);
  engine.calls = []; assert.equal((await send("reset")).ok, true);
  assert.ok(engine.calls.some(c => c.includes("setcps (180/60/4)"))); assert.ok(engine.calls.some(c => c.includes("level, 0.2")));
  const batch = engine.calls.find(c => c.includes("abxInstall"))!; assert.ok(batch.includes(compileClip(before, before.clips[0])));
});
test("P3 raw mutation during a performance invalidates the managed playback claim", async t => {
  const { app, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); await send("scene.launch", { sceneId: app.project.document.scenes[0].id });
  await send("eval", { value: 'd1 $ s "hh"' }); assert.equal(app.projectState().projectRuntime.externallyModified, true); assert.equal(app.performance.startCycle, null);
  assert.equal((await send("project.new")).ok, false); assert.equal((await send("resume")).ok, false);
});
test("P3 automation enable/disable, base edits and track reorder undo without losing lanes", async t => {
  const { app, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const clip = app.project.document.clips[0];
  const lane = { id: "motion", trackId: clip.trackId, clipId: clip.id, parameter: "room" as const, values: [0, 1], bars: 4, enabled: true };
  await edit([{ type: "automation.put", automation: lane }]);
  await edit([{ type: "parameter.set", clipId: clip.id, parameter: "room", value: 0.3 }, { type: "track.order", ids: app.project.document.tracks.map(t => t.id).reverse() }]);
  assert.deepEqual(app.project.document.automation, [lane]);
  await edit([{ type: "automation.put", automation: { ...lane, enabled: false } }], "Disable motion"); assert.match(compileClip(app.project.document, app.project.document.clips[0]), /room 0.3/);
  await send("project.undo"); assert.deepEqual(app.project.document.automation, [lane]); await send("project.redo"); assert.equal(app.project.document.automation[0].enabled, false);
});
test("P3 missing scheduling acknowledgement is failure even after interpreter completion", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document));
  engine.tidal.eval = async (_code, operationId = "fixture") => ({ operationId, acknowledgement: "action", output: "" });
  const r = await send("scene.launch", { sceneId: app.project.document.scenes[0].id }); assert.equal(r.ok, false); assert.equal(app.performance.startCycle, null); assert.equal(app.rig.synchronized, false);
});
test("P3 stopped performance cannot be revived by later clock observations", async t => {
  const { app, engine, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); await send("scene.launch", { sceneId: app.project.document.scenes[0].id });
  await send("stop"); const count = engine.calls.length; app.observeCycle(100); assert.equal(engine.calls.length, count); assert.equal(app.performance.sceneId, null); assert.equal(app.performance.queuedSceneId, null);
});
test("P3 failed managed drafts and dependency declarations survive recovery verbatim", async t => {
  const { app, engine, dir, edit, send } = fixture(t); await edit(pocketGroove(app.project.document)); const clip = app.project.document.clips[0];
  await edit([{ type: "dependencies.set", dependencies: [{ id: "dependency", kind: "tidal", name: "Bindings", version: "1", source: "let exact = 3\n" }] }, { type: "clip.put", clip: { id: clip.id, trackId: clip.trackId, kind: "code", managed: true, name: "Code", source: "silence", dependencyIds: ["dependency"] } }, { type: "code.draft", clipId: clip.id, source: "  BROKEN\n  draft  " }]);
  engine.fail = "BROKEN"; assert.equal((await send("code.apply", { clipId: clip.id })).ok, false);
  const reopened = new Application(new ClockEngine(), { sets: dir, recordings: dir, projects: dir, recovery: path.join(dir, "recovery"), device: path.join(dir, "device") });
  assert.deepEqual(reopened.project.document, app.project.document); assert.equal(reopened.rig.stopped, true); assert.equal(reopened.performance.startCycle, null);
});
test("P3 scene model accepts existing synth assets and managed code without sample identity", () => {
  let p = groove(); const asset = p.assets[0]; p.assets[0] = { ...asset, kind: "synth", name: "supersaw", reference: "supersaw" };
  p = applyEdits(p, [{ type: "scene.duplicate", sceneId: p.scenes[0].id, newSceneId: "synth-section", name: "Synth section" }]);
  assert.match(compileClip(p, p.clips[0]), /supersaw/); assert.equal(p.scenes.find(s => s.id === "synth-section")!.clips[p.tracks[0].id] !== null, true);
});
test("P3 preserves P0a tracked do batches and explicit Reset after external work", async t => {
  const { app, send, dir } = fixture(t);
  assert.equal((await send("eval", { value: 'do { setcps (120/60/4); d1 $ s "bd*4" # gain 0.8; d2 $ s "~ cp" # gain 0.5 }' })).ok, true);
  assert.equal(app.projectState().projectRuntime.externallyModified, false); const slots = { ...app.rig.slots };
  await send("stop"); assert.equal((await send("resume")).ok, true); assert.deepEqual(app.rig.slots, slots);
  await send("eval", { value: "let p0aValue = 42" }); assert.equal(app.projectState().projectRuntime.externallyModified, true);
  await send("stop"); assert.equal((await send("reset")).ok, true); assert.equal(app.rig.stopped, true); assert.deepEqual(app.rig.slots, slots); assert.equal(app.projectState().projectRuntime.externallyModified, false);
  assert.equal((await send("resume")).ok, true);
  writeFileSync(path.join(dir, "external.tidal"), 'let imported = 42\nd1 $ s "bd"\n');
  assert.equal((await send("load", { value: "external" })).ok, true);
  assert.equal(app.projectState().projectRuntime.externallyModified, true); assert.equal(app.rig.synchronized, false);
});
