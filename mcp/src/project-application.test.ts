import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Application, type CommandEngine } from "./application.js";
import { uid, type ProjectEdit } from "./project.js";
import { encodeProject } from "./project-storage.js";

class Engine implements CommandEngine {
  generation = 0; running = false; state = "idle"; error = null;
  calls: { interpreter: string; code: string }[] = [];
  effect = async (_code: string) => {};
  private async eval(interpreter: string, code: string, id = "test") { this.calls.push({ interpreter, code }); await this.effect(code); return { operationId: id, acknowledgement: "action" as const, output: "" }; }
  tidal = { eval: (c: string, id?: string) => this.eval("tidal", c, id), hush: (id?: string) => this.eval("tidal", "hush", id) };
  sclang = { eval: (c: string, id?: string) => this.eval("sc", c, id), evalRoutine: (c: string, id?: string) => this.eval("sc", c, id) };
  async ensureBooted() { this.running = true; this.state = "ready"; }
  async reboot() { this.generation++; await this.ensureBooted(); }
  assertGeneration(g: number) { if (g !== this.generation) throw new Error("stale generation"); }
}
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-project-app-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = new Engine(), app = new Application(engine, { sets: dir, recordings: dir, device: path.join(dir, "device"), projects: dir, recovery: path.join(dir, "recovery") });
  const send = (cmd: string, args: object = {}) => app.dispatchExternal({ cmd, projectId: app.project.document.id, revision: app.project.document.revision, ...args });
  const edit = (edits: ProjectEdit[], label = "Batch", groupId?: string) => send("project.edit", { edits, label, groupId });
  return { dir, engine, app, send, edit };
}
const add: ProjectEdit[] = [
  { type: "asset.put", asset: { id: "asset", name: "bd", reference: "bd", kind: "sample", index: 0 } },
  { type: "track.add", track: { id: "track", slot: 1, channel: 0, name: "Kick", activeClipId: "clip", mixer: { level: 1, balance: 0, mute: false, solo: false } } },
  { type: "clip.put", clip: { id: "clip", trackId: "track", kind: "steps", name: "A", assetId: "asset", steps: [1, 0, 0.4, 0], parameters: { room: 0.2 }, swing: 0 } },
];
test("external legacy and project operations require identity/revision before engine work", async t => {
  const { app, engine } = fixture(t);
  for (const cmd of [{ cmd: "eval", value: 'd1 $ s "bd"' }, { cmd: "resume" }, { cmd: "tempo", value: 123 }]) { const r = await app.dispatchExternal(cmd); assert.ok(!r.ok && r.code === "STALE_PROJECT"); }
  assert.equal(engine.calls.length, 0);
});
test("atomic MCP-shaped batch, deduplicated retry, grouped faders and cross-client undo", async t => {
  const { app, send, edit } = fixture(t), p = app.project.document;
  const request = { cmd: "project.edit", projectId: p.id, revision: p.revision, edits: add, label: "MCP batch", operationId: uid(), sessionId: app.sessionId, issuedAt: Date.now() };
  const a = await app.dispatchExternal(request); assert.equal(a.ok, true); assert.deepEqual(await app.dispatchExternal(request), a); assert.equal(app.project.history.undo, 1);
  await edit([{ type: "mixer.set", trackId: "track", values: { level: 0.5 } }], "Fader", "drag");
  await edit([{ type: "mixer.set", trackId: "track", values: { level: 0.2 } }], "Fader", "drag"); assert.equal(app.project.history.undo, 2);
  await send("project.undo"); assert.equal(app.project.document.tracks[0].mixer.level, 1);
  await send("project.undo"); assert.equal(app.project.document.tracks.length, 0);
  await send("project.redo"); assert.equal(app.project.document.clips.length, 1);
});
test("stale revisions are checked at queue execution and failed batches leave no partial document", async t => {
  const { app, edit } = fixture(t), p = app.project.document;
  const a = edit(add), b = app.dispatchExternal({ cmd: "project.edit", projectId: p.id, revision: p.revision, edits: [{ type: "project.rename", name: "stale" }], label: "stale" });
  assert.equal((await a).ok, true); const r = await b; assert.ok(!r.ok && r.code === "STALE_PROJECT");
  const before = app.project.document;
  assert.equal((await edit([{ type: "project.rename", name: "partial" }, { type: "track.delete", trackId: "missing" }])).ok, false); assert.deepEqual(app.project.document, before);
});
test("mixer level never reschedules Tidal or changes velocity, including sustained managed code", async t => {
  const { app, engine, send, edit } = fixture(t); await edit(add); await send("resume"); engine.calls = [];
  const clips = app.project.document.clips; await edit([{ type: "mixer.set", trackId: "track", values: { level: 0.1, balance: -1 } }]);
  assert.deepEqual(app.project.document.clips, clips); assert.equal(engine.calls.length, 1); assert.equal(engine.calls[0].interpreter, "sc"); assert.match(engine.calls[0].code, /abxChannels\[0\].*level, 0.1/);
  await edit([{ type: "clip.put", clip: { id: "clip", trackId: "track", name: "Held", kind: "code", managed: true, source: 's "supersaw" # sustain 8 # gain 0.2', dependencyIds: [] } }]); engine.calls = [];
  await edit([{ type: "mixer.set", trackId: "track", values: { mute: true } }]); assert.equal(engine.calls.length, 1); assert.equal(engine.calls[0].interpreter, "sc");
});
test("project engine failures retain document/history and do not claim an applied revision", async t => {
  const { app, engine, send, edit } = fixture(t); await edit(add); await send("resume");
  const before = app.project.document, history = app.project.history;
  engine.effect = async c => { if (c.includes('abxChannels')) throw new Error("mixer failed"); };
  assert.equal((await edit([{ type: "mixer.set", trackId: "track", values: { level: 0.2 } }])).ok, false);
  assert.deepEqual(app.project.document, before); assert.deepEqual(app.project.history, history); assert.equal(app.runtime.appliedRevision, null); assert.equal(app.rig.synchronized, false);
});
test("Stop, recording, engine restart and Play do not become project history", async t => {
  const { app, send, edit } = fixture(t); await edit(add); const h = app.project.history.undo;
  await send("resume"); await send("stop"); await send("reset"); await send("resume");
  assert.equal(app.project.history.undo, h); assert.equal(app.project.document.clips.length, 1);
});
test("save/reopen preserves inactive material; invalid load leaves usable project untouched", async t => {
  const { app, dir, send, edit } = fixture(t); await edit(add);
  const sceneId = app.project.document.sceneOrder[1]; await edit([{ type: "scene.capture", sceneId }, { type: "clip.activate", trackId: "track", clipId: null }]);
  const p = app.project.document; assert.equal((await send("project.save", { value: "complete" })).ok, true);
  await send("project.new"); assert.equal((await send("project.load", { value: "complete" })).ok, true);
  assert.deepEqual(app.project.document.clips, p.clips); assert.deepEqual(app.project.document.scenes, p.scenes); assert.equal(app.project.document.tracks[0].activeClipId, null);
  writeFileSync(path.join(dir, "broken.abx.json"), "partial"); const before = app.project.document;
  assert.equal((await send("project.load", { value: "broken" })).ok, false); assert.deepEqual(app.project.document, before);
  assert.ok(app.project.document.revision > p.revision); assert.equal(app.project.history.undo, 0);
  await edit([{ type: "scene.activate", sceneId }]);
  await send("project.save", { value: "scene-b" }); await send("project.new"); await send("project.load", { value: "scene-b" });
  assert.equal(app.project.workspace.selectedSceneId, sceneId, "reopen selects the scene matching the restored clips");
});
test("recovery restores authored state stopped without replaying code or booting", async t => {
  const { app, dir, edit } = fixture(t); await edit(add);
  const engine = new Engine(), reopened = new Application(engine, { sets: dir, recordings: dir, device: path.join(dir, "device"), projects: dir, recovery: path.join(dir, "recovery") });
  assert.deepEqual(reopened.project.document, app.project.document); assert.equal(reopened.rig.stopped, true); assert.equal(engine.calls.length, 0); assert.equal(reopened.runtime.appliedRevision, null);
});
test("schema-valid load with broken managed code does not clear the old project", async t => {
  const { app, engine, dir, edit, send } = fixture(t); await edit(add); await send("resume"); const before = app.project.document;
  const next = app.project.document; next.clips[0] = { id: "clip", trackId: "track", name: "Broken", kind: "code", managed: true, source: "broken", dependencyIds: [] };
  writeFileSync(path.join(dir, "bad-code.abx.json"), encodeProject(next)); engine.effect = async c => { if (c.includes("broken")) throw new Error("compile failure"); };
  assert.equal((await send("project.load", { value: "bad-code" })).ok, false); assert.deepEqual(app.project.document, before);
});

