import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { once } from "node:events";
import { Engine } from "./engine.js";
import { Application } from "./application.js";
import { Meter } from "./meter.js";
import { startDashboard } from "./dashboard.js";
import { DASHBOARD_PORT, METER_UDP_PORT, DASHBOARD_HTML, SETS_DIR, RECORDINGS_DIR, AUDIO_DEVICE_FILE, SCOPE_ENABLED, PROJECTS_DIR, RECOVERY_DIR, DIRT_SAMPLES_DIR } from "./config.js";
import { editSchema } from "./project.js";

const engine = new Engine();
const meter = new Meter();
const app = new Application(engine, { sets: SETS_DIR, recordings: RECORDINGS_DIR, device: AUDIO_DEVICE_FILE, projects: PROJECTS_DIR, recovery: RECOVERY_DIR, samples: DIRT_SAMPLES_DIR });
const rig = app.rig;
const server = new McpServer({ name: "tidal-livecoder", version: "0.2.0" });
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
  const result = await app.dispatchExternal(command);
  return { ...text(JSON.stringify(result)), isError: !result.ok };
}
server.tool("project_status", "Canonical authored project, server history, workspace, runtime and asset availability. Does not boot audio.", async () => text(JSON.stringify({ sessionId: app.sessionId, generation: engine.generation, ...app.projectState(), files: app.project.storage?.list() ?? [] })));
server.tool("project_edit", "Apply an atomic batch of structured musical edits as one undo intention. Requires current project identity/revision. Visual controls never rewrite arbitrary code.", { ...projectMeta, edits: z.array(editSchema).min(1).max(512), label: z.string().min(1).max(120), groupId: z.string().optional() }, async args => execute({ ...args, cmd: "project.edit" }));
for (const action of ["undo", "redo", "new", "recover"] as const) server.tool("project_" + action, "Project " + action + "; serialized with UI edits and guarded by project revision.", projectMeta, async args => execute({ ...args, cmd: "project." + action }));
for (const action of ["save", "load"] as const) server.tool("project_" + action, action === "save" ? "Save a complete versioned .abx.json session; .tidal exports remain separate." : "Validate and open a complete project before changing the current project.", { ...projectMeta, name: z.string().regex(/^[a-z0-9_-]{1,80}$/i) }, async ({ name, ...args }) => execute({ ...args, cmd: "project." + action, value: name }));
server.tool("boot", "Boot or confirm SuperDirt and Tidal. First boot takes about 30-40 seconds.", retry,
  async (meta) => execute({ ...meta, cmd: "boot" }));
server.tool("eval_tidal", "Evaluate Tidal code. An action acknowledgement confirms synchronous evaluation; scheduled music can still fail later. Inspect status for late faults.",
  { ...retry, code: z.string().describe("TidalCycles code; d1..d16, declarations and multi-line/do blocks supported") },
  async ({ code, ...meta }) => execute({ ...meta, cmd: "eval", value: code }));
server.tool("hush", "Silence and clear Tidal patterns. Dashboard Stop instead keeps patterns for Play.", retry,
  async (meta) => execute({ ...meta, cmd: "hush" }));
server.tool("eval_sc", "Evaluate raw SuperCollider code. Acknowledgement covers the expression, not work it schedules for later.",
  { ...retry, code: z.string() }, async ({ code, ...meta }) => execute({ ...meta, cmd: "eval_sc", value: code }));
