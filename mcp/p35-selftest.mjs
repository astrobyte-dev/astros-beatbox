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
const dir = mkdtempSync(path.join(tmpdir(), "abx-p35-browser-"));
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
  const client = new Client({ name: "p35-browser", version: "1" });
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
  await click("Synths");
  await page
    .locator(".instrument-card")
    .filter({ hasText: "Dirty Mono" })
    .click();
  await sync();
  assert.equal(app.project.document.tracks[0].source.type, "synth");
  await click("Play");
  const lab = page.getByRole("region", { name: "Sound Lab" });
  const tab = async (name) => {
    await page
      .locator(".lab-tabs button")
      .filter({ hasText: new RegExp("^" + name) })
      .click();
  };
  const cutoff = page.getByRole("slider", { name: "Cutoff", exact: true });
  const history = app.project.history.undo;
  await cutoff.focus();
  await page.keyboard.press("ArrowUp");
  await sync();
  assert.equal(app.project.history.undo, history + 1);
  const start = app.project.history.undo,
    box = await cutoff.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 35, {
    steps: 10,
  });
  await page.mouse.up();
  await sync();
  assert.equal(app.project.history.undo, start + 1);
  await page
    .getByLabel("Instrument patch", { exact: true })
    .selectOption("dirtymono_1");
  await sync();
  assert.equal(app.project.document.tracks[0].source.values.drive, 0.65);
  await page
    .getByRole("button", { name: "Advanced controls", exact: true })
    .click();
  await page.getByRole("slider", { name: "Attack", exact: true }).waitFor();
  await tab("Notes");
  await page
    .getByLabel("Note sequence", { exact: true })
    .fill("36 36 43 43 39 39 48 36");
  await page.getByLabel("Note sequence", { exact: true }).press("Enter");
  await sync();
  await tab("FX");
  await click("+ Add effect");
  await page.getByLabel("Effect to add").selectOption("reverb");
  await click("+ Add effect");
  assert.deepEqual(
    app.project.document.tracks[0].effects.map((f) => f.definitionId),
    ["distortion", "reverb"],
  );
  await click("Move effect 2 earlier");
  assert.deepEqual(
    app.project.document.tracks[0].effects.map((f) => f.definitionId),
    ["reverb", "distortion"],
  );
  await page.getByRole("button", { name: /^Undo:/ }).click();
  await sync();
  await page
    .getByRole("switch", { name: "Distortion enabled", exact: true })
    .click();
  await sync();
  assert.equal(app.project.document.tracks[0].effects[0].enabled, false);
  await page
    .getByRole("switch", { name: "Distortion enabled", exact: true })
    .click();
  await sync();
  await tab("Motion");
  await page.getByLabel("Modulation destination").selectOption("synth.cutoff");
  await click("+ Add motion");
  assert.equal(
    app.project.document.tracks[0].modulation[0].target,
    "synth.cutoff",
  );
  await page.getByRole("button", { name: /^Undo:/ }).click();
  await sync();
  assert.equal(app.project.document.tracks[0].modulation.length, 0);
  await page.getByRole("button", { name: /^Redo:/ }).click();
  await sync();
  await page.locator(".lab-motion .inspector-details > summary").click();
  await page
    .locator(".lab-motion")
    .getByLabel("Motion control")
    .selectOption("synth.cutoff");
  await page
    .locator(".lab-motion")
    .getByRole("button", { name: "Swell", exact: true })
    .click();
  await sync();
  assert.equal(app.project.document.automation[0].parameter, "synth.cutoff");
  assert.equal(app.project.document.tracks[0].modulation.length, 1);
  await tab("Instrument");
  assert.ok(
    await cutoff
      .getAttribute("aria-valuetext")
      .then((t) => t.includes("modulated")),
  );
  await page.locator(".lab-instrument .patch-controls summary").click();
  await page.getByLabel("Patch name", { exact: true }).fill("My warehouse");
  await click("Save instrument patch");
  assert.equal(app.project.document.patches[0].name, "My warehouse");
  mcp = await connect();
  const catalog = await call("sound_lab_catalog");
  assert.equal(catalog.instruments.length, 5);
  assert.equal(catalog.effects.length, 8);
  const track = app.project.document.tracks[0],
    firstScene = app.project.document.scenes[0];
  await call("project_edit", {
    ...meta(),
    label: "MCP shape",
    edits: [
      {
        type: "synth.parameter",
        trackId: track.id,
        parameter: "drive",
        value: 0.78,
      },
    ],
  });
  await sync();
  assert.equal(
    await page
      .getByRole("slider", { name: "Drive", exact: true })
      .getAttribute("aria-valuenow"),
    "78",
  );
  const stale = await mcp.callTool({
    name: "project_edit",
    arguments: {
      ...meta(),
      revision: 0,
      label: "Stale",
      edits: [
        {
          type: "synth.parameter",
          trackId: track.id,
          parameter: "drive",
          value: 0.1,
        },
      ],
    },
  });
  assert.equal(stale.isError, true);
  // Author an insert lane through the same Motion editor and semantic MCP API.
  const fxId = app.project.document.tracks[0].effects[0].id;
  const fxTarget = `fx.${fxId}.drive`;
  await tab("Motion");
  await page.getByLabel("Modulation destination").selectOption(fxTarget);
  await click("+ Add motion");
  const details = page.locator(".lab-motion .inspector-details");
  if (!(await details.getAttribute("open"))) await details.locator(":scope > summary").click();
  await page.locator(".lab-motion").getByLabel("Motion control").selectOption(fxTarget);
  await page.locator(".lab-motion").getByRole("button", { name: "Rise", exact: true }).click();
  await sync();
  const fxLane = app.project.document.automation.find(a => a.parameter === fxTarget);
  assert.ok(fxLane);
  await tab("FX");
  const fxKnob = page.getByRole("slider", { name: "Distortion Drive", exact: true });
  assert.match(await fxKnob.getAttribute("aria-valuetext"), /modulated.*automated/);
  await fxKnob.focus(); await page.keyboard.press("ArrowUp"); await sync();
  assert.deepEqual(app.project.document.automation.find(a => a.id === fxLane.id), fxLane);
  await click("Move effect 2 earlier");
  assert.deepEqual(app.project.document.automation.find(a => a.id === fxLane.id), fxLane);
  await click("Remove effect 2");
  assert.ok(!app.project.document.automation.some(a => a.id === fxLane.id));
  assert.ok(!app.project.document.tracks[0].modulation.some(m => m.target === fxTarget));
  await page.getByRole("button", { name: /^Undo:/ }).click(); await sync();
  assert.deepEqual(app.project.document.automation.find(a => a.id === fxLane.id), fxLane);
  await page.getByRole("button", { name: /^Redo:/ }).click(); await sync();
  assert.ok(!app.project.document.automation.some(a => a.id === fxLane.id));
  await page.getByRole("button", { name: /^Undo:/ }).click(); await sync();
  const fxEdit = async (edits, label = "MCP FX layers") => { await call("project_edit", { ...meta(), label, edits }); await sync(); };
  await fxEdit([{ type: "automation.put", automation: { ...fxLane, enabled: false } }]);
  assert.match(await fxKnob.getAttribute("aria-valuetext"), /modulated/);
  assert.doesNotMatch(await fxKnob.getAttribute("aria-valuetext"), /automated/);
  const fxMod = app.project.document.tracks[0].modulation.find(m => m.target === fxTarget);
  await fxEdit([{ type: "automation.put", automation: fxLane }, { type: "modulation.put", trackId: track.id, route: { ...fxMod, enabled: false } }]);
  assert.match(await fxKnob.getAttribute("aria-valuetext"), /automated/);
  assert.doesNotMatch(await fxKnob.getAttribute("aria-valuetext"), /modulated/);
  await fxEdit([{ type: "modulation.put", trackId: track.id, route: fxMod }]);
  const rejectedRevision = app.project.document.revision;
  for (const args of [
    { ...meta(), revision: rejectedRevision - 1, label: "Stale FX", edits: [{ type: "automation.put", automation: { ...fxLane, values: [0.1, 0.9] } }] },
    { ...meta(), label: "Unsupported FX", edits: [{ type: "automation.put", automation: { ...fxLane, parameter: `fx.${fxId}.time` } }] },
  ]) assert.equal((await mcp.callTool({ name: "project_edit", arguments: args })).isError, true);
  assert.equal(app.project.document.revision, rejectedRevision);
  await click("Duplicate scene");
  const copied = app.project.document.tracks[0].activeClipId;
  assert.notEqual(copied, track.activeClipId);
  const copiedFxLane = app.project.document.automation.find(a => a.parameter === fxTarget && a.clipId === copied);
  assert.ok(copiedFxLane); assert.notEqual(copiedFxLane.id, fxLane.id);
  await fxEdit([{ type: "automation.put", automation: { ...copiedFxLane, values: [0.3, 0.6] } }]);
  assert.deepEqual(app.project.document.automation.find(a => a.id === fxLane.id), fxLane);
  await tab("Notes");
  await page.getByLabel("Note sequence").fill("48 48 55 55 51 51 60 48");
  await page.getByLabel("Note sequence").press("Enter");
  await sync();
  assert.equal(
    app.project.document.clips.find((c) => c.id === track.activeClipId)
      .notes[0],
    36,
  );
  await call("scene_launch", {
    ...meta(),
    sceneId: firstScene.id,
    boundary: "immediate",
  });
  assert.ok(
    calls.some((c) => c.includes("abxInstall") && c.includes("abx_dirtymono")),
  );
  await call("arrangement_stop", meta());
  await call("project_save", { ...meta(), name: "sound-lab" });
  const saved = app.project.document;
  await call("project_new", meta());
  await call("project_load", { ...meta(), name: "sound-lab" });
  await sync();
  assert.deepEqual(
    { ...app.project.document, revision: saved.revision },
    saved,
  );
  assert.equal(app.rig.stopped, true);
  await page.reload();
  await sync();
  await tab("Instrument");
  // A held gesture remains tied to its starting revision through an MCP edit.
  const held = page.getByRole("slider", { name: "Cutoff", exact: true });
  await held.focus();
  await page.keyboard.down("ArrowUp");
  await call("project_edit", {
    ...meta(),
    label: "Concurrent rename",
    edits: [
      { type: "track.rename", trackId: track.id, name: "Warehouse bass" },
    ],
  });
  await sync();
  await page.keyboard.up("ArrowUp");
  await sync();
  await page
    .getByRole("alert")
    .filter({ hasText: "Project changed" })
    .waitFor();
  await click("Dismiss");
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.locator(".sound-lab").scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: fileURLToPath(
        new URL("../docs/p35-instrument-" + width + ".png", import.meta.url),
      ),
      fullPage: true,
    });
  }
  await tab("FX");
  await page.screenshot({
    path: fileURLToPath(new URL("../docs/p35-fx-1920.png", import.meta.url)),
    fullPage: true,
  });
  await tab("Motion");
  await page.screenshot({
    path: fileURLToPath(
      new URL("../docs/p35-motion-1920.png", import.meta.url),
    ),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "P3.5A BROWSER PASS: synth collection, Play, grouped pointer/keyboard knobs, patch load/save, notes, ordered FX/bypass/undo, modulation/automation coexistence, FX semantic lanes/base edits/reorder/removal/Undo/Redo/independent disables, real MCP catalogue/edit/stale/unsupported rejection, independent scene notes, scene launch, save/new/reopen/reload, stale held gesture, three widths. Deterministic audio only.",
  );
} finally {
  await mcp?.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
