import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, renameSync, symlinkSync, existsSync, truncateSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import { Application } from "./application.js";
import { fixtureWav, SamplingFixtureEngine } from "./sampling-test-fixture.js";
import { UserAudioLibrary, analyze, safeAudioPath } from "./user-audio.js";
import { defaultPlayback, AUDIO_LIMIT } from "./sampling.js";
import { applyEdits, validateProject, type StepClip } from "./project.js";
import { compileClip, compileArrangement } from "./project-compiler.js";
import { encodeProject, decodeProject } from "./project-storage.js";
import { rackCommand } from "./sound-lab-engine.js";
import { effects, defaults } from "./sound-lab.js";
import { startDashboard } from "./dashboard.js";
import { DASHBOARD_HTML } from "./config.js";
import { INPUT_SYNTHS, FINISH_CAPTURE } from "./capture.js";
import { INSTALL_SAMPLE_ENVELOPE } from "./sampling-engine.js";

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-sampling-"));
  const paths = { sets: dir, projects: path.join(dir, "projects"), recovery: path.join(dir, "recovery"), recordings: path.join(dir, "recordings"), device: path.join(dir, "device") };
  const engine = new SamplingFixtureEngine(), app = new Application(engine, paths);
  const file = path.join(dir, "spoken.wav"); writeFileSync(file, fixtureWav());
  const send = (cmd: string, args = {}) => app.dispatchExternal({ cmd, projectId: app.project.document.id, revision: app.project.document.revision, ...args });
  const importSound = async () => { const result = await send("audio.import", { value: file }); assert.ok(result.ok, JSON.stringify(result)); return app.userAudio.list()[0]; };
  const add = async () => { const entry = await importSound(); assert.ok((await send("audio.add", { value: entry.id })).ok); return app.project.document.clips[0] as StepClip; };
  const capture = async () => { assert.ok((await send("capture.prepare", { device: "Fixture microphone", channel: 0 })).ok); assert.ok((await send("capture.start", { value: "Spoken take" })).ok); return app.capture.snapshot().activeId!; };
  t.after(async () => { if (app.capture.snapshot().activeId) await send("capture.stop", { value: app.capture.snapshot().activeId }); await send("stop"); engine.stop(); rmSync(dir, { force: true, recursive: true }); });
  return { dir, paths, app, engine, file, send, importSound, add, capture };
}

