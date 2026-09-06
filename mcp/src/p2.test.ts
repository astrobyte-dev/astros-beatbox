import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { Application, type CommandEngine } from "./application.js";
import { pocketGroove } from "./studio-starter.js";
import { RecordingCatalog, validateWav } from "./recordings.js";
import { libraryAsset, resolveSample } from "./sound-library.js";
import { startDashboard } from "./dashboard.js";
import { DASHBOARD_HTML } from "./config.js";
import { clone } from "./project.js";
import { StudioClient } from "./studio-client.js";

function wav(peak = 4000) {
  const b = Buffer.alloc(44 + 4800 * 4); b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(192000, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(b.length - 44, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(Math.round(peak * Math.sin(i / 31)), i);
  return b;
}
class FakeEngine implements CommandEngine {
  generation = 0; running = false; state = "idle"; error: string | null = null;
  calls: string[] = [];
  effect = async (_code: string) => {};
  async evaluate(code: string, operationId = "test") { this.calls.push(code); await this.effect(code); return { operationId, acknowledgement: "action" as const, output: "ABX_PREVIEW 0.2" }; }
  tidal = { eval: (c: string, id?: string) => this.evaluate(c,id), hush: (id?: string) => this.evaluate("hush",id) };
  sclang = { eval: (c: string, id?: string) => this.evaluate(c,id), evalRoutine: (c: string, id?: string) => this.evaluate(c,id) };
  async ensureBooted() { if (this.error) throw new Error(this.error); this.running = true; this.state = "ready"; }
  async reboot() { this.generation++; this.error = null; await this.ensureBooted(); }
  assertGeneration(g: number) { if (g !== this.generation) throw new Error("Stale generation"); }
}
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-p2-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const samples = path.join(dir, "samples"); mkdirSync(path.join(samples,"sd"),{recursive:true});
  writeFileSync(path.join(samples,"sd","a.wav"),wav()); writeFileSync(path.join(samples,"sd","b.wav"),wav(2000));
  const engine = new FakeEngine(), paths = { sets: dir, recordings: path.join(dir,"recordings"), device: path.join(dir,"device"), projects: path.join(dir,"projects"), recovery: path.join(dir,"recovery"), samples };
  const app = new Application(engine,paths);
  engine.effect = async code => { if (code.includes("~recBuf.close") && app.rig.recPath) writeFileSync(app.rig.recPath,wav()); };
  const send = (cmd: string, args = {}) => app.dispatchExternal({ cmd, projectId: app.project.document.id, revision: app.project.document.revision, ...args });
  return { dir, samples, engine, app, paths, send };
}

test("P2 replacement is one canonical intention preserving rhythm, velocity, effects, automation and unrelated tracks", async t => {
  const { app, send } = fixture(t);
  assert.ok((await send("project.edit", { edits: pocketGroove(app.project.document), label: "Starter" })).ok);
  const c = app.project.document.clips[1];
  await send("project.edit", { label: "Expression", edits: [{ type: "parameter.set", clipId: c.id, parameter: "room", value: 0.3 }, { type: "automation.put", automation: { id: "motion", trackId: c.trackId, clipId: c.id, parameter: "gain", values: [0.2, 0.8], bars: 2, enabled: true } }] });
  const before = app.project.document, undo = app.project.history.undo;
  assert.ok((await send("sound.replace", { clipId: c.id, value: "sd/b.wav" })).ok);
  const after = app.project.document, changed = after.clips.find(x => x.id === c.id)!;
  assert.equal(app.project.history.undo,undo+1);
  const normalized = clone(after); normalized.assets = before.assets; normalized.revision = before.revision; normalized.clips[1] = before.clips[1];
  assert.deepEqual(normalized,before);
  assert.deepEqual({ ...changed, assetId: (before.clips[1] as { assetId: string }).assetId },before.clips[1]);
  await send("project.undo"); assert.deepEqual(app.project.document.assets,before.assets); assert.deepEqual(app.project.document.clips,before.clips);
});
test("P2 sample identity survives save/reopen, reordered indices, disappearance and same-name changed content", async t => {
  const { app, send, samples } = fixture(t);
  await send("project.edit", { edits: pocketGroove(app.project.document), label: "Starter" });
  await send("sound.replace", { clipId: app.project.document.clips[1].id, value: "sd/b.wav" });
  const asset = app.project.document.assets.at(-1)!;
  await send("project.save", { value: "identity" }); await send("project.new"); await send("project.load", { value: "identity" });
  assert.deepEqual(app.project.document.assets.at(-1),asset);
  writeFileSync(path.join(samples,"sd","0.wav"),wav()); assert.equal(resolveSample(asset,samples).index,2);
  renameSync(path.join(samples,"sd","b.wav"),path.join(samples,"sd","c.wav")); assert.equal(resolveSample(asset,samples).status,"missing");
  writeFileSync(path.join(samples,"sd","b.wav"),wav(100)); assert.equal(resolveSample(asset,samples).status,"missing");
  assert.deepEqual(app.project.document.assets.at(-1),asset);
});
test("P2 preview is serialized, distinct from Tidal/composition, history-free and uses exact loaded buffer identity", async t => {
  const { app, engine } = fixture(t), before = app.project.document;
  const one = app.dispatch({ cmd: "preview.play", value: "sd/a.wav" }), two = app.dispatch({ cmd: "preview.play", value: "sd/b.wav" });
  assert.ok((await one).ok); assert.ok((await two).ok);
  assert.equal(app.projectState().preview.key,"sd/b.wav"); assert.deepEqual(app.project.document,before); assert.equal(app.project.history.undo,0);
  assert.equal(engine.calls.length,2); assert.match(engine.calls[1], /b.path.basename != "b.wav"/); assert.match(engine.calls[1], /freeAll; s.sync/);
  assert.ok(engine.calls.every(c => !c.includes("d1 $") && !c.includes("hush")));
  await app.dispatch({ cmd: "preview.stop" }); assert.equal(app.projectState().preview.state,"idle");
});
test("P2 preview engine failure and old generation do not claim audition succeeded", async t => {
  const { app, engine } = fixture(t); engine.error = "device unavailable";
  assert.equal((await app.dispatch({ cmd: "preview.play", value: "sd/a.wav" })).ok,false); assert.equal(app.projectState().preview.state,"unavailable");
  engine.error = null; engine.effect = async () => { engine.generation++; };
  assert.equal((await app.dispatch({ cmd: "preview.play", value: "sd/b.wav" })).ok,false); assert.equal(app.project.history.undo,0);
});
test("P2 recording exposes preparing/recording/finalizing/ready only after barriers and validates nonzero PCM", async t => {
  const { app, engine } = fixture(t); let release!: () => void;
  engine.effect = () => new Promise(r => { release = r; });
  const start = app.dispatch({ cmd: "record.start" }); await new Promise(r => setImmediate(r));
  assert.equal(app.projectState().recordingState?.state,"preparing"); assert.equal(app.rig.recording,false); release(); assert.ok((await start).ok);
  assert.equal(app.projectState().recordingState?.state,"recording");
  const id = app.projectState().recordingState!.id, stop = app.dispatch({ cmd: "record.stop", value: id }); await new Promise(r => setImmediate(r));
  assert.equal(app.projectState().recordingState?.state,"finalizing");
  writeFileSync(app.rig.recPath,wav()); release(); assert.ok((await stop).ok);
  const ready = app.recordings.get(id)!; assert.equal(ready.state,"ready"); assert.equal(ready.audio?.peak,4000); assert.equal(ready.audio?.duration,0.1);
  assert.equal(app.recordings.retrieve(id),app.recordings.file(id));
  assert.match(engine.calls[0], /In.ar\(bus,2\)/); assert.match(engine.calls[0], /~abxRecordBus.index/);
});
test("P2 record retries do not toggle or refinalize and an old stop cannot stop a newer take", async t => {
  const { app, engine } = fixture(t);
  const start = { cmd: "record.start", operationId: "start", sessionId: app.sessionId, issuedAt: Date.now() };
  assert.deepEqual(await app.dispatch(start),await app.dispatch(start)); await app.dispatch({ cmd: "record.start" }); assert.equal(engine.calls.length,1);
  const id = app.projectState().recordingState!.id;
  await app.dispatch({ cmd: "record.stop", value: id }); const calls = engine.calls.length;
  assert.ok((await app.dispatch({ cmd: "record.stop", value: id })).ok); assert.equal(engine.calls.length,calls);
  await app.dispatch({ cmd: "record.start" }); const newer = app.projectState().recordingState!.id;
  await app.dispatch({ cmd: "record.stop", value: id }); assert.equal(app.projectState().recordingState?.id,newer); assert.equal(app.rig.recording,true);
});
test("P2 failed finalization and interrupted recovery never publish a ready recording", async t => {
  const { app, engine, paths } = fixture(t); await app.dispatch({ cmd: "record.start" }); const id = app.projectState().recordingState!.id;
  engine.effect = async () => { writeFileSync(app.rig.recPath,Buffer.alloc(100)); };
  assert.equal((await app.dispatch({ cmd: "record.stop", value: id })).ok,false); assert.equal(app.recordings.get(id)?.state,"failed"); assert.throws(() => app.recordings.retrieve(id));
  await app.dispatch({ cmd: "record.start" }); const next = app.projectState().recordingState!.id;
  const recovered = new Application(new FakeEngine(),paths); assert.equal(recovered.recordings.get(next)?.state,"interrupted"); assert.equal(recovered.rig.recording,false); assert.equal(recovered.engine.running,false);
});
test("P2 engine loss marks active recordings interrupted without musical recovery recreating them", async t => {
  const { app, engine } = fixture(t); await app.dispatch({ cmd: "record.start" }); engine.running = false; engine.state = "error";
  assert.equal(app.projectState().recordingState?.state,"interrupted"); assert.equal(app.rig.recording,false);
});
test("P2 recording catalog persists across Undo and reopen and reports missing/stale files", async t => {
  const { app, send, paths } = fixture(t); await send("project.edit",{ label:"Rename",edits:[{type:"project.rename",name:"Take"}] });
  await app.dispatch({ cmd:"record.start" }); const id = app.projectState().recordingState!.id; await app.dispatch({ cmd:"record.stop",value:id });
  await send("project.undo"); assert.equal(app.recordings.get(id)?.state,"ready");
  const catalog = new RecordingCatalog(paths.recordings); assert.equal(catalog.get(id)?.state,"ready");
  writeFileSync(catalog.file(id),wav(20)); assert.throws(() => catalog.retrieve(id),/changed/);
  rmSync(catalog.file(id)); assert.equal(catalog.get(id)?.state,"missing"); assert.throws(() => catalog.retrieve(id),/missing/);
});
test("P2 WAV validation rejects unfinished, truncated and silent-header fakes while measuring actual silence", async t => {
  const { dir } = fixture(t), file = path.join(dir,"test.wav");
  for (const b of [Buffer.alloc(80),wav().subarray(0,100)]) { writeFileSync(file,b); assert.throws(() => validateWav(file)); }
  writeFileSync(file,wav(0)); assert.equal(validateWav(file).peak,0); assert.equal(validateWav(file).rms,0);
});
test("P2 recording retrieval supports playback ranges/download and refuses paths and incomplete takes", async t => {
  const { app } = fixture(t); await app.dispatch({cmd:"record.start"}); const id = app.projectState().recordingState!.id;
  const server = startDashboard(0,DASHBOARD_HTML,()=>app.projectState(),()=>({}),c=>app.dispatchExternal(c),{recordings:app.recordings,sounds:()=>app.sounds()});
  t.after(()=>{server.close();server.closeAllConnections();}); await once(server,"listening"); const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  assert.equal((await fetch(`${url}/recordings/${id}.wav`)).status,404);
  await app.dispatch({cmd:"record.stop",value:id}); const response = await fetch(`${url}/recordings/${id}.wav?download=1`);
  assert.equal(response.headers.get("content-type"),"audio/wav"); assert.match(response.headers.get("content-disposition")!,/attachment/); assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(app.rig.recPath));
  const partial=await fetch(`${url}/recordings/${id}.wav`,{headers:{range:"bytes=44-99"}}); assert.equal(partial.status,206); assert.equal((await partial.arrayBuffer()).byteLength,56);
  assert.equal((await fetch(`${url}/recordings/invalid.wav`)).status,404);
  assert.equal((await fetch(`${url}/sounds`)).status,200);
});
test("P2 asset fingerprints cannot substitute a same-name external library", t => {
  const { samples } = fixture(t), a = libraryAsset(samples,"sd/a.wav","asset");
  a.source!.library = "external"; assert.equal(resolveSample(a,samples).status,"missing");
});

