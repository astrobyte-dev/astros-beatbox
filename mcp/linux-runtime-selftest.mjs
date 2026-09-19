// Tier B: real Linux owner/HTTP/process/socket lifecycle; no audio toolchain.
// --open additionally exercises the desktop's actual xdg-open URL association.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
assert.equal(process.platform, "linux", "Linux acceptance only");
const exec = promisify(execFile), dir = mkdtempSync(path.join(tmpdir(), "abx-linux-runtime-"));
const env = { ...process.env, TIDAL_METER_PORT: "0", TIDAL_PROJECTS_DIR: path.join(dir, "projects"), TIDAL_RECOVERY_DIR: path.join(dir, "recovery"), TIDAL_RECORDINGS_DIR: path.join(dir, "recordings") };
Object.assign(process.env, env);
const { runtimeKey, RUNTIME_PROTOCOL } = await import("./dist/runtime.js");
const { inspectLinux, readLinuxIdentity } = await import("./dist/linux-process.js");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async check => { for (let i = 0; i < 150; i++) { if (await check()) return; await sleep(50); } throw new Error("Lifecycle deadline exceeded"); };
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
env.TIDAL_DASH_PORT = String(reserve.address().port); await new Promise(r => reserve.close(r));
const url = `http://127.0.0.1:${env.TIDAL_DASH_PORT}`;
const launch = async (args = [], extra = {}) => exec(process.execPath, [path.resolve("dist/launcher.js"), ...args], { env: { ...env, ...extra }, timeout: 30000 });
const info = async () => (await fetch(url + "/runtime")).json();
const stop = async () => {
  let identity; try { identity = await info(); } catch { return; }
  const response = await fetch(url + "/runtime/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: identity.sessionId }) });
  assert.equal(response.status, 200, await response.text());
  await until(() => !inspectLinux().sockets.some(s => s.pid === identity.pid));
  await until(() => { try { return readLinuxIdentity(identity.pid).state === "Z"; } catch { return true; } });
};
let browser;
try {
  const first = JSON.parse((await launch()).stdout); assert.equal(first.reused, false);
  const before = await info();
  const second = JSON.parse((await launch()).stdout); assert.equal(second.reused, true); assert.deepEqual(await info(), before);
  const noBrowser = await launch(["--open"], { PATH: "" });
  assert.match(noBrowser.stderr, /Beatbox is running.*Open http/); assert.deepEqual(await info(), before);
  const inventory = inspectLinux(); assert.equal(inventory.error, null);
  assert.ok(inventory.sockets.some(s => s.pid === before.pid && s.port === +env.TIDAL_DASH_PORT));
  browser = await chromium.launch({ headless: true, executablePath: process.env.ABX_CHROMIUM || undefined });
  const page = await browser.newPage();
  await page.goto(url + "/studio"); await page.locator(".topbar").waitFor();
  await page.goto(url + "/system"); await page.getByRole("heading", { name: "Ready when you are" }).waitFor();
  assert.equal(await page.getByText(/Read-only Windows inspection/).count(), 0);
  const health = await (await fetch(url + "/runtime/health")).json(); assert.equal(health.platform, "Linux"); assert.equal(health.inspection.available, true);
  const stopped = await fetch(url + "/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: "audio.stop", sessionId: before.sessionId, expectedGeneration: 0 }) });
  assert.equal(stopped.status, 200); await stop();
  // Actual signal delivery to our own direct runtime child, with port-exit checks.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    const child = spawn(process.execPath, [path.resolve("dist/runtime.js")], { env, stdio: "ignore" });
    try { await until(async () => { try { return (await info()).ready; } catch { return false; } }); const exited = once(child, "exit"); child.kill(signal); assert.equal((await exited)[0], 0); assert.ok(!inspectLinux().sockets.some(s => s.pid === child.pid)); }
    finally { if (child.exitCode === null) child.kill(); }
  }
  const external = http.createServer((req, res) => res.end("unrelated")); external.listen(0, "127.0.0.1"); await once(external, "listening");
  try { await assert.rejects(launch([], { TIDAL_DASH_PORT: String(external.address().port) }), /PORT CONFLICT/); assert.equal(await (await fetch(`http://127.0.0.1:${external.address().port}`)).text(), "unrelated"); }
  finally { await new Promise(r => external.close(r)); }
  if (process.argv.includes("--open")) {
    let visit; const visited = new Promise(r => { visit = r; });
    const fixture = http.createServer((req, res) => {
      if (req.url === "/runtime") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ kind: "astros-beatbox-runtime", protocol: RUNTIME_PROTOCOL, key: runtimeKey, ready: true, sessionId: before.sessionId, pid: process.pid })); }
      else { if (req.url === "/studio?alreadyRunning=1") visit(); res.end("<title>Beatbox Linux browser check passed</title><h1>Beatbox browser check passed</h1><p>You can close this test tab.</p>"); }
    });
    fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
    let timer;
    try { await Promise.all([launch(["--open"], { TIDAL_DASH_PORT: String(fixture.address().port) }), Promise.race([visited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Default browser did not visit Studio")), 25000); })])]); }
    finally { clearTimeout(timer); fixture.closeAllConnections(); await new Promise(r => fixture.close(r)); }
    console.log("LINUX DEFAULT BROWSER PASS: actual xdg-open / Studio request observed");
  }
  console.log("LINUX RUNTIME PASS: cold launch, second-launch session reuse, Studio/System, native inventory, Stop/Quit, SIGTERM/SIGINT/SIGHUP, owner exit/port release, unowned conflict protection. No audio claimed.");
} finally { await browser?.close(); await stop(); rmSync(dir, { recursive: true, force: true }); }