for (const channels of [1, 2]) test(`WAV worker decodes PCM16 ${channels} channels, whole-file hash and bounded waveform`, async t => {
  const { file } = fixture(t); writeFileSync(file, fixtureWav(channels)); const a = await analyze(file);
  assert.equal(a.channels, channels); assert.equal(a.frames, 24000); assert.equal(a.duration, .5); assert.equal(a.peaks.length, 512); assert.ok(a.peaks.some(p => p > .2)); assert.match(a.sha256, /^[a-f0-9]{64}$/);
});
test("Import copies originals, deduplicates content across names and survives catalogue reopen", async t => {
  const { app, importSound, file, dir } = fixture(t); const e = await importSound(); const hash = readFileSync(file);
  const other = path.join(dir, "other.WAV"); writeFileSync(other, hash); const result = await app.userAudio.importFile(other);
  assert.equal(result.duplicate, true); assert.equal(result.entry.id, e.id); assert.equal(app.userAudio.list().length, 1); assert.deepEqual(readFileSync(file), hash);
  assert.equal(new UserAudioLibrary(app.userAudio.directory).get(e.id).sha256, e.sha256); assert.equal(app.project.history.undo, 0);
});
for (const [label, change] of [
  ["unfinalized", (b: Buffer) => b.writeUInt32LE(0, 4)], ["float format", (b: Buffer) => b.writeUInt16LE(3, 20)],
  ["24-bit", (b: Buffer) => b.writeUInt16LE(24, 34)], ["bad rate", (b: Buffer) => b.writeUInt32LE(0, 24)],
  ["bad alignment", (b: Buffer) => b.writeUInt16LE(3, 32)], ["chunk overflow", (b: Buffer) => b.writeUInt32LE(0xffffffff, 40)],
] as const) test(`Import rejects ${label} without publishing an asset`, async t => { const { app, file, send } = fixture(t); const b = fixtureWav(); change(b); writeFileSync(file, b); const r = await send("audio.import", { value: file }); assert.equal(r.ok, false); assert.equal(app.userAudio.list().length, 0); });
test("Import refuses unsupported extension, hidden file, directory and oversized sparse input", async t => {
  const { app, file, dir } = fixture(t);
  for (const name of ["voice.mp3", ".hidden.wav"]) { const f = path.join(dir, name); writeFileSync(f, fixtureWav()); await assert.rejects(app.userAudio.importFile(f)); }
  await assert.rejects(app.userAudio.importFile(dir)); truncateSync(file, AUDIO_LIMIT + 1); await assert.rejects(app.userAudio.importFile(file), /256 MiB/);
});
test("Traversal, symlink file and symlink parent paths cannot be imported", async t => {
  const { app, file, dir } = fixture(t); assert.throws(() => safeAudioPath(path.join(dir, "x") + "/../spoken.wav")); assert.throws(() => safeAudioPath("C:\\arbitrary.wav"));
  const link = path.join(dir, "link.wav");
  try { symlinkSync(file, link); } catch (e) { if (process.platform === "win32" && (e as NodeJS.ErrnoException).code === "EPERM") { t.diagnostic("Symlink creation unavailable; traversal checks executed"); return; } throw e; }
  await assert.rejects(app.userAudio.importFile(link), /Symbolic/); const parent = path.join(dir, "linked"); symlinkSync(app.userAudio.directory, parent, "junction"); await assert.rejects(app.userAudio.importFile(path.join(parent, "anything.wav")));
});
test("Missing/changed audio remains referenced and exact-content reimport repairs it", async t => {
  const { app, importSound, send, file } = fixture(t); const e = await importSound(); await send("audio.add", { value: e.id }); rmSync(app.userAudio.file(e.id));
  assert.equal(app.projectState().assets[0].status, "missing"); assert.equal(app.project.document.clips.length, 1);
  assert.equal((await send("audio.import", { value: file, assetId: e.id })).ok, true);
  writeFileSync(app.userAudio.file(e.id), fixtureWav(1, 1000)); await assert.rejects(app.userAudio.verify(e.id), /content changed/);
  assert.equal((await send("audio.import", { value: file, assetId: e.id })).ok, true); await app.userAudio.verify(e.id);
});
test("Relink rejects similarly named content and retains intended identity", async t => {
  const { app, importSound, file } = fixture(t); const e = await importSound(); rmSync(app.userAudio.file(e.id)); writeFileSync(file, fixtureWav(1, 3000));
  await assert.rejects(app.userAudio.importFile(file, "user", e.id), /exact original/); assert.equal(app.userAudio.get(e.id).sha256, e.sha256); assert.equal(app.userAudio.status(e.id), "missing");
});
test("Library rename/favorite/tags/collection and authored BPM have independent revision safety", async t => {
  const { app, importSound, send } = fixture(t); const e = await importSound(), p = app.project.document;
  const details = { name: "Industrial voice", favorite: true, tags: ["voice"], collection: "Found sounds", classification: "loop" as const, bpm: 127 };
  assert.ok((await send("audio.details", { assetId: e.id, libraryRevision: 0, details })).ok);
  assert.equal((await send("audio.details", { assetId: e.id, libraryRevision: 0, details })).ok, false);
  assert.deepEqual(app.userAudio.get(e.id).details, details); assert.deepEqual(app.project.document, p); assert.equal(app.project.history.undo, 0);
});
test("Managed storage copies across roots without platform paths in saved music", async t => {
  const { app, add, dir, send } = fixture(t); await add(); const p = app.project.document, encoded = encodeProject(p); assert.ok(!encoded.includes(dir));
  const moved = path.join(dir, "moved"); cpSync(app.userAudio.directory, moved, { recursive: true }); const library = new UserAudioLibrary(moved);
  await library.verify(p.assets[0].id); assert.deepEqual(decodeProject(encoded).document, p);
  await send("project.save", { value: "portable" }); assert.ok(existsSync(path.join(app.project.storage!.directory, "portable.abx.json")));
});
test("Asset identity rejects forged bank, hash, path, origin metadata and replacement", async t => {
  const { app, add } = fixture(t); await add(); const p = app.project.document;
  for (const patch of [{ name: "bd" }, { id: "other" }, { index: 1 }, { audio: undefined }]) assert.throws(() => validateProject({ ...p, assets: [{ ...p.assets[0], ...patch }] }));
  assert.throws(() => applyEdits(p, [{ type: "asset.put", asset: { ...p.assets[0], audio: { ...p.assets[0].audio, duration: .7 } } }]));
});
test("Sample assignment and shaping use one Undo each; asset files survive Undo", async t => {
  const { app, add, send } = fixture(t); const c = await add(), before = app.project.history.undo;
  const playback = { ...defaultPlayback(), start: .2, end: .8, reverse: true, pitch: -12, attack: .02, release: .07, mode: "loop" as const, beats: 8 };
  assert.ok((await send("project.edit", { label: "Trim gesture", edits: [{ type: "sample.playback", clipId: c.id, playback }] })).ok); assert.equal(app.project.history.undo, before + 1);
  await send("project.undo"); assert.equal((app.project.document.clips[0] as StepClip).playback, undefined); await send("project.redo"); assert.deepEqual((app.project.document.clips[0] as StepClip).playback, playback);
  await send("project.undo"); await send("project.undo"); assert.ok(existsSync(app.userAudio.file(c.assetId)));
});
for (const patch of [{ start: .9, end: .2 }, { pitch: 25 }, { release: -1 }, { attack: 3 }, { start: NaN }, { beats: 0 }]) test(`Sample bounds reject ${JSON.stringify(patch)}`, async t => { const { app, add, send } = fixture(t); const c = await add(), before = app.project.document; assert.equal((await send("project.edit", { label: "Unsafe", edits: [{ type: "sample.playback", clipId: c.id, playback: { ...defaultPlayback(), ...patch } }] })).ok, false); assert.deepEqual(app.project.document, before); });
test("Compiler projects regions, reverse rate and envelope while retaining FX semantic targets", async t => {
  const { app, add, send } = fixture(t); const c = await add();
  await send("project.edit", { label: "Sample", edits: [{ type: "sample.playback", clipId: c.id, playback: { ...defaultPlayback(), start: .2, end: .7, reverse: true, pitch: 12, mode: "loop", beats: 8 } }] });
  const p = app.project.document, code = compileClip(p, p.clips[0]); assert.match(code, /slow 2/); assert.match(code, /begin "0.2/); assert.match(code, /end "0.7/); assert.match(code, /\|\* speed -2/); assert.match(code, /abxattack/);
  assert.match(INSTALL_SAMPLE_ENVELOPE, /life \/ \(a \+ r\)/); assert.match(INSTALL_SAMPLE_ENVELOPE, /dirt_envelope/);
});
test("Slice IDs, pad references and scene copies survive reorder, remove/Undo and save", async t => {
  const { app, add, send } = fixture(t); const c = await add(), slices = [{ id: "first", name: "First", start: 0, end: .4 }, { id: "second", name: "Second", start: .4, end: 1 }], sliceSteps = c.steps.map((_, i) => i % 2 ? "second" : "first");
  assert.ok((await send("project.edit", { label: "Chop", edits: [{ type: "sample.slices", clipId: c.id, slices, sliceSteps }] })).ok);
  await send("project.edit", { label: "Reorder", edits: [{ type: "sample.slices", clipId: c.id, slices: [...slices].reverse(), sliceSteps }] });
  assert.deepEqual((app.project.document.clips[0] as StepClip).sliceSteps, sliceSteps);
  await send("project.edit", { label: "Remove", edits: [{ type: "sample.slices", clipId: c.id, slices: [slices[0]], sliceSteps: sliceSteps.map(id => id === "second" ? null : id) }] });
  await send("project.undo"); assert.equal((app.project.document.clips[0] as StepClip).slices?.length, 2);
  const sceneId = app.project.document.sceneOrder[0]; await send("project.edit", { label: "Duplicate", edits: [{ type: "scene.duplicate", sceneId, newSceneId: "copy", name: "Copy" }, { type: "arrangement.set", entries: [{ id: "entry", sceneId: "copy", cycles: 2 }] }] });
  const p = app.project.document; assert.equal(p.clips.length, 2); assert.notEqual(p.clips[0].id, p.clips[1].id); assert.deepEqual((p.clips[1] as StepClip).sliceSteps, sliceSteps); assert.match(JSON.stringify(compileArrangement(p)), /abx_/);
  assert.deepEqual(decodeProject(encodeProject(p)).document, p);
});
test("Unknown slice IDs and duplicate regions fail without changing project", async t => {
  const { app, add, send } = fixture(t); const c = await add(), before = app.project.document;
  const slice = { id: "same", name: "Slice", start: 0, end: 1 };
  for (const [slices, sliceSteps] of [[[slice, slice], c.steps.map(() => "same")], [[slice], c.steps.map(() => "unknown")]]) assert.equal((await send("project.edit", { label: "Invalid slices", edits: [{ type: "sample.slices", clipId: c.id, slices, sliceSteps }] })).ok, false);
  assert.deepEqual(app.project.document, before);
});
test("Preview uses shared native group, never musical history or recorder routing", async t => {
  const { app, importSound, send, engine } = fixture(t); const e = await importSound(), p = app.project.document;
  assert.ok((await send("audio.preview", { value: e.id, playback: { ...defaultPlayback(), reverse: true } })).ok);
  assert.deepEqual(app.project.document, p); assert.equal(app.project.history.undo, 0); assert.ok(engine.calls.some(c => c.includes("~abxPreviewGroup.freeAll"))); assert.ok(!engine.calls.some(c => c.includes("~recBuf") || c.includes("DiskOut")));
  await send("preview.stop"); assert.equal(app.preview.snapshot().state, "idle");
});
test("Capture preparing/recording/finalizing/ready barriers precede Keep", async t => {
  const { app, engine, send, capture } = fixture(t); await send("capture.prepare", { device: "", channel: 0 });
  engine.before = async code => { if (code.includes("~abxInputBuffer.write")) assert.equal(app.capture.snapshot().takes[0].state, "preparing"); if (code.includes("~abxInputBuffer.close")) assert.equal(app.capture.snapshot().takes[0].state, "finalizing"); };
  await send("capture.start", { value: "Voice" }); const id = app.capture.snapshot().activeId!; assert.equal((await send("capture.keep", { value: id })).ok, false);
  assert.ok((await send("capture.stop", { value: id })).ok); assert.equal(app.capture.get(id).state, "ready"); assert.equal(app.userAudio.list().length, 0);
  assert.ok((await send("capture.keep", { value: id })).ok); assert.equal(app.capture.get(id).state, "kept"); assert.equal(app.userAudio.list()[0].origin, "captured"); assert.equal(app.userAudio.list()[0].details.name, "Voice"); assert.equal(app.project.history.undo, 0);
});
test("Capture retention is idempotent and catalogue survives runtime restart", async t => {
  const { app, capture, send, engine, paths } = fixture(t); const id = await capture(); await send("capture.stop", { value: id }); await send("capture.keep", { value: id }); await send("capture.keep", { value: id });
  assert.equal(app.userAudio.list().length, 1); const reopened = new Application(engine, paths); assert.equal(reopened.capture.get(id).state, "kept"); assert.equal(reopened.userAudio.list().length, 1);
});
test("Capture interruption never publishes an apparently valid retained asset", async t => {
  const { app, capture, send, engine, paths } = fixture(t); const id = await capture(); writeFileSync(app.capture.file(id), fixtureWav());
  engine.stop(); assert.equal(app.capture.snapshot().takes[0].state, "interrupted"); assert.equal((await send("capture.keep", { value: id })).ok, false);
  const reopened = new Application(engine, paths); assert.equal(reopened.capture.get(id).state, "interrupted"); assert.equal(reopened.userAudio.list().length, 0);
});
test("Capture malformed output and failed native close remain failed, not ready", async t => {
  const { app, engine, capture, send } = fixture(t); const id = await capture(); engine.invalid = true;
  assert.equal((await send("capture.stop", { value: id })).ok, false); assert.equal(app.capture.get(id).state, "failed"); assert.equal((await send("capture.keep", { value: id })).ok, false); assert.equal(app.userAudio.list().length, 0);
});
test("Capture discard only removes an unretained take and never user assets", async t => {
  const { app, capture, send } = fixture(t); const id = await capture(); assert.equal((await send("capture.discard", { value: id })).ok, false); await send("capture.stop", { value: id }); await send("capture.discard", { value: id }); assert.equal(existsSync(app.capture.file(id)), false);
  const second = await capture(); await send("capture.stop", { value: second }); await send("capture.keep", { value: second }); assert.equal((await send("capture.discard", { value: second })).ok, false); assert.equal(app.userAudio.list().length, 1);
});
test("Input selection is capability aware, monitoring explicit, and telemetry absent from project", async t => {
  const { app, send, engine } = fixture(t); const p = app.project.document;
  assert.equal((await send("capture.prepare", { device: "Unavailable", channel: 0 })).ok, false);
  assert.ok((await send("capture.prepare", { device: "Fixture microphone", channel: 1 })).ok); assert.equal(app.capture.snapshot().monitor, false);
  await send("capture.controls", { gain: .8, monitor: true }); assert.equal(app.capture.snapshot().monitor, true); assert.deepEqual(app.project.document, p);
  assert.match(INPUT_SYNTHS, /Group.tail\(RootNode\(s\)\)/); assert.ok(!INPUT_SYNTHS.includes("~abxRecordBus")); assert.match(FINISH_CAPTURE, /close; s.sync/); assert.match(INPUT_SYNTHS, /Line.kr\(0, 1, 300, doneAction: 2\)/);
  engine.stop(); assert.equal(app.capture.snapshot().monitor, false); assert.equal(app.capture.snapshot().inputReady, false);
});
test("Capture and performance recording can finalize independently with separate identities/files", async t => {
  const { app, capture, send } = fixture(t); const id = await capture(); await send("record.start"); const recording = app.projectState().recordingState!;
  assert.notEqual(app.capture.file(id), app.recordings.file(recording.id)); await send("capture.stop", { value: id }); assert.equal(app.rig.recording, true);
  await send("record.stop", { value: recording.id }); assert.equal(app.recordings.get(recording.id)?.state, "ready"); assert.equal(app.capture.get(id).state, "ready");
});
test("Capture stop IDs cannot stop another take and operation retries do not duplicate", async t => {
  const { app, capture, send } = fixture(t); const id = await capture(); await send("capture.stop", { value: id });
  const meta = { operationId: "keep-retry", sessionId: app.sessionId, issuedAt: Date.now(), value: id };
  assert.deepEqual(await app.dispatch({ cmd: "capture.keep", ...meta }), await app.dispatch({ cmd: "capture.keep", ...meta }));
  await send("capture.start", { value: "Second" }); const active = app.capture.snapshot().activeId; await send("capture.stop", { value: id }); assert.equal(app.capture.snapshot().activeId, active);
});
test("FX, semantic automation/modulation, scene silence and recovery coexist with captured audio", async t => {
  const { app, capture, send, paths, engine } = fixture(t); const id = await capture(); await send("capture.stop", { value: id }); await send("capture.keep", { value: id }); await send("audio.add", { value: app.userAudio.list()[0].id });
  const p = app.project.document, track = p.tracks[0], c = p.clips[0] as StepClip;
  const rack = ["distortion", "reverb"].map((id, i) => { const d = effects.find(d => d.id === id)!; return { id: "insert" + i, definitionId: id, version: 1, enabled: true, values: defaults(d) }; });
  assert.ok((await send("project.edit", { label: "Vocal fun", edits: [...rack.map(effect => ({ type: "fx.put", trackId: track.id, effect })), { type: "sample.playback", clipId: c.id, playback: { ...defaultPlayback(), reverse: true, pitch: -7 } }, { type: "automation.put", automation: { id: "auto", trackId: track.id, clipId: c.id, parameter: "fx.insert0.drive", enabled: true, bars: 1, values: [.1, .8] } }, { type: "modulation.put", trackId: track.id, route: { id: "mod", target: "fx.insert0.drive", source: "lfo", rate: 1, amount: .2, enabled: true } }] })).ok);
  const shaped = app.project.document; assert.match(rackCommand(shaped), /abxFX/); assert.match(compileClip(shaped, shaped.clips[0]), /speed -/);
  await send("project.save", { value: "fun" }); await send("project.new"); await send("project.load", { value: "fun" }); assert.deepEqual(app.project.document.tracks, shaped.tracks); assert.deepEqual(app.project.document.clips, shaped.clips);
  const recovered = new Application(engine, paths); assert.deepEqual(recovered.project.document.clips, shaped.clips); assert.equal(recovered.rig.stopped, true);
});
test("HTTP imports enforce origin/session/size, stream into managed storage and return waveform", async t => {
  const { app } = fixture(t), server = startDashboard(0, DASHBOARD_HTML, () => app.projectState(), () => ({}), c => app.dispatchExternal(c), { audio: () => ({ library: app.userAudio, capture: app.capture, sessionId: app.sessionId }) });
  await once(server, "listening"); t.after(() => { server.closeAllConnections(); server.close(); }); const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const upload = (headers: Record<string, string>) => fetch(url + "/audio/import?name=voice.wav", { method: "POST", headers: { "content-type": "audio/wav", ...headers }, body: fixtureWav() });
  assert.equal((await upload({})).status, 403); assert.equal((await upload({ "x-beatbox-session": app.sessionId, origin: "https://evil.invalid" })).status, 403);
  const r = await upload({ "x-beatbox-session": app.sessionId }); assert.equal(r.status, 200); const entry = (await r.json()).entry;
  assert.equal((await (await fetch(url + `/audio/sound/${entry.id}/wave`)).json()).length, 512); assert.equal((await fetch(url + "/audio/sound/../wave")).status, 404);
});

