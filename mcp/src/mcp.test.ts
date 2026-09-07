import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("existing MCP launch exposes shared validation, session IDs and isError failures without booting audio", { timeout: 15000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("server.js", import.meta.url))],
    env: { ...process.env as Record<string, string>, TIDAL_DASH_PORT: "0", TIDAL_METER_PORT: "0" }, stderr: "pipe",
  });
  const client = new Client({ name: "p0a-test", version: "1" });
  try {
    await client.connect(transport);
    const listed = await client.listTools(); assert.deepEqual(listed.tools.map((t) => t.name).filter(n => !n.startsWith("project_") && !n.startsWith("user_audio_") && !n.startsWith("capture_") && !n.startsWith("jam_")).sort(), ["arrangement_start", "arrangement_stop", "boot", "eval_sc", "eval_tidal", "hush", "managed_code_apply", "performance_return", "scene_launch", "sound_lab_catalog", "status"]);
    assert.ok(listed.tools.some(t => t.name === "project_edit"));
    assert.deepEqual(listed.tools.map(t => t.name).filter(n => n.startsWith("jam_")).sort(), ["jam_capture_keep", "jam_capture_start", "jam_capture_stop", "jam_inspect", "jam_keep", "jam_lock", "jam_macro_assign", "jam_macro_value", "jam_macros_reset", "jam_macros_suggest", "jam_promote", "jam_return", "jam_variation", "jam_verb"]);
    assert.deepEqual(listed.tools.map(t => t.name).filter(n => n.startsWith("user_audio_") || n.startsWith("capture_")).sort(), ["capture_controls", "capture_discard", "capture_keep", "capture_prepare", "capture_preview", "capture_start", "capture_status", "capture_stop", "user_audio_add", "user_audio_assign", "user_audio_details", "user_audio_import", "user_audio_library", "user_audio_preview"]);
    const status = await client.callTool({ name: "status", arguments: {} });
    const state = JSON.parse((status.content as { text: string }[])[0].text);
    assert.equal(state.state, "idle"); assert.equal(state.synchronized, true); assert.ok(state.sessionId);
    const result = await client.callTool({ name: "eval_tidal", arguments: { code: " ", operationId: "invalid-op", sessionId: state.sessionId, issuedAt: Date.now() } });
    assert.equal(result.isError, true);
    const failure = JSON.parse((result.content as { text: string }[])[0].text);
    assert.equal(failure.ok, false); assert.equal(failure.code, "VALIDATION"); assert.equal(failure.operationId, "invalid-op");
    const after = await client.callTool({ name: "status", arguments: {} });
    assert.equal(JSON.parse((after.content as { text: string }[])[0].text).state, "idle");
  } finally { await client.close(); }
});

test("real MCP batches and HTTP edits share project revisions, history and persistence", { timeout: 15000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "abx-mcp-project-"));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("server.js", import.meta.url))], env: { ...process.env as Record<string, string>, TIDAL_DASH_PORT: "0", TIDAL_METER_PORT: "0", TIDAL_PROJECTS_DIR: dir, TIDAL_RECOVERY_DIR: path.join(dir, "recovery") }, stderr: "pipe" });
  const client = new Client({ name: "p0b-test", version: "1" });
  const call = async (name: string, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { result: JSON.parse((r.content as { text: string }[])[0].text), isError: r.isError }; };
  try {
    await client.connect(transport); const { result: initial } = await call("status");
    const meta = { projectId: initial.project.id, revision: initial.project.revision };
    const batch = await call("project_edit", { ...meta, label: "MCP intention", edits: [{ type: "project.rename", name: "Complete" }, { type: "tempo.set", bpm: 137, beatsPerCycle: 7 }] });
    assert.equal(batch.isError, false); assert.equal(batch.result.history.undo, 1);
    const stale = await call("project_edit", { ...meta, label: "Stale", edits: [{ type: "project.rename", name: "Wrong" }] }); assert.equal(stale.isError, true); assert.equal(stale.result.code, "STALE_PROJECT");
    const res = await fetch(initial.dashboard + "/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: "project.undo", projectId: meta.projectId, revision: batch.result.revision }) });
    assert.equal(res.status, 200); const undone = await res.json() as { revision: number };
    const { result: current } = await call("project_status"); assert.equal(current.project.name, "Untitled"); assert.equal(current.history.redo, 1);
    const redo = await call("project_redo", { projectId: meta.projectId, revision: undone.revision }); assert.equal(redo.isError, false);
    const saved = await call("project_save", { projectId: meta.projectId, revision: redo.result.revision, name: "roundtrip" }); assert.equal(saved.isError, false);
    const { result: after } = await call("status"); assert.equal(after.state, "idle"); assert.equal(after.project.tempo.beatsPerCycle, 7);
    const changed = await call("project_new", { projectId: after.project.id, revision: after.project.revision }); assert.equal(changed.isError, false);
    const wrongProject = await call("project_undo", { projectId: after.project.id, revision: after.project.revision }); assert.equal(wrongProject.result.code, "STALE_PROJECT");
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});
