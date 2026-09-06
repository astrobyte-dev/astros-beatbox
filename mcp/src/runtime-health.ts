import type { Application } from "./application.js";
import type { Engine } from "./engine.js";
import type { Meter } from "./meter.js";
import { RuntimeInspection, portInventory, verifiedTree } from "./runtime-inspection.js";
import type { ProcessIdentity } from "./owned-process.js";
import type { RuntimeLogs } from "./runtime-logs.js";
import type { ProcDriver } from "./proc.js";

export interface Component {
  id: string; parent: string | null; name: string; technical: string; state: string;
  health: string; pid: number | null; startedAt: string | null;
  ownership: string; restart: string | null; error: string | null;
  transitionedAt: number; driver?: ProcDriver["health"];
}
export class RuntimeHealth {
  readonly inspection = new RuntimeInspection();
  readonly startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  readonly bridges = new Map<string, { pid: number; at: number; startedAt: string; connected: boolean }>();
  private previous = "";
  private transitionedAt = Date.now();
  private inspectedGeneration = -1;
  private transitions = new Map<string, { state: string; at: number }>();
  constructor(private engine: Engine, private meter: Meter, private app: Application, private port: number, private logs: RuntimeLogs) {}
  bridge(input: unknown) {
    const b = input as { id?: string; pid?: number; connected?: boolean; sessionId?: string };
    if (!b || !/^[a-f0-9-]{36}$/.test(b.id ?? "") || !Number.isSafeInteger(b.pid) || b.pid! <= 0 || typeof b.connected !== "boolean" || b.sessionId !== this.app.sessionId) throw new Error("Invalid bridge session");
    const old = this.bridges.get(b.id!);
    if (old?.connected !== b.connected) this.logs.add("mcp", b.connected ? "MCP bridge connected" : "MCP bridge disconnected; runtime continues");
    this.bridges.set(b.id!, { pid: b.pid!, at: Date.now(), startedAt: old?.startedAt ?? new Date().toISOString(), connected: b.connected });
    while (this.bridges.size > 32) this.bridges.delete(this.bridges.keys().next().value!);
  }
  async snapshot() {
    const generation = this.engine.generation;
    const os = await this.inspection.refresh(generation !== this.inspectedGeneration);
    if (generation === this.engine.generation) this.inspectedGeneration = generation;
    const e = this.engine, m = this.meter, a = this.app, now = Date.now();
    const roots = [e.tidal.ownershipIdentity, e.sclang.ownershipIdentity].filter((p): p is ProcessIdentity => !!p);
    // The runtime only claims itself and P0a verified interpreter trees. Its
    // inspection helpers and host-launched MCP clients are not adopted as roots.
    const owned = verifiedTree(os.processes, roots); owned.add(process.pid);
    const ports = portInventory(os, owned, [
      { port: this.port, protocol: "TCP", purpose: "Studio and System" },
      { port: m.port ?? 0, protocol: "UDP", purpose: "Audio meters and clock" },
      { port: 57110, protocol: "UDP", purpose: "Audio synthesis" },
      { port: 57120, protocol: "UDP", purpose: "Instrument messages" },
      { port: 6010, protocol: "UDP", purpose: "Tidal control messages" },
    ].filter(p => p.port > 0) as { port: number; protocol: "TCP" | "UDP"; purpose: string }[]);
    const fresh = m.lastUpdate > 0 && now - m.lastUpdate < 3000;
    const inspectionFresh = !os.error && now - os.at < 15000 && generation === e.generation;
    const conflict = ports.some(p => p.state === "conflict");
    const missingProcess = e.state === "ready" && (!e.tidal.pid || !owned.has(e.tidal.pid) || !e.sclang.pid || !owned.has(e.sclang.pid) || !os.processes.some(p => owned.has(p.pid) && /scsynth/i.test(p.name)));
    const audioState = e.state === "booting" ? "Starting" : e.state === "idle" ? "Idle" : e.state === "ready" && e.running && fresh ? "Ready" : "Degraded";
    const busy = !["idle", "Complete", "Failed"].includes(a.lifecycle.phase);
    const state = busy ? a.lifecycle.phase : conflict || missingProcess || e.state === "error" || e.state === "degraded" || m.error || a.lifecycle.error || e.state === "ready" && !fresh || !inspectionFresh ? "Needs attention" : audioState === "Idle" ? "Ready when you are" : audioState === "Starting" ? "Preparing your instruments" : "Everything is in tune";
    if (state !== this.previous) { this.previous = state; this.transitionedAt = now; this.logs.add("runtime", state); }
    const components: Component[] = [];
    const add = (id: string, parent: string | null, name: string, technical: string, status: string, health: string, pid: number | null = process.pid, startedAt: string | null = this.startedAt, ownership = "Beatbox-owned service", restart: string | null = null, error: string | null = null) => {
      const previous = this.transitions.get(id), changed = !previous || previous.state !== status;
      const transitionedAt = changed ? now : previous.at;
      this.transitions.set(id, { state: status, at: transitionedAt });
      if (changed && ["audio", "tidal", "sclang", "telemetry"].includes(id)) this.logs.add(id === "sclang" ? "supercollider" : id as "audio" | "tidal" | "telemetry", name + ": " + status, error ? "error" : "info", e.generation);
      components.push({ id, parent, name, technical, state: status, health, pid, startedAt, ownership, restart, error, transitionedAt });
    };
    add("runtime", null, "Astro’s Beatbox", "Persistent Node runtime", busy ? "Working" : "Running", "Responding to this request", process.pid, this.startedAt, "Beatbox-owned process", null, a.lifecycle.error);
    add("studio", "runtime", "Studio & System", "HTTP server", "Ready", "Serving this connection");
    add("audio", "runtime", "Audio engine", "Tidal + SuperCollider", audioState, fresh ? "Receiving live audio telemetry" : e.state === "idle" ? "Start audio when you need it" : "Waiting for fresh audio telemetry", null, null, "Beatbox-owned service", "audio.restart", e.state === "idle" ? null : e.error);
    for (const [id, driver, name] of [["tidal", e.tidal, "Pattern player"], ["sclang", e.sclang, "Instrument host"]] as const) {
      const h = driver.health;
      const verified = h.pid !== null && owned.has(h.pid) && inspectionFresh;
      const status = h.exited ? "Exited" : h.error ? "Failed" : !h.pid ? "Idle" : !verified ? "Unverified" : e.state === "ready" && h.usable ? "Ready" : e.state === "booting" ? "Starting" : "Degraded";
      add(id, "audio", name, id === "tidal" ? "Tidal / GHCi" : "sclang / SuperDirt", status, status === "Ready" ? "Interpreter commands acknowledged" : "Readiness: " + status.toLowerCase(), h.pid, h.startedAt, verified ? "Beatbox-owned process" : h.pid ? "Ownership not currently verified" : "Beatbox-managed; not started", "audio.restart", h.error);
      components.at(-1)!.driver = h;
    }
    const direct = new Set([process.pid, e.sclang.pid, e.tidal.pid]);
    for (const p of os.processes.filter(p => owned.has(p.pid) && !direct.has(p.pid))) {
      const parent = p.parentPid === e.sclang.pid ? "sclang" : p.parentPid === e.tidal.pid ? "tidal" : "process-" + p.parentPid;
      add("process-" + p.pid, parent, /scsynth/i.test(p.name) ? "Sound output" : "Audio helper", p.name, !inspectionFresh ? "Unverified" : /scsynth/i.test(p.name) ? audioState : "Running", /scsynth/i.test(p.name) && fresh ? "Fresh audio meter received" : "Process observed; no independent readiness probe", p.pid, p.startedAt, inspectionFresh ? "Beatbox-owned descendant" : "Ownership observation stale", "audio.restart");
    }
    if (!components.some(c => c.technical.toLowerCase().includes("scsynth"))) add("scsynth", "sclang", "Sound output", "scsynth", e.state === "idle" ? "Idle" : "Unavailable", "No verified audio-server process observed", null, null, "Not currently verified", "audio.restart");
    add("telemetry", "runtime", "Audio activity", "UDP telemetry", m.error ? "Failed" : fresh ? "Ready" : m.listening ? "Idle" : "Disconnected", m.error ?? (fresh ? "Fresh meters and clock" : "Waiting for audio"), process.pid, m.startedAt, "Beatbox-owned service", "runtime.restart", m.error);
    const project = a.projectState();
    add("recording", "runtime", "Recorder", "Recording catalogue / SC record tap", project.recordingState?.state ?? "Idle", project.recordingState?.error ?? "Preview is excluded from project recordings", process.pid, this.startedAt, "Beatbox-owned service", null, project.recordingState?.error ?? null);
    add("mcp", null, "Connected assistants", "MCP stdio clients", [...this.bridges.values()].some(b => b.connected && now - b.at < 15000) ? "Connected" : "Disconnected", "Clients connect to the runtime; disconnecting keeps music running", null, null, "External clients / not owned");
    for (const [id, b] of this.bridges) add(id, "mcp", "Assistant bridge", "MCP / Node (reported PID)", b.connected && now - b.at < 15000 ? "Connected" : "Disconnected", "Connection heartbeat; not an ownership claim", b.pid, b.startedAt, "Host-launched / not owned");
    for (const id of this.transitions.keys()) if (!components.some(c => c.id === id)) this.transitions.delete(id);
    return { schema: 1, sessionId: a.sessionId, generation: e.generation, at: now, state, transitionedAt: this.transitionedAt, components, ports, inspection: { at: os.at, error: os.error, fresh: inspectionFresh }, lifecycle: { ...a.lifecycle },
      audio: { state: audioState, device: e.currentDevice || "Not prepared", ...e.audioInfo, meterFresh: fresh, left: fresh ? m.l : null, right: fresh ? m.r : null, preview: project.preview.state, recording: project.recordingState?.state ?? "idle" },
      project: { name: project.project.name, id: project.project.id, revision: project.project.revision, saved: a.savedState, appliedRevision: project.projectRuntime.appliedRevision, recovered: project.workspace.recovered, recoveryWarning: project.workspace.recoveryWarning },
      lastFault: e.lastFault, logCursor: this.logs.lastId };
  }
}
export type SystemSnapshot = Awaited<ReturnType<RuntimeHealth["snapshot"]>>;
