import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { Application, type CommandEngine } from "./application.js";
import { RuntimeLogs } from "./runtime-logs.js";
import { parseNetstat, verifiedTree, portInventory, inspectWindows, type ProcessRow, type Inspection } from "./runtime-inspection.js";
import { validRuntime } from "./runtime-client.js";
import { RUNTIME_PROTOCOL, runtimeKey } from "./runtime.js";
import { RuntimeHealth } from "./runtime-health.js";
import { Engine } from "./engine.js";
import { Meter } from "./meter.js";
import { identifyOwnedProcess } from "./owned-process.js";
import { ProcDriver } from "./proc.js";

const row = (pid: number, parentPid: number, started: string): ProcessRow => ({ pid, parentPid, started, name: "node.exe", path: "C:/node.exe", startedAt: new Date().toISOString() });
test("inventory verifies owned roots and descendants without adopting unrelated same-name processes", () => {
  assert.deepEqual([...verifiedTree([row(1, 0, "10"), row(2, 1, "11"), row(3, 0, "12")], [{ pid: 1, started: "10" }])], [1, 2]);
});
test("inventory rejects PID reuse, missing parents and children older than their parents", () => {
  assert.equal(verifiedTree([row(1, 0, "20"), row(2, 1, "21")], [{ pid: 1, started: "10" }]).size, 0);
  assert.equal(verifiedTree([row(2, 1, "11")], [{ pid: 1, started: "10" }]).size, 0);
  assert.deepEqual([...verifiedTree([row(1, 0, "20"), row(2, 1, "19")], [{ pid: 1, started: "20" }])], [1]);
});
test("netstat parses TCP listeners and UDP endpoints including IPv6; ignores outbound connections", () => {
  assert.deepEqual(parseNetstat(" TCP 127.0.0.1:3737 0.0.0.0:0 LISTENING 1\n UDP [::]:57120 *:* 2\n TCP 127.0.0.1:50 127.0.0.1:3737 ESTABLISHED 3"), [{ protocol: "TCP", port: 3737, address: "127.0.0.1", pid: 1 }, { protocol: "UDP", port: 57120, address: "[::]", pid: 2 }]);
});
const required = [{ protocol: "TCP" as const, port: 3737, purpose: "Studio" }];
test("port inventory distinguishes free, owned, unknown and unowned conflicts", () => {
  const s: Inspection = { at: Date.now(), error: null, processes: [row(1, 0, "10")], sockets: [] };
  assert.equal(portInventory(s, new Set(), required)[0].state, "free");
  s.sockets = [{ protocol: "TCP", port: 3737, address: "0.0.0.0", pid: 1 }];
  assert.equal(portInventory(s, new Set([1]), required)[0].state, "owned");
  assert.equal(portInventory(s, new Set(), required)[0].state, "conflict");
  s.error = "Inspection failed";
  assert.equal(portInventory(s, new Set(), required)[0].state, "unknown");
});
test("port inventory includes observed dynamic dependencies and does not mistake remote bindings for loopback conflicts", () => {
  const s: Inspection = { at: Date.now(), error: null, processes: [], sockets: [{ protocol: "UDP", port: 60000, address: "0.0.0.0", pid: 1 }, { protocol: "TCP", port: 3737, address: "192.168.1.1", pid: 2 }] };
  const ports = portInventory(s, new Set([1]), required);
  assert.equal(ports.length, 2); assert.equal(ports[0].state, "unknown"); assert.equal(ports[1].owned, true);
});
test("runtime identity rejects unrelated, stale protocol/workspace and incomplete ready identities", () => {
  const info = { kind: "astros-beatbox-runtime", protocol: RUNTIME_PROTOCOL, key: runtimeKey, ready: true, pid: 5, sessionId: "12345678-1234-4234-8234-123456789012" };
  assert.equal(validRuntime(info), true);
  for (const bad of [null, {}, { ...info, key: "stale" }, { ...info, protocol: 0 }, { ...info, pid: -1 }, { ...info, sessionId: undefined }]) assert.equal(validRuntime(bad), false);
  assert.equal(validRuntime({ ...info, ready: false, sessionId: undefined }), true);
});
test("logs retain bounded source-tagged entries and filter without mutating shared history", () => {
  const logs = new RuntimeLogs(3);
  for (let i = 0; i < 20; i++) logs.add(i % 2 ? "runtime" : "recording", "Message " + i);
  assert.equal(logs.read().length, 3); assert.equal(logs.read("recording").length, 1);
  assert.equal(logs.read(undefined, 19).length, 1); assert.equal(logs.lastId, 20);
  const copy = logs.read(); copy[0].message = "changed"; assert.notEqual(logs.read()[0].message, "changed");
});
test("child logs join partial lines, omit echoed code and protocol frames, and redact common credentials", () => {
  const logs = new RuntimeLogs();
  logs.child("tidal", "stdout", "Load", 1); logs.child("tidal", "stdout", "ed\nABX_frame\nSystem.IO.secret\npassword=private token=secret\n", 1);
  const entries = logs.read("tidal", 0, true); assert.equal(entries[0].message, "Loaded"); assert.equal(entries[0].generation, 1);
  assert.equal(entries.length, 2); assert.doesNotMatch(entries[1].message, /private|=secret/);
  logs.add("runtime", "a".repeat(1000000)); assert.equal(logs.read().at(-1)!.message.length, 2048);
});
test("real driver output is captured and exit state remains inspectable", async () => {
  const logs = new RuntimeLogs(), driver = new ProcDriver(process.execPath, ["-e", "console.log('captured child output');"]);
  driver.on("log", e => logs.child("tidal", e.stream, e.text, 0));
  driver.start(); await new Promise<void>(resolve => driver.on("unavailable", () => resolve()));
  assert.equal(driver.health.exited, true); assert.equal(driver.health.usable, false); assert.ok(driver.health.pid);
  assert.match(logs.read("tidal", 0, true)[0].message, /captured child output/);
});

