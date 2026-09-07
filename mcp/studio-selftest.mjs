// Real Chromium against the production HTTP bundle and actual P0b services.
// Fake audio isolates UI tests; the opt-in live selftests verify physical audio.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { Application } from "./dist/application.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const dir = mkdtempSync(path.join(tmpdir(), "abx-studio-browser-"));
process.env.TIDAL_PROJECTS_DIR = dir;
const { startDashboard } = await import("./dist/dashboard.js");
const calls = [];
const engine = {
  generation: 0,
  running: false,
  state: "idle",
  error: null,
  async ensureBooted() {
    this.running = true;
    this.state = "ready";
  },
  async reboot() {
    this.generation++;
    await this.ensureBooted();
  },
  assertGeneration(g) {
    assert.equal(g, this.generation);
  },
  tidal: {
    async eval(code, operationId) {
      calls.push(code);
      return { operationId, acknowledgement: "action", output: "" };
    },
    async hush(id) {
      return this.eval("hush", id);
    },
  },
  sclang: {
    async eval(code, operationId) {
      calls.push(code);
      return { operationId, acknowledgement: "action", output: "" };
    },
    async evalRoutine(code, id) {
      return this.eval(code, id);
    },
  },
};
const app = new Application(engine, {
  sets: dir,
  projects: dir,
  recovery: path.join(dir, "recovery"),
  recordings: dir,
  device: path.join(dir, "device"),
});
let telemetry = 0;
const state = () => ({
  status: engine.state,
  error: engine.error,
  sessionId: app.sessionId,
  generation: engine.generation,
  ...app.projectState(),
  slots: app.rig.slots,
  paused: app.rig.paused,
  stopped: app.rig.stopped,
  synchronized: app.rig.synchronized,
  muted: [...app.rig.muted],
  solo: app.rig.solo,
  tempoBpm: app.rig.tempoBpm,
  recording: false,
  devices: [],
  scopes: {},
  hits: {},
  meterL: (++telemetry % 10) / 10,
});
const server = startDashboard(
  0,
  fileURLToPath(new URL("./dashboard.html", import.meta.url)),
  state,
  () => ({ cycle: (Date.now() / 1000) * 0.45, cps: 0.45, lead: 0, age: 0 }),
  (c) => app.dispatchExternal(c),
);
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ABX_CHROMIUM || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("409 (Conflict)"))
    errors.push(m.text());
});
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
        ?.textContent.includes("waiting for confirmation"),
  );
};
const wait = async (fn) => {
  for (let i = 0; i < 160; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for canonical project");
};
const edit = async (edits) => {
  const p = app.project.document;
  const result = await app.dispatchExternal({
    cmd: "project.edit",
    projectId: p.id,
    revision: p.revision,
    edits,
    label: "External edit",
  });
  assert.equal(result.ok, true);
};
const shot = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: fileURLToPath(new URL("../docs/" + name, import.meta.url)),
    fullPage: true,
  });
};
let mcp;
try {
  await page.goto(base + "/studio");
  await page.getByRole("heading", { name: "Play with sound." }).waitFor();
  await shot("p1-studio-empty.png");
  await page
    .getByRole("button", { name: "Start Pocket groove", exact: true })
    .click();
  await wait(() => app.project.document.tracks.length === 4);
  await sync();
  assert.equal(engine.running, false, "starter does not boot or play");
  assert.equal(app.project.history.undo, 1);
  const kick = app.project.document.tracks[0],
    snare = app.project.document.tracks[1],
    clipId = kick.activeClipId;
  const clip = () => app.project.document.clips.find((c) => c.id === clipId);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await sync();
  assert.ok(calls.some((c) => c.startsWith("d1 $ ") && c.includes("bd")));
  const pad = (n) =>
    page.getByRole("button", { name: "Kick step " + n, exact: true });
  await pad(2).focus();
  await page.keyboard.press("Space");
  await wait(() => clip().steps[1] === 1);
  await sync();
  assert.equal(await pad(2).getAttribute("aria-pressed"), "true");
  assert.equal(
    await pad(2).evaluate((el) => el === document.activeElement),
    true,
    "pad focus survives acknowledgement",
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await pad(3).evaluate((el) => el === document.activeElement),
    true,
  );
  await page
    .getByRole("slider", { name: "Step 3 velocity", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await wait(() => clip().steps[2] === 0.05);
  await sync();
  await page.getByRole("button", { name: /^Undo:/ }).click();
  await wait(() => clip().steps[2] === 0);
  await sync();
  await page.getByRole("button", { name: /^Redo:/ }).click();
  await wait(() => clip().steps[2] === 0.05);
  await sync();
  const undoBefore = app.project.history.undo;
  const a = await pad(10).boundingBox(),
    b = await pad(12).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
  await page.mouse.up();
  await wait(() => clip().steps[11] === 1);
  await sync();
  assert.equal(
    app.project.history.undo,
    undoBefore + 1,
    "painting groups one intention",
  );
  assert.equal(clip().steps[10], 1);
  await page.keyboard.press("Control+z");
  await wait(() => clip().steps[11] === 0);
  await sync();
  await page.getByRole("button", { name: "Select Snare", exact: true }).click();
  await edit([{ type: "tempo.set", bpm: 109, beatsPerCycle: 4 }]);
  await sync();
  assert.equal(
    await page
      .getByRole("button", { name: "Select Snare", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await page.getByRole("slider", { name: "Kick level", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await wait(() => app.project.document.tracks[0].mixer.level === 0.84);
  await sync();
  assert.equal(clip().steps[1], 1, "channel level preserves velocity");
  await page.getByRole("button", { name: /^Instruments/ }).click();
  await page.getByRole("button", { name: "Select Kick", exact: true }).click();
  await page.getByText("Peek at the code", { exact: false }).click();
  assert.match(
    await page.getByLabel("Kick Tidal code").textContent(),
    /orbit 0/,
  );
  await page.getByText("Peek at the code", { exact: false }).click();
  await shot("p1-studio-1440.png");
  for (const [width, height] of [
    [1280, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "no page horizontal overflow",
    );
    await shot(`p1-studio-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Neither SSE clock events nor meter polling may mutate rhythm DOM.
  await page.evaluate(() => {
    globalThis.padMutations = 0;
    globalThis.padObserver = new MutationObserver((records) => {
      globalThis.padMutations += records.length;
    });
    globalThis.padObserver.observe(document.querySelector(".tracks"), {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  });
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal(await page.evaluate(() => globalThis.padMutations), 0);
  await page.evaluate(() => globalThis.padObserver.disconnect());
  // Stale pointer painting must fail even after the new revision is displayed.
  const c = await pad(16).boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await edit([{ type: "project.rename", name: "External name" }]);
  await sync();
  await page.mouse.up();
  await page
    .getByRole("alert")
    .filter({ hasText: "Project changed" })
    .waitFor();
  assert.equal(clip().steps[15], 0);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  // Legacy and studio are two clients of the same service, in both directions.
  const legacy = await browser.newPage();
  await legacy.goto(base + "/#steps");
  await legacy.locator(".pad").first().waitFor();
  await legacy.locator(`.pad[data-track="${kick.id}"][data-step="14"]`).click();
  await wait(() => clip().steps[14] === 1);
  await sync();
  assert.equal(await pad(15).getAttribute("aria-pressed"), "true");
  await pad(14).click();
  await wait(() => clip().steps[13] === 1);
  await sync();
  await legacy.waitForFunction(
    (rev) => window.Abx.state().project.revision === rev,
    app.project.document.revision,
  );
  assert.equal(
    await legacy
      .locator(`.pad[data-track="${kick.id}"][data-step="13"]`)
      .evaluate((el) => el.classList.contains("on")),
    true,
  );
  await legacy.close();
  await page.getByRole("button", { name: "Save jam", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Save as", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page
    .getByRole("textbox", { name: "Save as", exact: true })
    .fill("studio-proof");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save jam", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("button", { name: "Save jam", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
    "modal returns focus",
  );
  const saved = app.project.document;
  await page.getByRole("button", { name: "My Jams", exact: true }).click();
  await page
    .getByRole("button", { name: "Open jam studio-proof", exact: true })
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
    .getByRole("button", { name: "Open jam studio-proof", exact: true })
    .click();
  await wait(() => app.project.document.id === saved.id);
  await sync();
  assert.deepEqual(app.project.document.clips, saved.clips);
  assert.deepEqual(app.project.document.tracks, saved.tracks);
  await page.reload();
  await pad(15).waitFor();
  assert.equal(await pad(15).getAttribute("aria-pressed"), "true");
  assert.equal(app.rig.stopped, true, "P3 complete projects reopen stopped");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await wait(() => !app.rig.paused);
  await sync();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await wait(() => app.rig.paused);
  await sync();
  assert.equal(
    await page
      .locator(".clock-strip > div")
      .evaluate((el) => getComputedStyle(el).opacity),
    "0",
    "Pause clears the imperative playhead",
  );
  // A held slider retains the revision at gesture start, just like painting.
  const swing = page.getByRole("slider", { name: "Swing", exact: true });
  await swing.focus();
  await page.keyboard.down("ArrowRight");
  await edit([{ type: "project.rename", name: "While adjusting swing" }]);
  await sync();
  await page.keyboard.up("ArrowRight");
  await page
    .getByRole("alert")
    .filter({ hasText: "Project changed" })
    .waitFor();
  assert.equal(clip().swing, 0.08);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  // Opaque external code never gains a pretend visual rhythm editor.
  await edit([
    {
      type: "clip.put",
      clip: {
        id: "external-code",
        trackId: kick.id,
        name: "Custom",
        kind: "code",
        source: 's "bd*3"',
        managed: true,
        dependencyIds: [],
      },
    },
    { type: "clip.activate", trackId: kick.id, clipId: "external-code" },
  ]);
  await sync();
  assert.equal(await pad(1).count(), 0);
  await page
    .getByText("Its original code is preserved.", { exact: false })
    .waitFor();
  assert.equal(
    await page.getByRole("slider", { name: "Swing", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Select Snare", exact: true }).click();
  await edit([{ type: "track.delete", trackId: snare.id }]);
  await sync();
  assert.equal(
    await page
      .getByRole("heading", { name: "Play with sound." })
      .evaluate((el) => el === document.activeElement),
    true,
    "external deletion gives focus a stable destination",
  );
  // Real MCP stdio server + studio. No fake adapter is substituted for these calls.
  mcp = new Client({ name: "p1-browser", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./dist/server.js", import.meta.url))],
    env: {
      ...process.env,
      TIDAL_DASH_PORT: "0",
      TIDAL_METER_PORT: "0",
      TIDAL_PROJECTS_DIR: path.join(dir, "mcp-projects"),
      TIDAL_RECOVERY_DIR: path.join(dir, "mcp-recovery"),
    },
    stderr: "pipe",
  });
  await mcp.connect(transport);
  const call = async (name, args = {}) => {
    const r = await mcp.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse(r.content[0].text);
  };
  const initial = await call("status");
  await page.goto(initial.dashboard + "/studio");
  await page
    .getByRole("button", { name: "Start Pocket groove", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Kick step 1", exact: true })
    .waitFor();
  const fromStudio = await call("project_status");
  assert.equal(fromStudio.project.tracks.length, 4);
  const result = await call("project_edit", {
    projectId: fromStudio.project.id,
    revision: fromStudio.project.revision,
    label: "MCP rename",
    edits: [
      {
        type: "track.rename",
        trackId: fromStudio.project.tracks[0].id,
        name: "MCP Kick",
      },
    ],
  });
  await page
    .getByRole("button", { name: "Select MCP Kick", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^Undo:/ }).click();
  await page
    .getByRole("button", { name: "Select Kick", exact: true })
    .waitFor();
  const undone = await call("project_status");
  assert.equal(undone.project.tracks[0].name, "Kick");
  assert.ok(undone.project.revision > result.revision);
  assert.deepEqual(errors, []);
  console.log(
    "STUDIO BROWSER PASS: starter, Play, canonical keyboard/pointer rhythm, grouped history, velocity, focus, mixer, code projection, selection, stale gesture, save/new/reopen/reload, legacy bidirectional sync, real MCP bidirectional sync, telemetry isolation, 1280/1440/1920 layouts, no JS/CSP errors.",
  );
} catch (e) {
  await shot("p1-studio-failure.png");
  console.error("Studio browser errors:", errors);
  throw e;
} finally {
  await mcp?.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
}