test("missing sample indices are retained but never substituted by the audio compiler", async t => {
  const { dir, engine } = fixture(t);
  const app = new Application(engine, { sets: dir, recordings: dir, device: path.join(dir, "device"), samples: dir });
  const p = app.project.document;
  assert.equal((await app.dispatchExternal({ cmd: "project.edit", projectId: p.id, revision: p.revision, edits: add, label: "Missing sample" })).ok, true);
  const q = app.project.document; assert.equal((await app.dispatchExternal({ cmd: "resume", projectId: q.id, revision: q.revision })).ok, true);
  assert.equal(app.project.assets(dir)[0].status, "missing"); assert.equal(app.project.document.tracks[0].activeClipId, "clip");
  assert.ok(!engine.calls.some(c => c.code.startsWith("d1 $")), "do not play a replacement sound");
});

test("late or partial runtime uncertainty is not cleared by an unrelated project rename", async t => {
  const { app, engine, send, edit } = fixture(t); await edit(add); await send("resume");
  app.rig.synchronized = false; app.runtime.appliedRevision = null; engine.calls = [];
  await edit([{ type: "project.rename", name: "Still uncertain" }]);
  assert.equal(app.rig.synchronized, false); assert.equal(app.runtime.appliedRevision, null); assert.equal(engine.calls.length, 0);
});

test("raw editing does not discard multiple managed solo selections", async t => {
  const { app, send, edit } = fixture(t); await edit(add);
  await edit([{ type: "track.add", track: { id: "second", name: "Second", slot: 2, channel: 1, activeClipId: null, mixer: { level: 1, balance: 0, mute: false, solo: true } } }, { type: "mixer.set", trackId: "track", values: { solo: true } }]);
  await send("eval", { value: 'd3 $ s "cp"' }); assert.deepEqual(app.project.document.tracks.slice(0, 2).map(t => t.mixer.solo), [true, true]);
});
