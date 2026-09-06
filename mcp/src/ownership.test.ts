import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import dgram from "node:dgram";
import { identifyOwnedProcess, stopOwnedProcessTree } from "./owned-process.js";
import { Engine, assertAudioPortsFree } from "./engine.js";
import { Meter } from "./meter.js";

test("ownership requires creation identity, never just a matching PID", { skip: process.platform !== "win32" }, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true });
  try {
    await once(child, "spawn");
    const id = identifyOwnedProcess(child.pid!);
    stopOwnedProcessTree({ ...id, started: (BigInt(id.started) - 1n).toString() });
    assert.doesNotThrow(() => process.kill(child.pid!, 0));
    const exited = once(child, "exit"); stopOwnedProcessTree(id); await exited;
  } finally { child.kill(); }
});

test("owned descendants stop while an unrelated process of the same executable survives", { skip: process.platform !== "win32" }, async () => {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true });
  const root = spawn(process.execPath, ["-e", `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true}); console.log(c.pid); setInterval(()=>{},1000);`], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const [out] = await once(root.stdout!, "data"); const descendant = Number(String(out).trim());
    assert.ok(descendant > 0);
    const id = identifyOwnedProcess(root.pid!), exited = once(root, "exit");
    stopOwnedProcessTree(id); await exited;
    assert.throws(() => process.kill(descendant, 0));
    assert.doesNotThrow(() => process.kill(unrelated.pid!, 0));
  } finally { root.kill(); unrelated.kill(); }
});

test("occupied audio port fails without disturbing its owner", async () => {
  const socket = dgram.createSocket("udp4");
  // Do not require this fixed port to be free when a real rig is in use.
  try {
    socket.bind(57110, "127.0.0.1"); await once(socket, "listening");
  } catch (e) { socket.close(); if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") return; throw e; }
  try { await assert.rejects(assertAudioPortsFree(), /57110.*unavailable/); assert.equal(socket.address().port, 57110); }
  finally { socket.close(); }
});

test("meter port conflicts are surfaced rather than silently disabling telemetry", async () => {
  const socket = dgram.createSocket("udp4"); socket.bind(0, "127.0.0.1"); await once(socket, "listening");
  const meter = new Meter();
  try { await assert.rejects(meter.start(socket.address().port), /EADDRINUSE/); assert.match(meter.error!, /unavailable/); }
  finally { meter.stop(); socket.close(); }
});

test("late faults from a stopped engine generation cannot poison its successor", async () => {
  const engine = new Engine(async () => {}), old = engine.tidal;
  old.emit("fault", { kind: "interpreter", message: "late failure" });
  assert.equal(engine.state, "degraded");
  engine.stop(); const version = engine.faultVersion, message = engine.error;
  old.emit("fault", { kind: "process", message: "old process exited" });
  assert.equal(engine.faultVersion, version); assert.equal(engine.error, message);
  await assert.rejects(engine.ensureBooted(), /stopped/);
});
