// Opt-in P1 proof through Chromium -> production HTTP -> P0b -> real Tidal/SC.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Application } from "./dist/application.js";
import { compileClip } from "./dist/project-compiler.js";
const dir = mkdtempSync(path.join(tmpdir(), "abx-p1-live-"));
process.env.TIDAL_PROJECTS_DIR = dir;
const { Engine, assertAudioPortsFree } = await import("./dist/engine.js");
const { Meter } = await import("./dist/meter.js");
const { startDashboard } = await import("./dist/dashboard.js");
const { DIRT_SAMPLES_DIR, METER_UDP_PORT } = await import("./dist/config.js");
const engine = new Engine(),
  meter = new Meter();
const app = new Application(engine, {
  sets: dir,
  recordings: dir,
  projects: dir,
  recovery: path.join(dir, "recovery"),
  device: path.join(dir, "device"),
  samples: DIRT_SAMPLES_DIR,
});
const state = () => ({
  ...app.projectState(),
  sessionId: app.sessionId,
  generation: engine.generation,
  status: engine.state,
  error: engine.error,
  stopped: app.rig.stopped,
  paused: app.rig.paused,
  synchronized: app.rig.synchronized && engine.state !== "degraded",
  recording: app.rig.recording,
  recPath: app.rig.recPath,
  slots: app.rig.slots,
});
const server = startDashboard(
  0,
  fileURLToPath(new URL("./dashboard.html", import.meta.url)),
  state,
  () => ({
    cycle: meter.cycle,
    cps: meter.cps,
    lead: meter.lead,
    age: Date.now() - meter.cycleAt,
  }),
  (c) => app.dispatchExternal(c),
);
await once(server, "listening");
let browser, page;
const wait = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for live project");
};
const sync = async () => {
  await page.waitForFunction(
    (rev) =>
      document.querySelector(".studio-app")?.dataset.revision === String(rev),
    app.project.document.revision,
  );
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".feedback")
        .textContent.includes("waiting for confirmation"),
  );
};
try {
  await meter.start(METER_UDP_PORT);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ABX_CHROMIUM || undefined,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:" + server.address().port + "/studio");
  await page
    .getByRole("button", { name: "Start Pocket groove", exact: true })
    .click();
  await wait(() => app.project.document.tracks.length === 4);
  await sync();
  assert.equal(engine.running, false);
  console.log("P1: pressing Play in Chromium, preparing owned instruments…");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause", exact: true })
    .waitFor({ timeout: 90000 });
  await sync();
  assert.equal(
    app.projectState().assets.filter((a) => a.status === "missing").length,
    0,
    "starter sounds are installed",
  );
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    peak = Math.max(peak, meter.l + meter.r);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(peak > 0.05, "starter must produce non-silent audio");
  const original = app.project.document.clips[0];
  await page.getByRole("button", { name: "Kick step 2", exact: true }).click();
  await wait(() => app.project.document.clips[0].steps[1] === 1);
  await sync();
  assert.equal(app.runtime.appliedRevision, app.project.document.revision);
  const events = await engine.tidal.eval(
    `print $ queryArc (${compileClip(app.project.document, app.project.document.clips[0])}) (Arc 0 1)`,
    "p1-event-proof",
  );
  assert.match(events.output, /bd/);
  assert.doesNotMatch(events.output, /Exception|error:/);
  await page.getByRole("button", { name: /^Undo:/ }).click();
  await wait(() => app.project.document.clips[0].steps[1] === 0);
  await sync();
  assert.deepEqual(app.project.document.clips[0], original);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await wait(() => app.rig.recording);
  await sync();
  await new Promise((r) => setTimeout(r, 2200));
  await page
    .getByRole("button", { name: "Finish recording", exact: true })
    .click();
  await wait(() => !app.rig.recording);
  await sync();
  const wav = readFileSync(app.rig.recPath);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let pcmPeak = 0,
    dataFound = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4),
      end = offset + 8 + size;
    assert.ok(end <= wav.length, "WAV chunks are finalized");
    if (wav.toString("ascii", offset, offset + 4) === "data") {
      dataFound = true;
      for (let i = offset + 8; i + 1 < end; i += 2)
        pcmPeak = Math.max(pcmPeak, Math.abs(wav.readInt16LE(i)));
    }
    offset = end + (size % 2);
  }
  assert.ok(dataFound);
  assert.ok(
    wav.length > 40000 && pcmPeak > 100,
    "finished UI recording contains audio",
  );
  await page.getByRole("button", { name: "Save jam", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Save as", exact: true })
    .fill("p1-live");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save jam", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const saved = app.project.document;
  await page.getByRole("button", { name: "My Jams", exact: true }).click();
  await page
    .getByRole("button", { name: "Open jam p1-live", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "New empty jam", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start new jam", exact: true })
    .click();
  await wait(() => app.project.document.id !== saved.id);
  await sync();
  await page
    .getByRole("button", { name: "Open jam p1-live", exact: true })
    .click();
  await wait(() => app.project.document.id === saved.id);
  await sync();
  assert.deepEqual(app.project.document.clips, saved.clips);
  assert.deepEqual(app.project.document.tracks, saved.tracks);
  assert.equal(app.rig.stopped, true, "Reopened projects must remain stopped");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await wait(() => !app.rig.stopped);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await wait(() => app.rig.paused);
  await sync();
  await page.screenshot({
    path: fileURLToPath(new URL("../docs/p1-studio-live.png", import.meta.url)),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.equal(engine.state, "ready", engine.error || "");
  console.log(
    `P1 LIVE BROWSER PASS: starter master peak L+R ${peak.toFixed(3)}; rhythm engine acknowledgement + evaluated events; Undo; Save/new/reopen; recording ${wav.length} bytes, PCM peak ${pcmPeak}; Pause; no JS or engine errors.`,
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  meter.stop();
  try {
    engine.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
await assertAudioPortsFree();
console.log("Owned audio ports released.");
