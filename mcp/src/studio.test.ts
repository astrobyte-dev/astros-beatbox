import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyProject, applyEdits } from "./project.js";
import { pocketGroove } from "./studio-starter.js";
import { StudioClient, type StudioState } from "./studio-client.js";
import { Application, type CommandEngine } from "./application.js";
import { projectSlots } from "./project-compiler.js";
import { startDashboard } from "./dashboard.js";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-studio-"));
  const calls: string[] = [];
  const evalCode = async (code: string, operationId = "test") => {
    calls.push(code);
    return { operationId, acknowledgement: "action" as const, output: "" };
  };
  const engine: CommandEngine = {
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
    tidal: { eval: evalCode, hush: (id) => evalCode("hush", id) },
    sclang: { eval: evalCode, evalRoutine: evalCode },
  };
  const app = new Application(engine, {
    sets: dir,
    projects: dir,
    recovery: path.join(dir, "recovery"),
    recordings: dir,
    device: path.join(dir, "device"),
  });
  const snapshot = () =>
    ({
      ...app.projectState(),
      sessionId: app.sessionId,
      generation: engine.generation,
      status: engine.state,
      error: null,
      paused: app.rig.paused,
      stopped: app.rig.stopped,
      synchronized: app.rig.synchronized,
      recording: false,
      slots: app.rig.slots,
    }) as StudioState;
  const request: typeof fetch = async (url, options) =>
    new Response(
      JSON.stringify(
        url === "/state"
          ? snapshot()
          : await app.dispatchExternal(JSON.parse(String(options?.body))),
      ),
      { status: 200 },
    );
  return {
    dir,
    app,
    calls,
    engine,
    snapshot,
    request,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("studio starter is one valid managed intention and never replaces existing music", () => {
  const p = emptyProject(),
    edits = pocketGroove(p),
    next = applyEdits(p, edits);
  assert.equal(p.tracks.length, 0);
  assert.equal(next.tracks.length, 4);
  assert.deepEqual(
    next.tracks.map((t) => t.name),
    ["Kick", "Snare", "Hi-hat", "Clap"],
  );
  assert.deepEqual(
    next.tracks.map((t) => t.channel),
    [0, 1, 2, 3],
  );
  assert.equal(Object.keys(next.scenes[0].clips).length, 4);
  assert.match(projectSlots(next).d1, /orbit 0/);
  assert.throws(() => pocketGroove(next), /empty project/);
});

test("studio renders only server snapshots; telemetry does not notify the sequencer subscription", async () => {
  const f = fixture();
  try {
    let meter = 0;
    const client = new StudioClient(
      async () =>
        new Response(
          JSON.stringify({
            ...f.snapshot(),
            meterL: ++meter,
            scopes: { d1: { wave: [meter] } },
            hits: { d1: meter },
          }),
        ),
    );
    let renders = 0;
    client.subscribe(() => renders++);
    await client.refresh();
    const project = client.getSnapshot()!.project;
    for (let i = 0; i < 100; i++) await client.refresh();
    assert.equal(renders, 1);
    assert.equal(client.getSnapshot()!.project, project);
    const p = f.app.project.document;
    await f.app.dispatchExternal({
      cmd: "project.edit",
      projectId: p.id,
      revision: p.revision,
      edits: pocketGroove(p),
      label: "MCP starter",
    });
    await client.refresh();
    assert.equal(renders, 2);
    assert.equal(client.getSnapshot()!.project.tracks.length, 4);
  } finally {
    f.close();
  }
});

test("studio canonical rhythm, acknowledged engine projection, shared undo/redo and complete save/reopen", async () => {
  const f = fixture(),
    client = new StudioClient(f.request);
  try {
    await client.refresh();
    await client.edit(
      pocketGroove(client.getSnapshot()!.project),
      "Start groove",
    );
    assert.equal(f.app.project.history.undo, 1);
    assert.equal(f.engine.running, false);
    assert.equal(await client.command({ cmd: "resume" }, "Play"), true);
    assert.ok(f.calls.some((c) => c.startsWith("d1 $ ") && c.includes("bd")));
    const clip = f.app.project.document.clips[0];
    assert.equal(clip.kind, "steps");
    if (clip.kind !== "steps") return;
    const steps = [...clip.steps];
    steps[1] = 0.45;
    await client.edit(
      [{ type: "steps.set", clipId: clip.id, steps }],
      "Kick step",
    );
    assert.equal(f.app.runtime.appliedRevision, client.base().revision);
    assert.match(f.calls.at(-1)!, /0.45/);
    await client.command({ cmd: "project.undo" }, "Undo");
    assert.deepEqual(f.app.project.document.clips[0], clip);
    await client.command({ cmd: "project.redo" }, "Redo");
    const saved = f.app.project.document;
    await client.command(
      { cmd: "project.save", value: "studio-proof" },
      "Save jam",
    );
    await client.command({ cmd: "project.new" }, "New jam");
    await client.command(
      { cmd: "project.load", value: "studio-proof" },
      "Open jam",
    );
    assert.equal(client.getSnapshot()!.project.id, saved.id);
    assert.deepEqual(f.app.project.document.clips, saved.clips);
    assert.deepEqual(f.app.project.document.tracks, saved.tracks);
    assert.ok(f.app.project.document.revision > saved.revision);
  } finally {
    f.close();
  }
});

test("studio rejects stale gestures after legacy/MCP updates and reopening, without optimistic authority", async () => {
  const f = fixture(),
    client = new StudioClient(f.request);
  try {
    await client.refresh();
    const base = client.base();
    const result = await f.app.dispatchExternal({
      cmd: "project.edit",
      projectId: base.id,
      revision: base.revision,
      edits: [{ type: "project.rename", name: "External" }],
      label: "External name",
    });
    assert.equal(result.ok, true);
    assert.equal(
      await client.edit(
        [{ type: "project.rename", name: "Stale" }],
        "Rename",
        base,
      ),
      false,
    );
    assert.equal(client.getSnapshot()!.project.name, "External");
    assert.match(client.getStatus().error!, /Project changed/);
    await client.command(
      { cmd: "project.save", value: "same-project" },
      "Save jam",
    );
    const savedBase = client.base();
    await client.command(
      { cmd: "project.load", value: "same-project" },
      "Open jam",
    );
    assert.equal(
      await client.edit(
        [{ type: "project.rename", name: "Stale again" }],
        "Rename",
        savedBase,
      ),
      false,
    );
    assert.equal(f.app.project.document.name, "External");
  } finally {
    f.close();
  }
});

test("studio ignores superseded HTTP snapshots and does not retry an uncertain command", async () => {
  const f = fixture();
  try {
    const pending: ((r: Response) => void)[] = [];
    const client = new StudioClient(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const first = client.refresh(),
      second = client.refresh();
    const newest = f.snapshot();
    newest.project.name = "Newer";
    newest.project.revision = 5;
    pending[1](new Response(JSON.stringify(newest)));
    await second;
    pending[0](new Response(JSON.stringify(f.snapshot())));
    await first;
    assert.equal(client.getSnapshot()!.project.name, "Newer");
    let writes = 0;
    const uncertain = new StudioClient(async (url) => {
      if (url === "/state") return new Response(JSON.stringify(f.snapshot()));
      writes++;
      throw new Error("Connection lost");
    });
    await uncertain.refresh();
    assert.equal(
      await uncertain.command({ cmd: "project.new" }, "New jam"),
      false,
    );
    assert.equal(writes, 1);
    assert.match(uncertain.getStatus().error!, /Connection lost/);
    assert.equal(
      uncertain.getSnapshot()!.project.id,
      f.app.project.document.id,
    );
  } finally {
    f.close();
  }
});

test("studio production files and legacy coexist with CSP, strict asset paths and missing asset errors", async () => {
  const server = startDashboard(
    0,
    fileURLToPath(new URL("../dashboard.html", import.meta.url)),
    () => ({}),
    () => ({}),
    async () => {
      throw new Error("not used");
    },
  );
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    for (const route of ["/studio", "/studio/"]) {
      const r = await fetch(base + route);
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.match(html, /Astro/);
      assert.match(
        r.headers.get("content-security-policy")!,
        /default-src 'self'/,
      );
      const asset = /src="([^"]+\.js)"/.exec(html)![1];
      const js = await fetch(base + asset);
      assert.equal(js.status, 200);
      assert.match(js.headers.get("content-type")!, /javascript/);
    }
    assert.equal((await fetch(base + "/")).status, 200);
    assert.equal((await fetch(base + "/dashboard.js")).status, 200);
    for (const route of [
      "/studio/assets/missing.js",
      "/studio/assets/%2e%2e%2fpackage.json",
      "/studio/src/main.tsx",
      "/studio/assets/index.js.map",
    ])
      assert.equal((await fetch(base + route)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
