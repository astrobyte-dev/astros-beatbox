// Real Studio/HTTP/project/storage/MCP; explicitly synthetic microphone fixture.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Application } from "./dist/application.js";
import { SamplingFixtureEngine, fixtureWav } from "./dist/sampling-test-fixture.js";
const dir = mkdtempSync(path.join(tmpdir(), "abx-p35b-browser-"));
Object.assign(process.env, { TIDAL_PROJECTS_DIR: dir, TIDAL_RECOVERY_DIR: path.join(dir, "recovery"), TIDAL_RECORDINGS_DIR: path.join(dir, "recordings"), TIDAL_METER_PORT: "0" });
const { startDashboard } = await import("./dist/dashboard.js");
const { runtimeKey, RUNTIME_PROTOCOL } = await import("./dist/runtime.js");
const engine = new SamplingFixtureEngine();
const app = new Application(engine, { sets: dir, projects: dir, recovery: path.join(dir, "recovery"), recordings: path.join(dir, "recordings"), device: path.join(dir, "device") });
const file = path.join(dir, "Warehouse voice.wav"); writeFileSync(file, fixtureWav(1, 6000));
const state = () => ({ ...app.projectState(), sessionId: app.sessionId, generation: engine.generation, status: engine.state, error: null, slots: app.rig.slots, stopped: app.rig.stopped, paused: app.rig.paused, synchronized: app.rig.synchronized, recording: app.rig.recording, muted: [...app.rig.muted], solo: app.rig.solo, devices: [], scopes: {}, hits: {} });
const server = startDashboard(0, fileURLToPath(new URL("./dashboard.html", import.meta.url)), state, () => ({ cycle: engine.cycle, cps: .5, lead: 0, age: 0 }), c => app.dispatchExternal(c), {
  audio: () => ({ library: app.userAudio, capture: app.capture, sessionId: app.sessionId, meter: () => ({ available: app.capture.snapshot().inputReady, peak: .35 }) }),
  recordings: app.recordings, sounds: () => [], bridge: () => {},
  identity: () => ({ kind: "astros-beatbox-runtime", protocol: RUNTIME_PROTOCOL, key: runtimeKey, ready: true, sessionId: app.sessionId, pid: process.pid }),
});
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ABX_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on("pageerror", e => errors.push(String(e)));
const mcp = new Client({ name: "sampling-browser", version: "1" });
const meta = () => ({ projectId: app.project.document.id, revision: app.project.document.revision });
const call = async (name, args = {}) => { const r = await mcp.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
const until = async (check, label) => { for (let i = 0; i < 250; i++) { if (check()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error("Timed out: " + label + " " + JSON.stringify(state().capture)); };
const sync = async () => { await page.waitForFunction(rev => document.querySelector(".studio-app")?.dataset.revision === String(rev), app.project.document.revision); await page.waitForFunction(() => !document.querySelector(".feedback")?.textContent.includes("waiting for confirmation")); };
const click = async name => { await page.getByRole("button", { name, exact: true }).click(); await sync(); };
const tab = async name => { await page.locator(".lab-tabs button").filter({ hasText: new RegExp("^" + name) }).click(); };
try {
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("./dist/server.js", import.meta.url))], env: { ...process.env, TIDAL_DASH_PORT: String(server.address().port) }, stderr: "pipe" }));
  await page.goto(base + "/studio"); await click("My Sounds");
  await page.getByLabel("Audio files", { exact: true }).setInputFiles(file);
  await click("Import selected sounds"); await until(() => app.userAudio.list().length === 1, "import");
  await page.getByText("1 added · 0 already owned", { exact: true }).waitFor();
  const asset = app.userAudio.list()[0];
  const folder = path.join(dir, "selected-folder"); mkdirSync(folder); mkdirSync(path.join(folder, ".hidden"));
  writeFileSync(path.join(folder, "copy.wav"), fixtureWav(1, 6000)); writeFileSync(path.join(folder, "ignore.txt"), "ignored"); writeFileSync(path.join(folder, ".hidden", "skip.wav"), fixtureWav());
  await page.getByLabel("Audio folder", { exact: true }).setInputFiles(folder);
  await page.getByText("1 WAV files selected; 2 hidden or unsupported files skipped. Review, then import.", { exact: true }).waitFor();
  await click("Import selected sounds"); await page.getByText("0 added · 1 already owned", { exact: true }).waitFor();
  await page.getByLabel("Audio files", { exact: true }).setInputFiles(file); await click("Import selected sounds"); await page.getByText("0 added · 1 already owned", { exact: true }).waitFor();
  const history = app.project.history.undo;
  await click("▷ Preview Warehouse voice"); assert.equal(app.project.history.undo, history);
  await click("+ Add track"); await until(() => app.project.document.tracks.length === 1, "add track"); await sync();
  const clip = app.project.document.clips[0], track = app.project.document.tracks[0];
  await tab("Sample");
  const undo = app.project.history.undo;
  const wave = page.locator(".trim-wave"); const box = await wave.boundingBox();
  await page.mouse.move(box.x + box.width * .1, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .2, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await until(() => !!app.project.document.clips[0].playback, "trim"); await sync();
  assert.equal(app.project.history.undo, undo + 1); assert.ok(Math.abs(app.project.document.clips[0].playback.start - .2) < .01);
  await click("Reverse"); await until(() => app.project.document.clips[0].playback.reverse, "reverse");
  await page.getByRole("slider", { name: "Pitch", exact: true }).press("ArrowLeft"); await until(() => app.project.document.clips[0].playback.pitch === -1, "pitch"); await sync();
  await click("▷ Preview trim"); await tab("FX"); await click("+ Add effect"); await page.getByLabel("Effect to add").selectOption("reverb"); await click("+ Add effect");
  await until(() => app.project.document.tracks[0].effects?.length === 2, "effects");
  assert.deepEqual(app.project.document.tracks[0].effects.map(e => e.definitionId), ["distortion", "reverb"]);
  // First browser save, complete document checked through actual MCP reopen.
  await click("Save jam"); const dialog = page.getByRole("dialog"); await dialog.getByRole("textbox").fill("capture-lab"); await dialog.getByRole("button", { name: "Save jam", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  const imported = app.project.document;
  await call("project_new", meta()); await call("project_load", { ...meta(), name: "capture-lab" }); await sync();
  assert.deepEqual(app.project.document.clips, imported.clips); assert.deepEqual(app.project.document.tracks, imported.tracks);
  await click("Capture"); await page.getByLabel("Capture input device").selectOption("Fixture microphone"); await click("Prepare input"); await until(() => app.capture.snapshot().inputReady, "input ready");
  await page.getByText("Signal present", { exact: true }).waitFor(); assert.equal(app.capture.snapshot().monitor, false);
  await page.getByLabel("Capture name").fill("Horrible industrial voice"); await click("● Record input"); await until(() => !!app.capture.snapshot().activeId, "capture recording");
  const takeId = app.capture.snapshot().activeId;
  await click("■ Stop capture"); await until(() => app.capture.get(takeId).state === "ready", "finalization");
  await click("▷ Play take"); await click("Keep as Sample"); await until(() => app.capture.get(takeId).state === "kept", "keep");
  const captured = app.userAudio.list().find(e => e.origin === "captured"); assert.ok(captured);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: fileURLToPath(new URL("../docs/p35b-capture-1440.png", import.meta.url)), fullPage: true });
  await click("My Sounds"); await page.getByLabel("My Sounds filter").selectOption("Captured");
  await page.getByRole("button", { name: "Use on Warehouse voice", exact: true }).click(); await until(() => app.project.document.clips[0].assetId === captured.id, "assign capture"); await sync();
  await tab("Sample"); await click("Chop to pads"); await until(() => app.project.document.clips[0].slices?.length === 8, "chop"); await sync();
  const beforeOrder = app.project.document.clips[0].sliceSteps;
  await page.getByRole("button", { name: "Preview chop 2", exact: true }).click(); await sync();
  await page.locator(".chop-pad").nth(1).getByRole("button", { name: "Earlier", exact: true }).click(); await sync();
  assert.deepEqual(app.project.document.clips[0].sliceSteps, beforeOrder);
  await page.getByRole("button", { name: /^Undo:/ }).click(); await sync(); await page.getByRole("button", { name: /^Redo:/ }).click(); await sync();
  await click("Reverse"); await page.getByRole("slider", { name: "Pitch", exact: true }).press("ArrowLeft"); await sync();
  await click("Loop phrase"); await sync();
  const current = app.project.document.clips[0]; assert.equal(current.playback.reverse, true); assert.equal(current.playback.pitch, -1);
  // Real MCP reads and edits the same canonical slice mapping and rejects stale writes.
  const catalogue = await call("user_audio_library"); assert.equal(catalogue.entries.length, 2);
  const stale = meta();
  await call("project_edit", { ...meta(), label: "Sequence voice chops", edits: [{ type: "steps.set", clipId: clip.id, steps: clip.steps.map((_, i) => i % 4 === 0 ? 1 : 0) }, { type: "scene.duplicate", sceneId: app.project.document.sceneOrder[0], newSceneId: "voice-copy", name: "Voice copy" }] });
  const rejected = await mcp.callTool({ name: "project_edit", arguments: { ...stale, label: "Stale", edits: [{ type: "sample.playback", clipId: clip.id, playback: current.playback }] } }); assert.equal(rejected.isError, true); await sync();
  await call("project_save", { ...meta(), name: "finished-voice" }); const saved = app.project.document;
  await call("project_new", meta()); await call("project_load", { ...meta(), name: "finished-voice" }); await sync(); await page.reload(); await sync();
  assert.deepEqual(app.project.document.assets, saved.assets); assert.deepEqual(app.project.document.clips, saved.clips); assert.deepEqual(app.project.document.tracks, saved.tracks); assert.equal(app.rig.stopped, true);
  await click("Play"); await until(() => !app.rig.stopped, "play retained capture"); assert.ok(engine.calls.some(c => c.includes("loadSoundFile") && c.includes(captured.sha256)));
  await click("Pause"); await click("My Sounds"); await tab("Sample");
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: fileURLToPath(new URL(`../docs/p35b-sampling-${width}.png`, import.meta.url)), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("P3.5B BROWSER PASS: upload/deduplicate/preview/add, waveform trim grouped Undo, reverse/pitch/FX, browser save and MCP reopen, fixture input/level/record/finalize/preview/keep/assign, chops/stable reorder/Undo/Redo, sequence/scene duplication, stale MCP rejection, full reopen and native-protocol buffer loading, three layouts. No physical audio/input acceptance claimed.");
} finally {
  await mcp.close(); await browser.close(); await app.dispatch({ cmd: "stop" }); engine.stop(); server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true });
}
