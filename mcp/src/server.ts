import { variationSchema, jamLockSchema, macroSchema, verbSchema } from "./jam-model.js";
import { samplePlaybackSchema, libraryDetailsSchema } from "./sampling.js";
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
for (const action of ["start", "stop", "keep"] as const) server.tool("jam_capture_" + action, "Performance event notebook: " + action + ". Up to 128 acknowledged events. Only scene launches carry engine scheduled cycles. No replay/arrangement conversion; distinct from audio recording.", projectMeta, args => execute({ ...args, cmd: "jam.capture." + action }));
server.tool("jam_inspect", "Inspect canonical Jam capabilities, locks, macros, semantic verbs and bounded session trail. No audio boot.", async () => { const s = await state(); return text(JSON.stringify({ ...s.jam, constraints: s.project.jam, projectId: s.project.id, revision: s.project.revision })); });
server.tool("jam_variation", "Create one seeded canonical variation/Chaos/fill. Obeys track/rhythm/sound/FX/motion and parameter locks; rejects unsupported unlocked scopes. Deliberate silence stays silent.", { ...projectMeta, request: variationSchema }, args => execute({ ...args, cmd: "jam.variation" }));
server.tool("jam_lock", "Replace one track's persistent Jam Keep/Change constraints. Track lock protects all generated changes. Explicit editing/Undo/return remain available.", { ...projectMeta, lock: jamLockSchema }, args => execute({ ...args, cmd: "jam.lock" }));
server.tool("jam_verb", "Apply a supported semantic musical recipe as one Undo action with change summary.", { ...projectMeta, verb: verbSchema, trackIds: z.array(z.string()).min(1).max(16) }, args => execute({ ...args, cmd: "jam.verb" }));
server.tool("jam_macro_assign", "Create/replace a project macro using stable semantic targets. Offsets preserve base, automation and modulation. At most eight macros.", { ...projectMeta, macro: macroSchema }, args => execute({ ...args, cmd: "jam.macro.put" }));
server.tool("jam_macro_value", "Set normalized signed macro offset (-1 to 1), one gesture/intention. Zero restores underlying sound; locks suppress protected targets.", { ...projectMeta, macroId: z.string(), value: z.number().min(-1).max(1), groupId: z.string().max(100).optional() }, args => execute({ ...args, cmd: "jam.macro.value" }));
server.tool("jam_macros_suggest", "Add missing capability-based project macros with neutral values.", projectMeta, args => execute({ ...args, cmd: "jam.macros.suggest" }));
server.tool("jam_macros_reset", "Reset macro values to neutral without changing authored base or automation/modulation.", projectMeta, args => execute({ ...args, cmd: "jam.macros.reset" }));
server.tool("jam_return", "Return to a bounded session idea using canonical history. Explicit restoration includes that idea's constraints and mappings; one Undo.", { ...projectMeta, ideaId: z.string() }, args => execute({ ...args, cmd: "jam.return" }));
server.tool("jam_keep", "Mark current idea in the session trail. Save the project for disk persistence or promote its clips to a scene.", projectMeta, args => execute({ ...args, cmd: "jam.keep" }));
server.tool("jam_promote", "Copy current clips and clip automation to an independent scene, one Undo. Instruments, FX and macros remain shared as in P3.", { ...projectMeta, sceneId: z.string(), name: z.string().min(1).max(120) }, args => execute({ ...args, cmd: "jam.promote" }));
server.tool("user_audio_library", "List user/captured sounds and immutable content identities, details, missing state and import progress. No audio boot.", async () => { const r = await fetch(runtime.url + "/audio/library"); return text(JSON.stringify(await r.json())); });
server.tool("user_audio_import", "Import ONE explicit absolute WAV path (PCM16 mono/stereo, max 256 MiB/15 minutes). Copies to managed storage; no folder crawling. Optional assetId relinks exact content.", { ...retry, value: z.string(), assetId: z.string().optional() }, args => execute({ ...args, cmd: "audio.import" }));
server.tool("user_audio_details", "Rename, favorite, tag or collect a sound. Library revision guards metadata; musical Undo never deletes audio.", { ...retry, assetId: z.string(), libraryRevision: z.number().int(), details: libraryDetailsSchema }, args => execute({ ...args, cmd: "audio.details" }));
server.tool("user_audio_add", "Add a user sound as a sequenced sample track in the selected scene. One Undo; up to 12 channels.", { ...projectMeta, value: z.string() }, args => execute({ ...args, cmd: "audio.add" }));
server.tool("user_audio_assign", "Assign immutable audio identity to a visual clip, retaining rhythm and FX; one project Undo.", { ...projectMeta, value: z.string(), clipId: z.string() }, args => execute({ ...args, cmd: "audio.assign" }));
server.tool("user_audio_preview", "Preview a user sound, optionally shaped, through the native preview group outside project recording. No musical history.", { ...retry, value: z.string(), playback: samplePlaybackSchema.optional() }, args => execute({ ...args, cmd: "audio.preview" }));
server.tool("capture_status", "Inspect external input capability and capture lifecycle; distinct from project-output recording.", async () => { const s = await state(); return text(JSON.stringify({ input: s.input, capture: s.capture })); });
server.tool("capture_prepare", "Explicitly prepare input, restarting audio. Stop playback/output recording first. Empty device uses backend default; only enumerated devices accepted. Monitor starts OFF.", { ...retry, device: z.string(), channel: z.number().int().min(0).max(1) }, args => execute({ ...args, cmd: "capture.prepare" }));
server.tool("capture_controls", "Set input gain (0–2) and explicit monitoring. Headphones recommended when enabling monitor. Capture retains dry input after gain; use track FX after Keep.", { ...retry, gain: z.number().min(0).max(2), monitor: z.boolean() }, args => execute({ ...args, cmd: "capture.controls" }));
server.tool("capture_start", "Start a dry external-input take, up to five minutes. Requires prepared input; returns take identity.", { ...retry, value: z.string().min(1).max(120) }, args => execute({ ...args, cmd: "capture.start" }));
for (const action of ["stop", "keep", "discard", "preview"] as const) server.tool("capture_" + action, "Capture " + action + " for the exact take identity. Only validated finalized takes can be kept. Does not change project recording or musical history.", { ...retry, value: z.string().uuid() }, args => execute({ ...args, cmd: "capture." + action }));
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
