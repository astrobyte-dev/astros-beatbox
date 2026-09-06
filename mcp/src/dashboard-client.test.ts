import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Unit harness for the unchanged vanilla dashboard, without audio, browser timers
// or a network. These assertions cover user-visible failure handling and Stop.
function dashboard() {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", innerHTML: "", style: {}, className: "", classList: { toggle() {}, contains() { return false; } }, getContext: () => ({}) });
    return elements.get(id);
  };
  const state = { slots: {}, muted: [], solo: null, stopped: false, paused: false, status: "ready", synchronized: true, sessionId: "test", devices: [] };
  let response: any = { ok: true, msg: "action evaluated" }, networkError = false;
  const requests: any[] = [];
  const ctx: any = { document: { getElementById: element, querySelector: () => null, addEventListener() {} }, innerWidth: 800, innerHeight: 600,
    addEventListener() {}, requestAnimationFrame() {}, setInterval() {}, setTimeout() {}, clearTimeout() {},
    performance, crypto: { randomUUID }, AbxDsp: { audioPhase: () => 0 }, EventSource: class {},
    fetch: async (url: string, options?: any) => {
      if (url === "/cmd") { requests.push(JSON.parse(options.body)); if (networkError) throw new Error("offline"); return { json: async () => response }; }
      return { ok: true, json: async () => url === "/sets" ? [] : state };
    },
  };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../dashboard.js", import.meta.url), "utf8"), ctx);
  return { ctx, element, state, requests, reply: (r: any) => { response = r; }, disconnect: () => { networkError = true; } };
}
const turn = () => new Promise<void>((r) => setImmediate(r));

test("dashboard preserves failed code and displays the actual error", async () => {
  const d = dashboard(); await turn();
  d.element("consoleIn").value = "d1 $ broken";
  d.reply({ ok: false, error: "Variable not in scope: broken" });
  d.ctx.runCode(); await turn();
  assert.equal(d.element("consoleIn").value, "d1 $ broken");
  assert.equal(d.element("consoleOut").className, "err");
  assert.match(d.element("consoleOut").textContent, /not in scope/);
});

test("dashboard only clears acknowledged code, preserving newer text typed during evaluation", async () => {
  const d = dashboard(); await turn();
  d.element("consoleIn").value = 'd1 $ s "bd"'; d.ctx.runCode();
  d.element("consoleIn").value = 'd2 $ s "cp"'; await turn();
  assert.equal(d.element("consoleIn").value, 'd2 $ s "cp"');
  d.ctx.runCode(); await turn(); assert.equal(d.element("consoleIn").value, "");
});

test("network failures never become an empty successful result; requests carry retry identity", async () => {
  const d = dashboard(); await turn(); d.disconnect();
  const result = await d.ctx.send({ cmd: "stop" });
  assert.equal(result.ok, false); assert.match(result.error, /outcome unknown/);
  assert.equal(d.requests[0].sessionId, "test"); assert.ok(d.requests[0].operationId); assert.ok(d.requests[0].issuedAt);
});

test("Stop keeps cards and Play available while suppressing automatic song advancement", async () => {
  const d = dashboard(); await turn();
  Object.assign(d.state, { slots: { d1: 's "bd"' }, stopped: true, paused: true });
  d.ctx.render(d.state); let advances = 0;
  d.ctx.AbxSeq = { songAdvance: () => { advances++; }, renderPlayhead() {} };
  d.ctx.loopTick();
  assert.equal(advances, 0); assert.match(d.element("btnPlay").innerHTML, /Play/);
  assert.equal(d.element("btnPlay").style.display, ""); assert.match(d.element("grid").innerHTML, /bd/);
  assert.equal(d.ctx.transport(), "stopped");
  Object.assign(d.state, { status: "degraded", synchronized: false });
  assert.equal(d.ctx.transport(), "stopped", "acknowledged Stop remains visible despite an older diagnostic");
});

test("Stop flushes a pending curve before queuing silence, preventing a delayed restart", async () => {
  const d = dashboard(); await turn();
  Object.assign(d.state, { slots: { d1: 's "bd"' } });
  vm.runInContext(readFileSync(new URL("../dashboard-curves.js", import.meta.url), "utf8"), d.ctx);
  d.ctx.AbxCurves.handleClick({ dataset: { curve: "preset", dn: "d1", shape: "ramp" } });
  assert.equal(d.requests.length, 0);
  await d.ctx.cmd("stop");
  assert.deepEqual(d.requests.map((r) => r.cmd), ["eval", "stop"]);
});
