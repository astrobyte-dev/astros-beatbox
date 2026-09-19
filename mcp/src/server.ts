import { instruments, effects } from "./sound-lab.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { connectRuntime } from "./runtime-client.js";
import { editSchema } from "./project.js";
import { randomUUID } from "node:crypto";

let runtime: Awaited<ReturnType<typeof connectRuntime>>;
try { runtime = await connectRuntime(); }
catch (e) { process.stderr.write("Rig startup failed: " + String(e) + "\n"); process.exit(1); }
let observed: { sessionId: string; generation: number };
async function state() { const r = await fetch(runtime.url + "/state", { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw new Error("Runtime unavailable"); const s = await r.json(); observed = { sessionId: s.sessionId, generation: s.generation }; return s; }
await state();
const server = new McpServer({ name: "tidal-livecoder", version: "0.2.0" });
const bridgeId = randomUUID();
async function bridge(connected: boolean) {
  try { await fetch(runtime.url + "/runtime/bridge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: bridgeId, pid: process.pid, sessionId: observed.sessionId, connected }), signal: AbortSignal.timeout(2000) }); }
  catch { /* Connection observation never changes runtime ownership. */ }
}
await bridge(true);
const heartbeat = setInterval(() => { void bridge(true); }, 4000); heartbeat.unref();
if (runtime.reused) process.stderr.write("Beatbox was already running. Studio: " + runtime.url + "/studio\n");
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const retry = {
  operationId: z.string().optional().describe("Reuse with the same command for a retry; requires sessionId and issuedAt."),
  sessionId: z.string().optional().describe("Server session from status."),
  issuedAt: z.number().optional().describe("Original request time in Unix milliseconds; retries expire after five minutes."),
  projectId: z.string().optional().describe("Required for musical operations: project.id from status. Runtime boot/Stop/record/reset may omit it."),
  revision: z.number().int().optional().describe("Required with projectId: expected project.revision from status."),
};
const projectMeta = { ...retry, projectId: z.string(), revision: z.number().int().nonnegative() };
async function execute(command: unknown) {
  const c = command as Record<string, unknown>;
  const request = c.operationId ? c : { ...c, sessionId: c.sessionId ?? observed.sessionId, operationId: randomUUID(), issuedAt: c.issuedAt ?? Date.now() };
  try {
    const response = await fetch(runtime.url + "/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    return { ...text(JSON.stringify(result)), isError: !result.ok };
  } catch (e) {
    return { ...text(JSON.stringify({ ok: false, operationId: request.operationId, sessionId: request.sessionId, generation: observed.generation, code: "UNCONFIRMED", error: "Runtime response unavailable; execution is uncertain. Read status before issuing another action. " + String(e) })), isError: true };
  }
}
server.tool("sound_lab_catalog", "Instrument and effect definitions, normalized safe control ranges (0–1), curated patches and semantic targets. Use project_edit for source.set, synth.parameter, notes.set, fx.put/remove/order, modulation.put/remove and patch.put/load. FX targets are fx.<instanceId>.<parameter>; synth targets are synth.<parameter>.", async () => text(JSON.stringify({ instruments, effects })));
server.tool("project_status", "Canonical authored project, server history, workspace, runtime and asset availability. Does not boot audio.", async () => text(JSON.stringify(await state())));
server.tool("project_edit", "Apply an atomic batch of structured musical edits as one undo intention. Requires current project identity/revision. Visual controls never rewrite arbitrary code.", { ...projectMeta, edits: z.array(editSchema).min(1).max(512), label: z.string().min(1).max(120), groupId: z.string().optional() }, async args => execute({ ...args, cmd: "project.edit" }));
for (const action of ["undo", "redo", "new", "recover"] as const) server.tool("project_" + action, "Project " + action + "; serialized with UI edits and guarded by project revision.", projectMeta, async args => execute({ ...args, cmd: "project." + action }));
for (const action of ["save", "load"] as const) server.tool("project_" + action, action === "save" ? "Save a complete versioned .abx.json session; .tidal exports remain separate." : "Validate and open a complete project before changing the current project.", { ...projectMeta, name: z.string().regex(/^[a-z0-9_-]{1,80}$/i) }, async ({ name, ...args }) => execute({ ...args, cmd: "project." + action, value: name }));
server.tool("scene_launch", "Launch all managed tracks coherently at the next Tidal cycle (or explicitly immediately). Performance state is separate from authored history. Repeat explicitly to retrigger the same scene.", { ...projectMeta, sceneId: z.string(), boundary: z.enum(["immediate", "cycle"]).default("cycle"), repeat: z.boolean().optional() }, async args => execute({ ...args, cmd: "scene.launch" }));
for (const action of ["start", "stop"] as const) server.tool("arrangement_" + action, "Arrangement " + action + "; Tidal owns all advancement. Edit stable entries/repeats/loop through project_edit.", projectMeta, async args => execute({ ...args, cmd: "song." + action }));
server.tool("managed_code_apply", "Prepare and apply a saved code.draft. Failed drafts and previous source remain available. Declare dependencies through project_edit; declarations are never executed automatically.", { ...projectMeta, clipId: z.string() }, async args => execute({ ...args, cmd: "code.apply" }));
server.tool("performance_return", "Explicitly return to the editing project. Externally modified audio is restarted to clear unknown interpreter/SC state; recording finalization must happen first.", projectMeta, async args => execute({ ...args, cmd: "performance.return" }));
server.tool("boot", "Boot or confirm SuperDirt and Tidal. First boot takes about 30-40 seconds.", retry,
  async (meta) => execute({ ...meta, cmd: "boot" }));
server.tool("eval_tidal", "Evaluate Tidal code. An action acknowledgement confirms synchronous evaluation; scheduled music can still fail later. Inspect status for late faults.",
  { ...retry, code: z.string().describe("TidalCycles code; d1..d16, declarations and multi-line/do blocks supported") },
  async ({ code, ...meta }) => execute({ ...meta, cmd: "eval", value: code }));
server.tool("hush", "Silence and clear Tidal patterns. Dashboard Stop instead keeps patterns for Play.", retry,
  async (meta) => execute({ ...meta, cmd: "hush" }));
server.tool("eval_sc", "Evaluate raw SuperCollider code. Acknowledgement covers the expression, not work it schedules for later.",
  { ...retry, code: z.string() }, async ({ code, ...meta }) => execute({ ...meta, cmd: "eval_sc", value: code }));
server.tool("status", "Report the persistent runtime, engine health, recording catalog and canonical project.", async () => text(JSON.stringify(await state())));
let closing: Promise<void> | undefined;
function closeBridge() {
  return closing ??= (async () => { clearInterval(heartbeat); await bridge(false); await runtime.close(); await server.close(); })().catch(e => { closing = undefined; process.stderr.write("Shutdown unconfirmed: " + String(e) + "\n"); process.exitCode = 1; });
}
process.stdin.on("end", () => { void closeBridge(); });
process.on("SIGINT", () => { void closeBridge(); });
process.on("SIGTERM", () => { void closeBridge(); });
if (process.platform === "linux") process.on("SIGHUP", () => { void closeBridge(); });
try { await server.connect(new StdioServerTransport()); }
catch (e) { await closeBridge(); process.stderr.write(String(e) + "\n"); process.exitCode = 1; }
