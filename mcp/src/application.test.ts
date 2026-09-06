import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Application, type CommandEngine } from "./application.js";
import { validateCommand } from "./commands.js";
import type { EvalResult } from "./protocol.js";

class FakeEngine implements CommandEngine {
  generation = 0; running = false; state = "idle"; error = null; boots = 0;
  calls: string[] = [];
  effect: (code: string) => Promise<void> = async () => {};
  async evaluate(code: string, id = "test"): Promise<EvalResult> {
    this.calls.push(code); await this.effect(code);
    return { operationId: id, output: "", acknowledgement: "action" };
  }
  tidal = { eval: (c: string, id?: string) => this.evaluate(c, id), hush: (id?: string) => this.evaluate("hush", id) };
  sclang = { eval: (c: string, id?: string) => this.evaluate(c, id), evalRoutine: (c: string, id?: string) => this.evaluate(c, id) };
  async ensureBooted() { this.boots++; this.running = true; this.state = "ready"; }
  async reboot() { this.generation++; await this.ensureBooted(); }
  assertGeneration(g: number) { if (g !== this.generation) throw new Error("stale generation"); }
}
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-command-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = new FakeEngine();
  const app = new Application(engine, { sets: dir, recordings: dir, device: path.join(dir, "device.txt") });
  return { app, engine, dir };
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise<void>((r) => setImmediate(r));

test("commands reject invalid names, slots, values, unknown fields and incomplete retry metadata", () => {
  for (const c of [{ cmd: "wat" }, { cmd: "mute", slot: "d1;hush" }, { cmd: "tempo", value: "120" }, { cmd: "tempo", value: Infinity }, { cmd: "set", slot: "d1", param: "gain", value: 9 }, { cmd: "eval", value: " " }, { cmd: "stop", value: 1 }, { cmd: "stop", operationId: "a" }]) assert.throws(() => validateCommand(c));
  assert.equal(validateCommand({ cmd: "tempo", value: 123.5 }).value, 123.5);
});

test("failed evaluation does not replace the last acknowledged pattern", async (t) => {
  const { app, engine } = fixture(t);
  assert.equal((await app.dispatch({ cmd: "eval", value: 'd1 $ sound "bd"' })).ok, true);
  engine.effect = async () => { throw new Error("compile failure"); };
  const result = await app.dispatch({ cmd: "eval", value: "d1 $ broken" });
  assert.equal(result.ok, false); assert.equal(app.rig.slots.d1, 'sound "bd"'); assert.equal(app.rig.synchronized, false);
});

test("state changes only after acknowledgement and commands execute in order", async (t) => {
  const { app, engine } = fixture(t), gate = deferred();
  engine.effect = () => gate.promise;
  const first = app.dispatch({ cmd: "eval", value: 'd1 $ sound "bd"' });
  const second = app.dispatch({ cmd: "mute", slot: "d1" });
  await turn(); assert.deepEqual(app.rig.slots, {}); assert.equal(engine.calls.length, 1);
  gate.resolve(); assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  assert.deepEqual(engine.calls, ['d1 $ sound "bd"', "mute 1"]); assert.ok(app.rig.muted.has("d1"));
});

test("Stop keeps patterns, tempo and mute/solo choices; Play restores them", async (t) => {
  const { app, engine } = fixture(t);
  await app.dispatch({ cmd: "eval", value: 'd1 $ sound "bd"' });
  await app.dispatch({ cmd: "tempo", value: 127 });
  await app.dispatch({ cmd: "mute", slot: "d1" });
  await app.dispatch({ cmd: "solo", slot: "d1" });
  assert.equal((await app.dispatch({ cmd: "stop" })).ok, true);
  assert.equal(app.rig.slots.d1, 'sound "bd"'); assert.equal(app.rig.tempoBpm, 127);
  assert.equal(app.rig.stopped, true); assert.ok(app.rig.muted.has("d1")); assert.equal(app.rig.solo, "d1");
  assert.equal((await app.dispatch({ cmd: "resume" })).ok, true);
  assert.equal(app.rig.stopped, false); assert.deepEqual(engine.calls.slice(-5), ["setcps (127/60/4)", 'd1 $ sound "bd"', "unmuteAll >> unsoloAll", "mute 1", "solo 1"]);
});

test("idle Stop and save do not boot audio; failed stop does not claim silence", async (t) => {
  const { app, engine, dir } = fixture(t);
  assert.equal((await app.dispatch({ cmd: "stop" })).ok, true);
  assert.equal((await app.dispatch({ cmd: "save", value: "test" })).ok, true);
  assert.equal(engine.boots, 0); assert.match(readFileSync(path.join(dir, "test.tidal"), "utf8"), /setcps/);
  engine.state = "error"; app.rig.stopped = false;
  assert.equal((await app.dispatch({ cmd: "stop" })).ok, false); assert.equal(app.rig.stopped, false);
});

test("explicit hush still clears the legacy slot state", async (t) => {
  const { app } = fixture(t);
  await app.dispatch({ cmd: "eval", value: 'd1 $ sound "bd"' });
  assert.equal((await app.dispatch({ cmd: "eval", value: "hush" })).ok, true);
  assert.deepEqual(app.rig.slots, {});
});

