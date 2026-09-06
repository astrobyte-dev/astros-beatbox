import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyEdits, clone, emptyProject, validateProject, type ProjectDocument, type ProjectEdit } from "./project.js";
import { compileClip, compileTrack, channelValues, balanceGains } from "./project-compiler.js";
import { ProjectService } from "./project-service.js";
import { atomicWrite, decodeProject, encodeProject, ProjectStorage } from "./project-storage.js";

export function example(): ProjectDocument {
  const p = emptyProject();
  return applyEdits(p, [
    { type: "asset.put", asset: { id: "kick", name: "bd", reference: "bd", index: 0, kind: "sample" } },
    ...[1, 2].map(i => ({ type: "track.add", track: { id: "track" + i, name: "Track " + i, slot: i, channel: i - 1, activeClipId: null, mixer: { level: 1, balance: 0, mute: false, solo: false } } })),
    ...[1, 2].map(i => ({ type: "clip.put", clip: { id: "clip" + i, trackId: "track" + i, name: "Beat", kind: "steps", assetId: "kick", steps: [1, 0, 0.3, 0], swing: 0, parameters: { room: 0.4, shape: 0.2 } } })),
    { type: "clip.activate", trackId: "track1", clipId: "clip1" },
    { type: "clip.activate", trackId: "track2", clipId: "clip2" },
    { type: "scene.capture", sceneId: p.sceneOrder[0] },
    { type: "automation.put", automation: { id: "lane", trackId: "track1", clipId: "clip1", parameter: "cutoff", bars: 2, values: [0, 1, 0.5, 0.2], enabled: true } },
  ]);
}
test("stable track IDs, scene contents and automation survive track reordering", () => {
  const p = example(), q = applyEdits(p, [{ type: "track.order", ids: ["track2", "track1"] }]);
  assert.deepEqual(q.scenes, p.scenes); assert.deepEqual(q.automation, p.automation); assert.equal(q.tracks[0].slot, 2);
  assert.equal(compileTrack(p, p.tracks[0]), compileTrack(q, q.tracks[1]));
});
test("deterministic edit batches preserve velocity/effects and only replace intended sound", () => {
  const p = example(), edits = [{ type: "steps.set", clipId: "clip1", steps: [0.2, 1, 0, 0] }, { type: "mixer.set", trackId: "track1", values: { level: 0.1 } }];
  const q = applyEdits(p, edits); assert.deepEqual(q, applyEdits(p, edits));
  assert.deepEqual(q.clips[0].kind === "steps" && q.clips[0].parameters, { room: 0.4, shape: 0.2 });
  assert.match(compileClip(q, q.clips[0]), /gain "0.2 1 0 0"/); assert.match(compileClip(q, q.clips[0]), /# room 0.4/);
  const r = applyEdits(q, [{ type: "asset.put", asset: { ...q.assets[0], id: "snare", name: "sn", reference: "sn" } }, { type: "sound.set", clipId: "clip1", assetId: "snare" }]);
  assert.match(compileClip(r, r.clips[0]), /s "sn sn ~ ~"/); assert.deepEqual(r.clips[1], p.clips[1]);
});
test("managed code remains verbatim and visual edits cannot rewrite it", () => {
  const p = example(), source = 'every 3 (rev) $ s "bd*4" # gain (range 0.2 0.8 sine)';
  const q = applyEdits(p, [{ type: "clip.put", clip: { id: "clip1", trackId: "track1", name: "Code", kind: "code", source, managed: true, dependencyIds: [] } }, { type: "automation.delete", automationId: "lane" }, { type: "mixer.set", trackId: "track1", values: { level: 0, balance: -1 } }]);
  assert.equal(compileClip(q, q.clips[0]), source); assert.throws(() => applyEdits(q, [{ type: "steps.set", clipId: "clip1", steps: [1] }]), /requires a step clip/);
});
test("server grouped history, redo branching and deletion restore associated references", () => {
  const s = new ProjectService(); s.acceptSwitch(s.switchTarget(example())); const original = s.document;
  s.commit(s.prepare([{ type: "mixer.set", trackId: "track1", values: { level: 0.5 } }]), "Fader", "gesture");
  s.commit(s.prepare([{ type: "mixer.set", trackId: "track1", values: { level: 0.2 } }]), "Fader", "gesture");
  assert.equal(s.history.undo, 1); s.acceptHistory(false, s.historyTarget(false)); assert.equal(s.document.tracks[0].mixer.level, 1);
  s.acceptHistory(true, s.historyTarget(true)); assert.equal(s.document.tracks[0].mixer.level, 0.2);
  s.commit(s.prepare([{ type: "track.delete", trackId: "track1" }]), "Delete"); assert.equal(s.document.automation.length, 0);
  s.acceptHistory(false, s.historyTarget(false)); assert.deepEqual(s.document.scenes, original.scenes); assert.deepEqual(s.document.automation, original.automation);
  s.commit(s.prepare([{ type: "project.rename", name: "Branch" }]), "Rename"); assert.equal(s.history.redo, 0);
});
test("project switching and stale revisions reject edits, including same-file reopening", () => {
  const s = new ProjectService(), p = s.document; s.acceptSwitch(s.switchTarget(p));
  assert.throws(() => s.assert(p.id, p.revision), /Project changed/);
  assert.equal(s.history.undo, 0); assert.throws(() => s.assert("wrong", s.document.revision));
});
test("complete persistence round trip includes inactive clips/scenes, dependencies and arrangement", () => {
  const p = example(); p.tracks[0].activeClipId = null;
  p.arrangement = [{ id: "entry", sceneId: p.sceneOrder[0], cycles: 2 }];
  p.dependencies = [{ id: "dep", kind: "tidal", name: "Tidal", version: "1.10.1", source: "let custom = id" }];
  p.sources = [{ id: "artifact", name: "original.tidal", source: 'd1 $ s "bd"\n' }];
  assert.deepEqual(decodeProject(encodeProject(p)).document, p);
});
test("invalid schemas, versions, checksums and dangling references fail validation", () => {
  const p = example(); assert.throws(() => validateProject({ ...p, schemaVersion: 2 }));
  assert.throws(() => validateProject({ ...p, telemetry: {} }));
  const q = clone(p); q.scenes[0].clips.track1 = "absent"; assert.throws(() => validateProject(q));
  assert.throws(() => decodeProject(encodeProject(p).replace('"version": 1', '"version": 2')));
  assert.throws(() => decodeProject(encodeProject(p).replace('"Untitled"', '"Changed"')), /checksum/);
});
function temp(t: test.TestContext) { const dir = mkdtempSync(path.join(tmpdir(), "abx-project-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test("interrupted writes leave the previous file intact and never report successful commits", t => {
  const dir = temp(t), file = path.join(dir, "project.json"); atomicWrite(file, "old");
  for (const stage of ["written", "synced", "renaming"]) { assert.throws(() => atomicWrite(file, "new", at => { if (at === stage) throw new Error("interrupted"); })); assert.equal(readFileSync(file, "utf8"), "old"); }
  assert.deepEqual(readdirSync(dir), ["project.json"]);
  const storage = new ProjectStorage(dir, dir, () => { throw new Error("disk full"); }), s = new ProjectService(storage), p = s.document;
  assert.throws(() => s.commit(s.prepare([{ type: "project.rename", name: "lost" }]), "Rename")); assert.deepEqual(s.document, p); assert.equal(s.history.undo, 0);
});
test("durable recovery restores latest authored checkpoint, ignores orphan temps and falls back on corruption", t => {
  const dir = temp(t), storage = new ProjectStorage(dir, dir), s = new ProjectService(storage);
  s.commit(s.prepare([{ type: "project.rename", name: "First" }]), "Rename");
  s.commit(s.prepare([{ type: "project.rename", name: "Second" }]), "Rename");
  writeFileSync(path.join(dir, "checkpoint-1.json.orphan.tmp"), "arbitrary execution");
  assert.equal(new ProjectService(new ProjectStorage(dir, dir)).document.name, "Second");
  writeFileSync(path.join(dir, "checkpoint-0.json"), "partial");
  const recovered = new ProjectService(new ProjectStorage(dir, dir)); assert.equal(recovered.document.name, "First"); assert.ok(recovered.workspace.recoveryWarning);
});
test("missing assets remain explicit and are never replaced in the project", t => {
  const dir = temp(t), s = new ProjectService(); s.acceptSwitch(s.switchTarget(example()));
  const before = s.document; assert.equal(s.assets(dir)[0].status, "missing"); assert.deepEqual(s.document, before);
});
test("independent channel mixing, stereo balance, mute/solo and fixed routing capacity", () => {
  const p = example(); p.tracks[0].mixer.level = 0.3; p.tracks[0].mixer.solo = true;
  assert.deepEqual(channelValues(p).map(c => c.level), [0.3, 0]); p.tracks[0].mixer.mute = true; assert.equal(channelValues(p)[0].level, 0);
  assert.deepEqual(balanceGains(1, 0), [1, 1]); assert.deepEqual(balanceGains(0.5, -1), [0.5, 0]); assert.deepEqual(balanceGains(1, 1), [0, 1]);
  p.tracks[0].channel = 12; assert.throws(() => validateProject(p));
});