class FakeEngine implements CommandEngine {
  generation = 0; running = true; state = "ready"; error: string | null = null;
  calls: string[] = []; failStop = false; effect = async (_code: string) => {};
  stop() { this.calls.push("engine.stop"); if (this.failStop) throw new Error("Owned process did not exit: 987"); this.generation++; this.running = false; this.state = "idle"; }
  async reboot() { this.stop(); this.calls.push("engine.reboot"); this.running = true; this.state = "ready"; }
  async ensureBooted() { this.running = true; this.state = "ready"; }
  assertGeneration(g: number) { assert.equal(g, this.generation, "stale generation"); }
  tidal = { eval: async (code: string, operationId = "test") => { this.calls.push(code); await this.effect(code); return { operationId, acknowledgement: "action" as const, output: "" }; }, hush: async (id?: string) => this.tidal.eval("hush", id) };
  sclang = { eval: async (code: string, operationId = "test") => { this.calls.push(code); await this.effect(code); return { operationId, acknowledgement: "action" as const, output: "" }; }, evalRoutine: async (code: string, id?: string) => this.sclang.eval(code, id) };
}
function fixture(t: { after(f: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-p25-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = new FakeEngine(), app = new Application(engine, { recordings: dir, sets: dir, device: path.join(dir, "device") });
  app.lifecycleHooks = { quit: async () => { engine.calls.push("quit"); }, restartServices: async () => { engine.calls.push("telemetry.restart"); } };
  const command = (cmd: string, operationId = cmd) => ({ cmd, operationId, issuedAt: Date.now(), sessionId: app.sessionId, expectedGeneration: engine.generation });
  return { engine, app, command };
}
test("stop audio keeps authored music and marks transport stopped without booting another engine", async t => {
  const { app, engine, command } = fixture(t); const p = app.project.document;
  assert.equal((await app.dispatch(command("audio.stop"))).ok, true);
  assert.deepEqual(app.project.document, p); assert.equal(app.rig.stopped, true); assert.equal(engine.running, false); assert.equal(app.lifecycle.phase, "Complete");
});
test("restart audio restores through the existing application path", async t => {
  const { app, engine, command } = fixture(t);
  assert.equal((await app.dispatch(command("audio.restart"))).ok, true);
  assert.ok(engine.calls.includes("engine.reboot")); assert.equal(engine.running, true);
});

test("quit expiring in the queue restores admission without shutting down services", async t => {
  const { app, engine, command } = fixture(t); let release!: () => void;
  t.mock.timers.enable({ apis: ["Date"], now: 1000000 });
  engine.effect = () => new Promise<void>(r => { release = r; });
  const busy = app.dispatch({ cmd: "eval_sc", value: "1.postln" }); await new Promise(r => setImmediate(r));
  const quit = app.dispatch(command("runtime.quit"));
  t.mock.timers.tick(Application.RETRY_MS + 1); engine.effect = async () => {}; release(); await busy;
  const result = await quit; assert.ok(!result.ok && result.code === "EXPIRED");
  assert.equal(engine.running, true); assert.ok(!engine.calls.includes("quit"));
  assert.equal(app.lifecycle.phase, "Failed"); assert.match(app.lifecycle.error!, /expired/);
  assert.ok((await app.dispatch({ cmd: "boot" })).ok);
});
test("restart services stops audio before telemetry and then prepares audio", async t => {
  const { app, engine, command } = fixture(t);
  assert.equal((await app.dispatch(command("runtime.restart"))).ok, true);
  assert.ok(engine.calls.indexOf("engine.stop") < engine.calls.indexOf("telemetry.restart"));
  assert.ok(engine.calls.indexOf("telemetry.restart") < engine.calls.indexOf("engine.reboot"));
});
test("lifecycle requests deduplicate pending/completed work and reject repeated clicks and conflicting IDs", async t => {
  const { app, engine, command } = fixture(t); let release!: () => void;
  engine.effect = () => new Promise<void>(r => { release = r; });
  const c = command("audio.stop"), first = app.dispatch(c), retry = app.dispatch(c);
  assert.equal(first, retry);
  assert.equal((await app.dispatch(command("audio.restart"))).ok, false);
  assert.equal((await app.dispatch({ ...c, cmd: "runtime.quit" })).ok, false);
  await new Promise(r => setImmediate(r)); engine.effect = async () => {}; release();
  const result = await first; assert.equal(result.ok, true); assert.deepEqual(await app.dispatch(c), result); assert.equal(engine.calls.filter(c => c === "engine.stop").length, 1);
});
test("stale lifecycle sessions and generations never reach the engine", async t => {
  const { app, engine, command } = fixture(t);
  for (const c of [{ ...command("audio.stop"), sessionId: "old" }, { ...command("audio.stop"), expectedGeneration: 99 }, { cmd: "audio.stop" }]) assert.equal((await app.dispatch(c)).ok, false);
  assert.equal(engine.calls.length, 0);
});
test("quit drains previously accepted work, closes owned services and refuses later music", async t => {
  const { app, engine, command } = fixture(t);
  const work = app.dispatch({ cmd: "eval_sc", value: '"prior".postln;' });
  const quit = app.dispatch(command("runtime.quit"));
  assert.equal((await app.dispatch({ cmd: "boot" })).ok, false);
  assert.equal((await work).ok, true); assert.equal((await quit).ok, true);
  assert.ok(engine.calls.indexOf('"prior".postln;') < engine.calls.indexOf("engine.stop")); assert.equal(engine.calls.at(-1), "quit");
});
test("child cleanup failure retains control service, reports PID and permits deliberate quit retry", async t => {
  const { app, engine, command } = fixture(t); engine.failStop = true;
  const r = await app.dispatch(command("runtime.quit")); assert.equal(r.ok, false); assert.match(app.lifecycle.error!, /987/); assert.ok(!engine.calls.includes("quit"));
  engine.failStop = false;
  assert.equal((await app.dispatch(command("runtime.quit", "retry"))).ok, true); assert.equal(engine.calls.at(-1), "quit");
});
test("recording is finalized before owned audio exits during quit", async t => {
  const { app, engine, command } = fixture(t);
  assert.equal((await app.dispatch({ cmd: "record.start" })).ok, true);
  const wav = Buffer.alloc(44 + 4800 * 4); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40); writeFileSync(app.rig.recPath, wav);
  const r = await app.dispatch(command("runtime.quit")); assert.equal(r.ok, true);
  assert.equal(app.recordings.list()[0].state, "ready"); assert.ok(engine.calls.findIndex(c => c.startsWith("~recSynth.free")) < engine.calls.indexOf("engine.stop"));
});
test("failed recording finalization stops owned audio but does not silently quit", async t => {
  const { app, engine, command } = fixture(t); await app.dispatch({ cmd: "record.start" });
  const r = await app.dispatch(command("runtime.quit")); assert.equal(r.ok, false); assert.match(app.lifecycle.error!, /finalization/); assert.ok(engine.calls.includes("engine.stop")); assert.ok(!engine.calls.includes("quit"));
});
test("headless launch paths force windowsHide and do not wrap managed interpreters in a shell", () => {
  const proc = readFileSync(new URL("../src/proc.ts", import.meta.url), "utf8");
  assert.match(proc, /windowsHide: true, stdio: \["pipe", "pipe", "pipe"\]/); assert.doesNotMatch(proc, /shell: true|cmd\.exe/);
  for (const f of ["runtime-client", "runtime-inspection", "owned-process", "launcher"]) assert.match(readFileSync(new URL(`../src/${f}.ts`, import.meta.url), "utf8"), /windowsHide: true/);
});
test("real Windows inventory agrees with a freshly captured owned process identity", { skip: process.platform !== "win32" }, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true, stdio: "ignore" });
  try { await once(child, "spawn"); const identity = identifyOwnedProcess(child.pid!); const os = await inspectWindows(); assert.equal(os.error, null); assert.ok(verifiedTree(os.processes, [identity]).has(child.pid!)); }
  finally { child.kill(); }
});
test("System HTTP uses the persistent owner, reports idle truthfully and retains origin guards", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-p25-http-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {startRuntime} from ${JSON.stringify(new URL("runtime.js", import.meta.url).href)}; const r=await startRuntime(0); console.log(r.url);`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TIDAL_METER_PORT: "0", TIDAL_PROJECTS_DIR: path.join(dir, "projects"), TIDAL_RECOVERY_DIR: path.join(dir, "recovery"), TIDAL_RECORDINGS_DIR: path.join(dir, "recordings") } });
  const [output] = await once(child.stdout!, "data"), url = String(output).trim();
  try {
    assert.equal((await fetch(url + "/system")).status, 200);
    const health = await (await fetch(url + "/runtime/health")).json(); assert.equal(health.sessionId, (await (await fetch(url + "/runtime")).json()).sessionId); assert.equal(health.audio.state, "Idle"); assert.ok(health.components.some((c: { id: string }) => c.id === "recording"));
    const denied = await fetch(url + "/runtime/bridge", { method: "POST", headers: { Origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }); assert.equal(denied.status, 403);
    const logs = await (await fetch(url + "/runtime/logs?source=studio")).json(); assert.ok(logs.entries.every((e: { source: string }) => e.source === "studio"));
  } finally { const exited = once(child, "exit"); child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); }
});

test("health never equates stale telemetry or a stale generation observation with readiness", async t => {
  const { app } = fixture(t), engine = new Engine(), meter = new Meter();
  t.after(() => meter.stop()); engine.state = "ready";
  const h = new RuntimeHealth(engine, meter, app, 3737, new RuntimeLogs());
  h.inspection.snapshot = { at: Date.now(), processes: [], sockets: [], error: null };
  assert.equal((await h.snapshot()).audio.state, "Degraded");
  h.inspection.refresh = async () => { engine.generation++; return h.inspection.snapshot; };
  assert.equal((await h.snapshot()).inspection.fresh, false);
});
test("MCP heartbeat inventory is bounded, rejects stale sessions and never adopts client ownership", async t => {
  const { app } = fixture(t), engine = new Engine(), meter = new Meter(); t.after(() => meter.stop());
  const h = new RuntimeHealth(engine, meter, app, 3737, new RuntimeLogs()); h.inspection.snapshot = { at: Date.now(), processes: [], sockets: [], error: null };
  assert.throws(() => h.bridge({ id: "12345678-1234-4234-8234-123456789012", pid: 55, sessionId: "old", connected: true }));
  for (let i = 0; i < 50; i++) h.bridge({ id: `12345678-1234-4234-8234-${String(i).padStart(12, "0")}`, pid: 55, sessionId: app.sessionId, connected: true });
  assert.equal(h.bridges.size, 32);
  for (const b of h.bridges.values()) b.at = 0;
  const snapshot = await h.snapshot(); assert.ok(snapshot.components.filter(c => c.pid === 55).every(c => c.state === "Disconnected" && c.ownership === "Host-launched / not owned"));
});
test("partial child log output cannot cross engine generations", () => {
  const logs = new RuntimeLogs(); logs.child("tidal", "stdout", "old partial", 0); logs.child("tidal", "stdout", "new generation\n", 1);
  assert.equal(logs.read("tidal", 0, true)[0].message, "new generation");
});