test("P2 stale and opaque sound replacement rejects without rewriting source or committing assets", async t => {
  const { app, send } = fixture(t);
  await send("project.edit",{edits:pocketGroove(app.project.document),label:"Starter"});
  const before=app.project.document, c=before.clips[1];
  const stale=await app.dispatchExternal({cmd:"sound.replace",projectId:before.id,revision:before.revision-1,clipId:c.id,value:"sd/b.wav"});assert.ok(!stale.ok&&stale.code==="STALE_PROJECT");
  await send("project.edit",{label:"Code",edits:[{type:"clip.put",clip:{id:c.id,trackId:c.trackId,name:"Code",kind:"code",source:'s "sd*3" # room 0.2',managed:true,dependencyIds:[]}}]});
  const code=app.project.document;
  assert.equal((await send("sound.replace",{clipId:c.id,value:"sd/b.wav"})).ok,false);assert.deepEqual(app.project.document,code);
});
test("P2 failed recorder cleanup blocks new takes until Reset and leaves a truthful failure", async t => {
  const { app, engine } = fixture(t);engine.effect=async()=>{throw new Error("disk unavailable");};
  assert.equal((await app.dispatch({cmd:"record.start"})).ok,false);assert.equal(app.projectState().recordingState?.state,"failed");
  const calls=engine.calls.length;assert.equal((await app.dispatch({cmd:"record.start"})).ok,false);assert.equal(engine.calls.length,calls);
  engine.effect=async()=>{};await app.dispatch({cmd:"reset"});assert.equal((await app.dispatch({cmd:"record.start"})).ok,true);
});
test("P2 corrupt catalog sidecars are retained and reported, never promoted from an orphan WAV", t => {
  const { paths }=fixture(t);mkdirSync(paths.recordings,{recursive:true});const id="12345678-1234-4234-8234-123456789012";
  const file=path.join(paths.recordings,id+".recording.json");writeFileSync(file,"{broken");writeFileSync(path.join(paths.recordings,"jam-"+id+".wav"),wav());
  const catalog=new RecordingCatalog(paths.recordings);assert.equal(catalog.list().length,0);assert.match(catalog.warning!,/unreadable/);assert.equal(readFileSync(file,"utf8"),"{broken");
});
test("P2 studio rejects an old runtime command response after a newer session snapshot", async t => {
  const { app, engine }=fixture(t);let session: string=app.sessionId,release!:()=>void;
  const request=async(url: string|URL|Request)=>{
    if(String(url)==="/state") return new Response(JSON.stringify({...app.projectState(),sessionId:session,generation:engine.generation,status:"idle",slots:{}}));
    await new Promise<void>(r=>{release=r;});return new Response(JSON.stringify({ok:true,sessionId:app.sessionId,generation:0,operationId:"old",msg:"done"}));
  };
  const client=new StudioClient(request as typeof fetch);await client.refresh();const action=client.command({cmd:"preview.stop"},"Stop preview");
  await new Promise(r=>setImmediate(r));session="new-runtime";await client.refresh();release();assert.equal(await action,false);assert.match(client.getStatus().error!,/Runtime changed/);assert.equal(client.getStatus().message,"");
});