test("Interrupted uploads clean only their staging file and never publish audio", async t => {
  const { app } = fixture(t);
  const broken = Readable.from((async function* () { yield fixtureWav().subarray(0, 30); throw new Error("Upload interrupted"); })());
  await assert.rejects(app.userAudio.importStream(broken, "interrupted.wav"), /interrupted/);
  assert.equal(app.userAudio.list().length, 0); assert.equal(app.userAudio.progress.busy, false);
  const result = await app.userAudio.importStream(Readable.from(fixtureWav()), "valid.wav"); assert.ok(result.entry);
});
test("Concurrent import is bounded while metadata work leaves the event loop responsive", async t => {
  const { app, file } = fixture(t);
  const first = app.userAudio.importFile(file);
  await assert.rejects(app.userAudio.importFile(file), /in progress/);
  let tick = false; setTimeout(() => { tick = true; }, 0);
  await first; assert.equal(tick, true); assert.equal(app.userAudio.list().length, 1);
});
test("A failed capture close cannot prevent Reset from recovering owned audio", async t => {
  const { app, capture, send, engine } = fixture(t); const id = await capture();
  engine.fail = "~abxInputBuffer.close"; const generation = engine.generation;
  assert.equal((await send("reset")).ok, true); assert.ok(engine.generation > generation);
  assert.equal(app.capture.get(id).state, "failed"); assert.equal(app.capture.snapshot().monitor, false); assert.equal(app.capture.snapshot().inputReady, false);
});
test("Preparing input cannot interrupt playing tracks or an output recording", async t => {
  const { add, send, engine } = fixture(t); await add(); await send("resume"); const generation = engine.generation;
  assert.equal((await send("capture.prepare", { device: "", channel: 0 })).ok, false); assert.equal(engine.generation, generation);
  await send("pause"); await send("record.start"); assert.equal((await send("capture.prepare", { device: "", channel: 0 })).ok, false);
});
test("Changed user audio is silenced on resume while other tracks remain usable", async t => {
  const { app, add, file, send, engine } = fixture(t); const c = await add();
  writeFileSync(file, fixtureWav(1, 2000)); const imported = await send("audio.import", { value: file }); assert.ok(imported.ok); const other = app.userAudio.list().find(e => e.id !== c.assetId)!;
  await send("audio.add", { value: other.id }); writeFileSync(app.userAudio.file(c.assetId), fixtureWav(1, 4000));
  assert.ok((await send("resume")).ok); assert.equal(app.projectState().assets.find(a => a.id === c.assetId)?.status, "missing");
  assert.ok(engine.calls.some(code => code.startsWith("d2 $") && code.includes(other.sha256)));
  assert.ok(!engine.calls.some(code => code.startsWith("d1 $") && code.includes(c.assetId.slice(6))));
});
test("A missing ready capture cannot be previewed or kept", async t => {
  const { app, capture, send } = fixture(t); const id = await capture(); await send("capture.stop", { value: id }); rmSync(app.capture.file(id));
  assert.equal(app.capture.snapshot().takes[0].state, "failed"); assert.equal((await send("capture.keep", { value: id })).ok, false); assert.equal((await send("capture.preview", { value: id })).ok, false);
});
test("Capture persistence failure reports failure without an active or ready take", async t => {
  const { app, send } = fixture(t); await send("capture.prepare", { device: "", channel: 0 });
  rmSync(app.capture.directory, { recursive: true }); writeFileSync(app.capture.directory, "not a directory");
  assert.equal((await send("capture.start", { value: "Unwritable" })).ok, false); assert.equal(app.capture.snapshot().activeId, null); assert.ok(app.capture.snapshot().takes.every(t => t.state === "failed"));
});
test("Shaped bundled preview still uses the native preview group", async t => {
  const { dir, paths, engine } = fixture(t); const samples = path.join(dir, "samples"); mkdirSync(path.join(samples, "bd"), { recursive: true }); writeFileSync(path.join(samples, "bd", "kick.wav"), fixtureWav());
  const app = new Application(engine, { ...paths, samples });
  const asset = { id: "bundled", kind: "sample" as const, name: "bd", reference: "bd", index: 0 };
  app.project.commit(app.project.prepare([{ type: "asset.put", asset }]), "Reference"); const before = app.project.document;
  assert.ok((await app.dispatch({ cmd: "audio.preview", value: asset.id, playback: { ...defaultPlayback(), start: .2, end: .6, reverse: true } })).ok);
  assert.deepEqual(app.project.document, before); assert.ok(engine.calls.some(code => code.includes("~abxPreviewGroup") && code.includes("kick.wav")));
});