test("queries after Stop do not claim playback resumed", async (t) => {
  const { app } = fixture(t);
  await app.dispatch({ cmd: "stop" });
  await app.dispatch({ cmd: "eval", value: "let answer = 42" });
  assert.equal(app.rig.stopped, true);
});

test("duplicate in-flight and completed requests execute once, including record toggle", async (t) => {
  const { app, engine } = fixture(t), gate = deferred();
  engine.effect = () => gate.promise;
  const request = { cmd: "record", operationId: "record-once", sessionId: app.sessionId, issuedAt: Date.now() };
  const a = app.dispatch(request), b = app.dispatch(request);
  assert.equal(a, b); await turn(); assert.equal(engine.calls.length, 1);
  gate.resolve(); assert.equal((await a).ok, true);
  assert.deepEqual(await app.dispatch(request), await a); assert.equal(engine.calls.length, 1); assert.equal(app.rig.recording, true);
  const conflict = await app.dispatch({ ...request, cmd: "stop" });
  assert.ok(!conflict.ok && conflict.code === "ID_CONFLICT");
});

test("expired and old server requests never execute", async (t) => {
  const { app, engine } = fixture(t);
  for (const meta of [{ sessionId: "previous", issuedAt: Date.now() }, { sessionId: app.sessionId, issuedAt: Date.now() - Application.RETRY_MS - 1 }]) {
    assert.equal((await app.dispatch({ cmd: "record", operationId: "id", ...meta })).ok, false);
  }
  assert.equal(engine.calls.length, 0);
});

test("stale generation acknowledgements cannot update state or execute queued work", async (t) => {
  const { app, engine } = fixture(t), gate = deferred();
  engine.effect = () => gate.promise;
  const a = app.dispatch({ cmd: "eval", value: 'd1 $ sound "bd"' });
  const b = app.dispatch({ cmd: "tempo", value: 123 });
  await turn(); engine.generation++; gate.resolve();
  assert.equal((await a).ok, false); assert.equal((await b).ok, false);
  assert.deepEqual(app.rig.slots, {}); assert.equal(engine.calls.length, 1);
});

test("reset waits for replay and preserves stopped patterns", async (t) => {
  const { app, engine } = fixture(t);
  await app.dispatch({ cmd: "eval", value: 'd1 $ sound "bd"' });
  await app.dispatch({ cmd: "stop" });
  assert.equal((await app.dispatch({ cmd: "reset" })).ok, true);
  assert.equal(engine.generation, 1); assert.equal(app.rig.stopped, true); assert.equal(app.rig.slots.d1, 'sound "bd"');
  assert.equal(engine.calls.at(-1), "hush");
});

test("failed load retains the previous set and removes partially applied new slots", async (t) => {
  const { app, engine, dir } = fixture(t);
  await app.dispatch({ cmd: "eval", value: 'd1 $ sound "bd"' });
  writeFileSync(path.join(dir, "bad.tidal"), 'd2 $ sound "cp"\nd3 $ broken\n');
  engine.effect = async (code) => { if (code.includes("broken")) throw new Error("not in scope"); };
  assert.equal((await app.dispatch({ cmd: "load", value: "bad" })).ok, false);
  assert.deepEqual(app.rig.slots, { d1: 'sound "bd"' });
  assert.deepEqual(engine.calls.slice(-3), ["hush", 'd1 $ sound "bd"', "unmuteAll >> unsoloAll"]);
});

test("save and recording I/O failures are failures, not successful messages", async (t) => {
  const { engine, dir } = fixture(t);
  const file = path.join(dir, "not-a-directory"); writeFileSync(file, "x");
  const app = new Application(engine, { sets: file, recordings: file, device: file });
  assert.equal((await app.dispatch({ cmd: "save", value: "test" })).ok, false);
  assert.equal((await app.dispatch({ cmd: "record" })).ok, false);
  assert.equal(app.rig.recording, false);
});

test("record stop does not report a saved WAV when the engine produced no file", async (t) => {
  const { app } = fixture(t);
  await app.dispatch({ cmd: "record" });
  const result = await app.dispatch({ cmd: "record" });
  assert.equal(result.ok, false); assert.equal(app.rig.recording, false);
});

test("a broken recorder cannot prevent Reset from recovering the engine", async (t) => {
  const { app, engine } = fixture(t);
  await app.dispatch({ cmd: "record" });
  engine.effect = async (code) => { if (code.includes("~recBuf.close")) throw new Error("recorder unavailable"); };
  const result = await app.dispatch({ cmd: "reset" });
  assert.equal(engine.generation, 1); assert.equal(engine.state, "ready"); assert.equal(app.rig.recording, false);
  assert.ok(!result.ok && /Engine restarted.*Recording finalization/.test(result.error));
});

test("a malformed or unfinalized WAV is not reported as saved", async (t) => {
  const { app } = fixture(t);
  await app.dispatch({ cmd: "record" }); writeFileSync(app.rig.recPath, Buffer.alloc(80));
  const result = await app.dispatch({ cmd: "record" });
  assert.ok(!result.ok && /finalization/.test(result.error));
});
