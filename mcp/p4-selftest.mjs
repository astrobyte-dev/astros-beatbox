// Production Studio + real HTTP/MCP/project services. The explicit cycle fixture
// models acknowledgements; it does NOT establish native Tidal or acoustic timing.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Application } from "./dist/application.js";
const dir = mkdtempSync(path.join(tmpdir(), "abx-p4-browser-"));
Object.assign(process.env, {
  TIDAL_PROJECTS_DIR: dir,
  TIDAL_RECOVERY_DIR: path.join(dir, "recovery"),
  TIDAL_RECORDINGS_DIR: path.join(dir, "recordings"),
  TIDAL_METER_PORT: "0",
});
const { startDashboard } = await import("./dist/dashboard.js");
const { runtimeKey, RUNTIME_PROTOCOL } = await import("./dist/runtime.js");
const calls = [];
let cycle = 10.25;
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
      if (code.includes("BROKEN_DRAFT"))
        throw new Error("Fixture compiler rejects BROKEN_DRAFT");
      return {
        operationId,
        acknowledgement: "action",
        output: code.includes("abxInstall")
          ? "ABX_SCHEDULED " +
            (code.includes("abxInstall True") ? Math.floor(cycle) + 1 : cycle)
          : "",
      };
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
  recordings: path.join(dir, "recordings"),
  device: path.join(dir, "device"),
});
const state = () => ({
  ...app.projectState(),
  sessionId: app.sessionId,
  generation: engine.generation,
  status: engine.state,
  error: null,
  slots: app.rig.slots,
  stopped: app.rig.stopped,
  paused: app.rig.paused,
  synchronized: app.rig.synchronized,
  recording: false,
  muted: [...app.rig.muted],
  solo: app.rig.solo,
  devices: [],
  scopes: {},
  hits: {},
});
const server = startDashboard(
  0,
  fileURLToPath(new URL("./dashboard.html", import.meta.url)),
  state,
  () => ({ cycle, cps: 0.5, lead: 0, age: 0 }),
  (c) => app.dispatchExternal(c),
  {
    identity: () => ({
      kind: "astros-beatbox-runtime",
      protocol: RUNTIME_PROTOCOL,
      key: runtimeKey,
      ready: true,
      sessionId: app.sessionId,
      pid: process.pid,
    }),
    bridge: () => ({ ok: true }),
  },
);
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ABX_CHROMIUM || undefined,
});
let page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let mcp;
const connect = async () => {
  const client = new Client({ name: "p4-browser", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("./dist/server.js", import.meta.url))],
      env: { ...process.env, TIDAL_DASH_PORT: String(server.address().port) },
      stderr: "pipe",
    }),
  );
  return client;
};
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args });
  assert.ok(!r.isError, JSON.stringify(r));
  return JSON.parse(r.content[0].text);
};
const meta = () => ({
  projectId: app.project.document.id,
  revision: app.project.document.revision,
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
const click = async (name) => {
  await page.getByRole("button", { name, exact: true }).click();
  await sync();
};
const observe = (at) => {
  cycle = at;
  app.observeCycle(at);
};
try {
  await page.goto(base + "/studio");
  await click("Jam ✳");
  await page.getByRole("region", { name: "Jam playground" }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("../docs/p4-start-1440.png", import.meta.url)),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Start From Groove/ }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await sync();
  assert.equal(app.project.document.tracks.length, 5);
  const kick = app.project.document.tracks.find((t) => t.name === "Kick"),
    bass = app.project.document.tracks.find((t) => t.name === "Bass");
  await click("Keep Kick");
  await click("Keep Bass");
  const p = app.project.document,
    protectedClips = p.clips.filter((c) =>
      [kick.id, bass.id].includes(c.trackId),
    );
  await page.getByRole("slider", { name: "Variation intensity" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("slider", { name: "Variation intensity" })
      .getAttribute("aria-valuetext"),
    "wild",
  );
  const undo = app.project.history.undo;
  await click("Make Variation ↗");
  assert.equal(app.project.history.undo, undo + 1);
  assert.deepEqual(
    app.project.document.clips.filter((c) =>
      [kick.id, bass.id].includes(c.trackId),
    ),
    protectedClips,
  );
  const variant = app.project.document;
  await click("A / B · Compare previous");
  assert.deepEqual(app.project.document.clips, p.clips);
  await click("B · Back to variation");
  assert.deepEqual(app.project.document.clips, variant.clips);
  await page.getByRole("button", { name: /Original/ }).click();
  await sync();
  await click("Make Variation ↗");
  // Keep Bass sound protected while give another track a supported dirt target.
  const hats = app.project.document.tracks.find((t) => t.name === "Hi-hat");
  mcp = await connect();
  const catalog = await call("jam_inspect");
  assert.equal(catalog.capabilities.length, 5);
  assert.ok(catalog.trail.length >= 3);
  await call("project_edit", {
    ...meta(),
    label: "Add hat dirt",
    edits: [
      {
        type: "fx.put",
        trackId: hats.id,
        effect: {
          id: "hats_dirt",
          definitionId: "distortion",
          version: 1,
          values: { drive: 0.2, mix: 0.5 },
          enabled: true,
        },
      },
    ],
  });
  await sync();
  await click("Get Dirtier ↗");
  assert.ok(
    app.project.document.tracks
      .find((t) => t.id === hats.id)
      .effects.find((f) => f.id === "hats_dirt").values.drive > 0.2,
  );
  assert.deepEqual(
    app.project.document.tracks.find((t) => t.id === bass.id),
    p.tracks.find((t) => t.id === bass.id),
  );
  await page.locator(".jam-notebook > details > summary").click();
  await click("Capture performance events");
  const baseFx = structuredClone(
    app.project.document.tracks.find((t) => t.id === hats.id).effects,
  );
  const space = page.getByRole("slider", { name: "Space macro", exact: true });
  await space.focus();
  await page.keyboard.press("ArrowRight");
  await sync();
  assert.equal(
    app.project.document.jam.macros.find((m) => m.name === "Space").value,
    0.01,
  );
  assert.deepEqual(
    app.project.document.tracks.find((t) => t.id === hats.id).effects,
    baseFx,
  );
  // A held gesture cannot rebase across an MCP write.
  await space.focus();
  await page.keyboard.down("ArrowRight");
  await call("project_edit", {
    ...meta(),
    label: "Concurrent title",
    edits: [{ type: "project.rename", name: "Jam excursion" }],
  });
  await sync();
  await page.keyboard.up("ArrowRight");
  await sync();
  await page
    .getByRole("alert")
    .filter({ hasText: "Project changed" })
    .waitFor();
  await page
    .locator(".feedback")
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  assert.equal(
    app.project.document.jam.macros.find((m) => m.name === "Space").value,
    0.01,
  );
  await click("Stop event capture");
  await click("Keep Performance");
  assert.equal(app.project.document.jam.takes[0].events.length, 1);
  await click("Keep This ★");
  assert.ok(app.projectState().jam.trail.some((e) => e.kept));
  await page.getByLabel("Jam scene name").fill("Drop");
  const sceneHistory = app.project.history.undo;
  await click("Save as Scene ↗");
  assert.equal(app.project.history.undo, sceneHistory + 1);
  const drop = app.project.document.scenes.find((s) => s.name === "Drop");
  assert.ok(drop);
  assert.notEqual(drop.clips[hats.id], hats.activeClipId);
  await page
    .locator(".jam-scenes")
    .getByRole("button", { name: "Drop", exact: true })
    .click();
  await sync();
  assert.equal(
    app.project.document.tracks.find((t) => t.id === hats.id).activeClipId,
    drop.clips[hats.id],
  );
  await click("Pin Hi-hat");
  await page.getByRole("button", { name: "Exit Jam ✳", exact: true }).click();
  await page.getByRole("region", { name: "Sound Lab" }).waitFor();
  await click("Jam ✳");
  assert.equal(
    await page
      .getByRole("button", { name: "Pin Hi-hat" })
      .getAttribute("aria-pressed"),
    "true",
  );
  const stale = await mcp.callTool({
    name: "jam_variation",
    arguments: {
      ...meta(),
      revision: 0,
      request: {
        seed: 50,
        intensity: "wild",
        trackIds: [hats.id],
        scopes: ["rhythm"],
        operation: "chaos",
      },
    },
  });
  assert.equal(stale.isError, true);
  await call("jam_variation", {
    ...meta(),
    request: {
      seed: 50,
      intensity: "fresh",
      trackIds: [hats.id],
      scopes: ["rhythm"],
      operation: "variation",
    },
  });
  await sync();
  await call("jam_macro_value", {
    ...meta(),
    macroId: app.project.document.jam.macros.find((m) => m.name === "Space").id,
    value: 0.35,
  });
  await sync();
  assert.equal(
    await page.getByRole("slider", { name: "Space macro" }).inputValue(),
    "0.35",
  );
  await call("jam_verb", { ...meta(), verb: "space", trackIds: [hats.id] });
  await sync();
  await call("jam_promote", { ...meta(), sceneId: "mcp_lift", name: "Lift" });
  await sync();
  assert.ok(app.project.document.scenes.some((s) => s.id === "mcp_lift"));
  await call("project_save", { ...meta(), name: "jam-excursion" });
  const saved = app.project.document,
    trailBeforeReload = app.projectState().jam.trail;
  await mcp.close();
  mcp = null;
  await page.reload();
  await sync();
  await click("Jam ✳");
  assert.deepEqual(app.projectState().jam.trail, trailBeforeReload);
  mcp = await connect();
  await call("project_new", meta());
  await call("project_load", { ...meta(), name: "jam-excursion" });
  await sync();
  assert.deepEqual(
    { ...app.project.document, revision: saved.revision },
    saved,
  );
  assert.equal(app.rig.stopped, true);
  assert.deepEqual(app.projectState().jam.trail, []);
  await click("Continue Current ↗");
  await click("Make Variation ↗");
  await click("Keep This ★");
  await page.locator(".jam-hero h1").click();
  await page.evaluate(() => scrollTo(0, 0));
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: fileURLToPath(
        new URL(`../docs/p4-jam-${width}.png`, import.meta.url),
      ),
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".jam-track")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  assert.deepEqual(errors, []);
  console.log(
    "P4 BROWSER PASS: quick start/play, Keep Kick/Bass, intensity, variation, A/B/return/branch, verbs, macro layers/stale gesture, event capture/Keep, promotion/scenes, bench, enter/exit, real MCP capabilities/variation/verb/macro/promotion/stale safety, client reconnect, save/reopen stopped, three widths/reduced motion. Fixture audio only.",
  );
} finally {
  await mcp?.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