server.tool("status", "Report engine health, last fault, session/generation and the existing tracked slot state.", async () => text(JSON.stringify({
  state: engine.state, error: engine.error || meter.error, faultVersion: engine.faultVersion, lastFault: engine.lastFault,
  sessionId: app.sessionId, generation: engine.generation,
  ...app.projectState(),
  tempoBpm: rig.tempoBpm, slots: rig.slots, muted: [...rig.muted], solo: rig.solo,
  stopped: rig.stopped, paused: rig.paused, recording: rig.recording && engine.running, recordingUnconfirmed: rig.recording && !engine.running, recPath: rig.recPath,
  synchronized: rig.synchronized && (engine.state === "ready" || engine.state === "idle" && !engine.error),
  tracking: "Slots are a project projection. Raw interpreter actions outside explicit slot assignments are runtime-only and are not replayed by recovery.",
  dashboard: "http://127.0.0.1:" + ((dashboard.address() as { port: number } | null)?.port ?? DASHBOARD_PORT),
})));

// Bind before exposing MCP or starting audio. An occupied port is an error, never
// permission to stop the process using it. The existing MCP launch remains intact.
const dashboard = startDashboard(
  DASHBOARD_PORT,
  DASHBOARD_HTML,
  () => {
    // map each active slot dN to its default orbit (N-1) and surface last-hit time
    const hits: Record<string, number> = {};
    // per-channel live scope: latest rms/peak (+ waveform) per active slot, recent only
    const scopes: Record<string, { rms: number; peak: number; wave?: number[] }> = {};
    const now = Date.now();
    for (const k of Object.keys(rig.slots)) {
      const orbit = parseInt(k.slice(1), 10) - 1;
      const t = meter.hits[orbit];
      if (t) hits[k] = t;
      const sc = meter.scopes[orbit];
      if (sc && now - sc.t < 500) {
        const entry: { rms: number; peak: number; wave?: number[] } = { rms: sc.rms, peak: sc.peak };
        if (sc.wave && sc.waveT && now - sc.waveT < 500) entry.wave = sc.wave;
        scopes[k] = entry;
      }
    }
    return {
      ...app.projectState(),
      scope: SCOPE_ENABLED,
      scopes,
      status: engine.state,
      error: engine.error || meter.error,
      faultVersion: engine.faultVersion,
      lastFault: engine.lastFault,
      generation: engine.generation,
      sessionId: app.sessionId,
      synchronized: rig.synchronized && (engine.state === "ready" || engine.state === "idle" && !engine.error),
      stopped: rig.stopped,
      recPath: rig.recPath,
      tempoBpm: rig.tempoBpm,
      meterL: meter.l,
      meterR: meter.r,
      meterAge: meter.lastUpdate,
      slots: rig.slots,
      muted: [...rig.muted],
      solo: rig.solo,
      paused: rig.paused,
      hits,
      spectrum: meter.spectrum,
      recording: rig.recording && engine.running,
      recordingUnconfirmed: rig.recording && !engine.running,
      devices: engine.devices,
      device: engine.currentDevice,
    };
  },
  // audio clock for the dashboard playhead; `age` lets the browser anchor precisely,
  // `lead` is the Tidal latency so the playhead lands on the sound, not ahead of it
  () => ({ cycle: meter.cycle, cps: meter.cps, lead: meter.lead, age: Date.now() - meter.cycleAt }),
  (body) => app.dispatchExternal(body),
);

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  dashboard.close(); dashboard.closeAllConnections();
  meter.stop();
  try { engine.stop(); }
  catch (e) { process.stderr.write(String(e) + "\n"); process.exitCode = 1; }
}
process.on("SIGINT", () => { shutdown(); process.exit(process.exitCode ?? 0); });
process.on("SIGTERM", () => { shutdown(); process.exit(process.exitCode ?? 0); });
process.on("exit", shutdown);
// MCP hosts normally close stdin before terminating their child. Release our own
// resources on that close instead of leaving a server that a reconnect must evict.
process.stdin.on("end", shutdown);

try {
  await once(dashboard, "listening");
  await meter.start(METER_UDP_PORT);
  await server.connect(new StdioServerTransport());
} catch (e) {
  process.stderr.write("Rig startup failed: " + String(e) + "\n");
  shutdown(); process.exitCode = 1;
}
// Lazy boot: engines start on the first musical command or explicit boot.
