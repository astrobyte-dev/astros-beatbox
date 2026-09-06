import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("existing MCP launch exposes shared validation, session IDs and isError failures without booting audio", { timeout: 15000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("server.js", import.meta.url))],
    env: { ...process.env as Record<string, string>, TIDAL_DASH_PORT: "0", TIDAL_METER_PORT: "0" }, stderr: "pipe",
  });
  const client = new Client({ name: "p0a-test", version: "1" });
  try {
    await client.connect(transport);
    const listed = await client.listTools(); assert.deepEqual(listed.tools.map((t) => t.name).sort(), ["boot", "eval_sc", "eval_tidal", "hush", "status"]);
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
