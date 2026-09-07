import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { parseProcStat, parseProcSockets, inspectLinux, readLinuxIdentity } from "./linux-process.js";
import { captureOwnedIdentity, checkOwnershipSupport, stopManagedTree } from "./owned-process.js";
import { browserCommand, openBrowser } from "./browser.js";
import { audioCapabilities, linuxLocations, findExecutable } from "./platform.js";
import { portInventory } from "./runtime-inspection.js";
import { sanitizeLog, RuntimeLogs } from "./runtime-logs.js";
import { ProjectStorage } from "./project-storage.js";
import { emptyProject } from "./project.js";
import { RuntimeHealth } from "./runtime-health.js";
import { Engine } from "./engine.js";
import { Meter } from "./meter.js";
import { Application } from "./application.js";
import { ProcDriver } from "./proc.js";

const linuxOnly = { skip: process.platform !== "linux", timeout: 15000 };
function procStat(name = "worker ) (name") { return `123 (${name}) S 12 123 123 ` + Array(15).fill("0").join(" ") + " 987654321 0"; }
test("Linux stat parsing retains creation ticks and names containing spaces/parentheses", () => {
  assert.deepEqual(parseProcStat(procStat()), { pid: 123, parentPid: 12, group: 123, session: 123, state: "S", name: "worker ) (name", started: "987654321" });
});
test("Linux stat parsing refuses malformed creation and ancestry", () => {
  for (const bad of ["", "123 (x) S", procStat().replace("987654321", "invalid"), procStat().replace("S 12", "S nope")]) assert.throws(() => parseProcStat(bad));
});
const socket = (addr: string, state = "0A") => `header\n 0: ${addr}:0E99 00000000:0000 ${state} 0:0 00:0 0 1000 0 12345\n`;
test("Linux sockets parse TCP listeners, UDP endpoints and IPv4/IPv6 addresses", () => {
  assert.deepEqual(parseProcSockets(socket("0100007F"), "TCP"), [{ protocol: "TCP", address: "127.0.0.1", port: 3737, pid: 0, inode: "12345" }]);
  assert.equal(parseProcSockets(socket("00000000000000000000000001000000"), "TCP")[0].address, "[::1]");
  assert.equal(parseProcSockets(socket("00000000000000000000000000000000"), "TCP")[0].address, "[::]");
  assert.equal(parseProcSockets(socket("0100007F", "01"), "TCP").length, 0);
  assert.equal(parseProcSockets(socket("0100007F", "07"), "UDP").length, 1);
});
test("A bound socket with an inaccessible owner is never reported free", () => {
  const required = [{ protocol: "TCP" as const, port: 3737, purpose: "Studio" }];
  const sockets = parseProcSockets(socket("0100007F"), "TCP");
  assert.equal(portInventory({ at: 1, processes: [], sockets, error: null }, new Set(), required)[0].state, "conflict");
  assert.equal(portInventory({ at: 1, processes: [], sockets: [], error: "unavailable" }, new Set(), required)[0].state, "unknown");
});
test("Linux XDG storage separates workspaces and rejects relative XDG values", () => {
  const a = linuxLocations("/a", { XDG_DATA_HOME: "/data" }, "/home/person");
  const b = linuxLocations("/b", { XDG_DATA_HOME: "/data" }, "/home/person");
  assert.match(a.data, /^\/data\/astros-beatbox\//); assert.notEqual(a.data, b.data);
  assert.match(linuxLocations("/a", { XDG_DATA_HOME: "relative" }, "/home/person").data, /^\/home\/person\/\.local\/share\//);
});
test("Executable discovery honors explicit overrides, installed candidates and useful missing names", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-tool-")), executable = path.join(dir, "tool");
  try {
    writeFileSync(executable, "fixture", { mode: 0o755 });
    assert.equal(findExecutable("tool", "explicit", [executable], { PATH: "" }), "explicit");
    assert.equal(findExecutable("tool", undefined, [], { PATH: dir }), executable);
    assert.equal(findExecutable("missing-abx-tool", undefined, [], { PATH: dir }), "missing-abx-tool");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("JACK capabilities avoid unsupported device APIs; Windows retains PortAudio selection", () => {
  assert.equal(audioCapabilities("linux").deviceSelection, false);
  assert.equal(audioCapabilities("win32").deviceSelection, true);
  assert.equal(audioCapabilities("linux", "portaudio").deviceSelection, true);
  assert.throws(() => audioCapabilities("linux", "guess"));
});
test("Browser adapters keep URL a single argument and preserve Windows cscript", () => {
  const url = "http://127.0.0.1:3737/studio?alreadyRunning=1";
  assert.deepEqual(browserCommand(url, "linux"), { exe: "xdg-open", args: [url] });
  assert.equal(browserCommand(url, "win32").exe, "cscript.exe");
  for (const bad of ["https://external.test", "http://127.0.0.1:3737/studio;touch x", "file:///tmp/x"]) assert.throws(() => browserCommand(bad, "linux"));
});
test("Browser failure returns the URL without claiming runtime failure", async () => {
  const message = await openBrowser("invalid-url"); assert.match(message!, /Beatbox is running.*invalid-url/);
});
test("Linux and Windows home prefixes are redacted without changing ordinary paths", () => {
  assert.equal(sanitizeLog("/home/alice/music C:\\Users\\Bob\\music /root/music /usr/share"), "[user]/music [user]\\music [user]/music /usr/share");
});
test("Project files reject case-only collisions without overwriting either jam", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-case-"));
  try { const storage = new ProjectStorage(dir, dir); storage.save("Jam", emptyProject()); assert.throws(() => storage.save("jam", emptyProject()), /existing project spelling/); assert.deepEqual(storage.list(), ["Jam"]); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test("Linux System distinguishes unavailable inspection from an unhealthy engine", linuxOnly, async () => {
  const engine = new Engine(), meter = new Meter(), dir = mkdtempSync(path.join(tmpdir(), "abx-health-"));
  try {
    const app = new Application(engine, { sets: dir, recordings: dir, device: path.join(dir, "device") });
    const health = new RuntimeHealth(engine, meter, app, 3737, new RuntimeLogs());
    health.inspection.refresh = async () => ({ at: Date.now(), processes: [], sockets: [], error: "Permission denied" });
    const s = await health.snapshot(); assert.equal(s.state, "Inspection unavailable"); assert.equal(s.platform, "Linux"); assert.ok(s.ports.every(p => p.state === "unknown"));
    engine.state = "error"; assert.equal((await health.snapshot()).state, "Needs attention");
  } finally { meter.stop(); rmSync(dir, { recursive: true, force: true }); }
});
test("Linux inventory maps a real listening socket to this process", linuxOnly, async () => {
  const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try { const s = inspectLinux(); assert.equal(s.error, null); assert.ok(s.sockets.some(p => p.port === (server.address() as net.AddressInfo).port && p.pid === process.pid)); }
  finally { await new Promise<void>(r => server.close(() => r())); }
});
async function child(code = "setInterval(()=>{},1000)") {
  const c = spawn(process.execPath, ["-e", code], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  await once(c, "spawn"); return c;
}
test("Linux creation mismatch cannot signal a reused PID", linuxOnly, async () => {
  checkOwnershipSupport(); const c = await child();
  try { const id = captureOwnedIdentity(c.pid!); assert.throws(() => stopManagedTree({ ...id, started: (BigInt(id.started) + 1n).toString() }), /identity/); assert.equal(readLinuxIdentity(c.pid!).started, id.started); stopManagedTree(id); }
  finally { c.kill(); }
});
test("Linux tree termination releases descendant TCP/UDP sockets and preserves unrelated processes", linuxOnly, async () => {
  const code = `const n=require('node:net').createServer(); const u=require('node:dgram').createSocket('udp4'); n.listen(0,'127.0.0.1',()=>u.bind(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,tcp:n.address().port,udp:u.address().port})))); process.on('SIGTERM',()=>{});`;
  const c = await child(`const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(code)}],{stdio:['ignore','pipe','pipe']});c.stdout.pipe(process.stdout);setInterval(()=>{},1000);`);
  const unrelated = await child();
  try {
    const [out] = await once(c.stdout!, "data"), ports = JSON.parse(String(out));
    const id = captureOwnedIdentity(c.pid!); stopManagedTree(id, 0.1, 3);
    assert.equal(readLinuxIdentity(unrelated.pid!).pid, unrelated.pid);
    const s = inspectLinux(); assert.ok(!s.sockets.some(p => p.protocol === "TCP" && p.port === ports.tcp || p.protocol === "UDP" && p.port === ports.udp));
    assert.ok(!s.processes.some(p => p.pid === ports.pid && (p as unknown as { state: string }).state !== "Z"));
  } finally { c.kill(); stopManagedTree(captureOwnedIdentity(unrelated.pid!), 0, 2); }
});
test("Linux cleanup timeout is explicit and a deliberate retry can finish", linuxOnly, async () => {
  const c = await child("process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)");
  try { await once(c.stdout!, "data"); const id = captureOwnedIdentity(c.pid!); assert.throws(() => stopManagedTree(id, 5, 0.1), /timeout/); stopManagedTree(id, 0, 2); }
  finally { c.kill(); }
});
test("A descendant in a separate session is captured through verified live ancestry", linuxOnly, async () => {
  const c = await child(`const c=require('node:child_process').spawn(process.execPath,['-e',"console.log(process.pid);process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','pipe']});c.stdout.pipe(process.stdout);setInterval(()=>{},1000);`);
  try {
    const pid = Number(String((await once(c.stdout!, "data"))[0]).trim());
    assert.equal(readLinuxIdentity(pid).session, pid);
    stopManagedTree(captureOwnedIdentity(c.pid!), 0.1, 3);
    try { assert.equal(readLinuxIdentity(pid).state, "Z"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  } finally { c.kill(); }
});
test("Managed Linux driver owns a new session and stop completes before return", linuxOnly, async () => {
  const driver = new ProcDriver(process.execPath, ["-e", "console.log('ready');setInterval(()=>{},1000)"], process.env, {}, true);
  driver.start(); await driver.waitFor("ready", 5000);
  assert.ok(driver.ownershipIdentity); const pid = driver.pid!; driver.stop();
  try { assert.equal(readLinuxIdentity(pid).state, "Z"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
});
test("Real Linux drivers complete application Restart, Stop and Quit without racing old sockets", linuxOnly, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-linux-lifecycle-"));
  class Worker extends ProcDriver {
    constructor() { super(process.execPath, ["-e", "require('node:net').createServer().listen(0,'127.0.0.1',()=>console.log('ready'));"], process.env, {}, true); }
    async eval(_code: string, operationId = "fixture") { return { operationId, acknowledgement: "action" as const, output: "" }; }
    evalRoutine(code: string, id?: string) { return this.eval(code, id); }
    hush(id?: string) { return this.eval("hush", id); }
  }
  const engine = new Engine(); let old: number[] = [];
  engine.ensureBooted = async () => {
    const a = new Worker(), b = new Worker();
    engine.sclang = a as unknown as Engine["sclang"]; engine.tidal = b as unknown as Engine["tidal"];
    a.start(); b.start(); await Promise.all([a.waitFor("ready", 5000), b.waitFor("ready", 5000)]);
    old = [a.pid!, b.pid!]; engine.state = "ready";
    Object.defineProperty(engine, "running", { configurable: true, get: () => a.running && b.running });
  };
  engine.reboot = async () => { engine.stop(); await engine.ensureBooted(); };
  const app = new Application(engine, { recordings: dir, sets: dir, device: path.join(dir, "device") }); let quit = false;
  app.lifecycleHooks = { quit: async () => { quit = true; } };
  const run = async (cmd: string) => { const r = await app.dispatch({ cmd, sessionId: app.sessionId, expectedGeneration: engine.generation }); assert.equal(r.ok, true, JSON.stringify(r)); };
  try {
    await engine.ensureBooted(); const first = [...old];
    await run("audio.restart"); assert.ok(old.every(p => !first.includes(p))); assert.ok(!inspectLinux().sockets.some(s => first.includes(s.pid)));
    await run("audio.stop"); assert.ok(!inspectLinux().sockets.some(s => old.includes(s.pid)));
    await run("audio.restart"); await run("runtime.quit"); assert.equal(quit, true); assert.ok(!inspectLinux().sockets.some(s => old.includes(s.pid)));
  } finally { engine.stop(); rmSync(dir, { recursive: true, force: true }); }
});
