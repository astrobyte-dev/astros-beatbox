import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { startDashboard } from "./dashboard.js";
import { DASHBOARD_HTML } from "./config.js";
import type { CommandResult } from "./commands.js";

test("HTTP preserves command failures, acknowledgements and operation IDs", async (t) => {
  let result: CommandResult = { ok: false, code: "EXECUTION", error: "compilation failed", operationId: "op", sessionId: "session", generation: 3 };
  let calls = 0;
  const server = startDashboard(0, DASHBOARD_HTML, () => ({ status: "idle" }), () => ({}), async () => { calls++; return result; });
  t.after(() => { server.close(); server.closeAllConnections(); });
  await once(server, "listening");
  const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  let response = await fetch(url + "/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: '{"cmd":"eval","value":"bad"}' });
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), result);
  result = { ok: true, msg: "action evaluated", acknowledgement: "action", operationId: "op2", sessionId: "session", generation: 3 };
  response = await fetch(url + "/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: '{"cmd":"stop"}' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), result);
  response = await fetch(url + "/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(response.status, 400); assert.equal((await response.json()).ok, false); assert.equal(calls, 2);
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url + "/dashboard.js")).status, 200);
});

test("a second server fails startup without taking over an occupied dashboard port", { timeout: 15000 }, async () => {
  const owner = http.createServer((_req, res) => res.end("original owner")); owner.listen(0, "127.0.0.1"); await once(owner, "listening");
  const port = (owner.address() as { port: number }).port;
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.js", import.meta.url))], {
    env: { ...process.env, TIDAL_DASH_PORT: String(port) }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  let error = ""; child.stderr.on("data", (d) => { error += d; });
  try {
    const [code] = await once(child, "exit"); assert.equal(code, 1); assert.match(error, /EADDRINUSE/);
    assert.equal(await (await fetch("http://127.0.0.1:" + port)).text(), "original owner");
  } finally { child.kill(); owner.close(); owner.closeAllConnections(); }
});
