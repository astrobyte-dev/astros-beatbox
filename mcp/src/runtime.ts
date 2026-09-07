import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Engine } from "./engine.js";
import { Application } from "./application.js";
import { Meter } from "./meter.js";
import { startDashboard } from "./dashboard.js";
import { RuntimeLogs } from "./runtime-logs.js";
import { RuntimeHealth } from "./runtime-health.js";
import { DASHBOARD_PORT, METER_UDP_PORT, DASHBOARD_HTML, SETS_DIR, RECORDINGS_DIR, AUDIO_DEVICE_FILE, SCOPE_ENABLED, PROJECTS_DIR, RECOVERY_DIR, DIRT_SAMPLES_DIR } from "./config.js";

export const runtimeKey = createHash("sha256").update(JSON.stringify([DASHBOARD_HTML, PROJECTS_DIR, RECOVERY_DIR, RECORDINGS_DIR, DIRT_SAMPLES_DIR, METER_UDP_PORT])).digest("hex");
export const RUNTIME_PROTOCOL = 1;
export async function startRuntime(port = DASHBOARD_PORT) {
  const engine = new Engine(), meter = new Meter();
  const logs = new RuntimeLogs();
  engine.on("log", entry => logs.child(entry.source, entry.stream, entry.text, entry.generation));
  let app: Application;
  let health: RuntimeHealth;
  const state = () => {
    const rig = app.rig;
    const hits: Record<string, number> = {}, scopes: Record<string, { rms: number; peak: number; wave?: number[] }> = {};
    for (const k of Object.keys(rig.slots)) {
      const orbit = +k.slice(1) - 1, sc = meter.scopes[orbit];
      if (meter.hits[orbit]) hits[k] = meter.hits[orbit];
      if (sc && Date.now() - sc.t < 500) scopes[k] = { rms: sc.rms, peak: sc.peak, ...(sc.wave && sc.waveT && Date.now() - sc.waveT < 500 ? { wave: sc.wave } : {}) };
    }
    return { ...app.projectState(), scope: SCOPE_ENABLED, scopes, status: engine.state, state: engine.state, error: engine.error || meter.error, faultVersion: engine.faultVersion, lastFault: engine.lastFault, generation: engine.generation, sessionId: app.sessionId,
      synchronized: rig.synchronized && (engine.state === "ready" || engine.state === "idle" && !engine.error), stopped: rig.stopped, paused: rig.paused, recPath: rig.recPath, tempoBpm: rig.tempoBpm, meterL: meter.l, meterR: meter.r, meterAge: meter.lastUpdate, slots: rig.slots, muted: [...rig.muted], solo: rig.solo, hits, spectrum: meter.spectrum,
      recording: rig.recording && engine.running, recordingUnconfirmed: rig.recording && !engine.running, devices: engine.devices, device: engine.currentDevice, audioCapabilities: engine.audioCapabilities,
      files: app.project.storage?.list() ?? [], dashboard: `http://127.0.0.1:${(dashboard.address() as { port: number } | null)?.port ?? port}` };
  };
  let closed = false, audioClosed = false;
  const dashboard = startDashboard(port, DASHBOARD_HTML, () => app ? state() : { status: "preparing" },
    () => ({ cycle: meter.cycle, cps: meter.cps, lead: meter.lead, age: Date.now() - meter.cycleAt }),
    c => !app ? Promise.resolve({ ok: false as const, operationId: "runtime", sessionId: "preparing", generation: engine.generation, code: "BUSY", error: "Runtime is preparing" }) : app.dispatchExternal(c), { audio: () => app ? { library: app.userAudio, capture: app.capture, sessionId: app.sessionId, meter: () => ({ available: app.capture.snapshot().inputReady && Date.now() - meter.input.at < 500, peak: meter.input.peak }) } : undefined, sounds: () => app?.sounds() ?? [], get recordings() { return app?.recordings; },
      system: () => health ? health.snapshot() : Promise.resolve({ state: "Preparing runtime" }),
      logs: query => ({ sessionId: app?.sessionId, entries: logs.read(query.get("source") ?? undefined, Math.max(0, Number(query.get("after")) || 0), query.get("diagnostic") === "1"), cursor: logs.lastId }),
      bridge: input => health.bridge(input),
      identity: () => ({ kind: "astros-beatbox-runtime", protocol: RUNTIME_PROTOCOL, key: runtimeKey, ready: !!app, sessionId: app?.sessionId, pid: process.pid }),
      shutdown: async session => {
        if (!app || session !== app.sessionId) throw new Error("Runtime session changed; refresh before stopping");
        const r = await quit();
        if (!r.ok) throw new Error(r.error);
        return r.msg;
      } });
  function close() {
    if (closed) return; closed = true;
    dashboard.close(); dashboard.closeAllConnections(); closeAudio();
  }
  function closeAudio() { if (audioClosed) return; meter.stop(); engine.stop(); audioClosed = true; }
  function quit() { return app.dispatch({ cmd: "runtime.quit", sessionId: app.sessionId, expectedGeneration: engine.generation }); }
  try {
    await once(dashboard, "listening");
    // Keep System available when telemetry conflicts so users can inspect it.
    try { await meter.start(METER_UDP_PORT); } catch (e) { logs.add("telemetry", String(e), "error"); }
    // Only the successful port owner may open recovery/catalogue storage. A
    // losing startup must not mark another runtime's active take interrupted.
    app = new Application(engine, { inputMeterPort: meter.port ?? METER_UDP_PORT, sets: SETS_DIR, recordings: RECORDINGS_DIR, device: AUDIO_DEVICE_FILE, projects: PROJECTS_DIR, recovery: RECOVERY_DIR, samples: DIRT_SAMPLES_DIR });
    health = new RuntimeHealth(engine, meter, app, (dashboard.address() as { port: number }).port, logs);
    app.lifecycleHooks = {
      log: (source, message, error) => logs.add(source, message, error ? "error" : "info", engine.generation),
      restartServices: () => meter.restart(),
      quit: async () => { meter.stop(); audioClosed = true; setTimeout(close, 150); },
    };
    logs.add("runtime", "Persistent runtime ready"); logs.add("studio", "Studio and System are available");
  }
  catch (e) { close(); throw e; }
  return { app, engine, meter, dashboard, state, close, quit, health, logs, url: `http://127.0.0.1:${(dashboard.address() as { port: number }).port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const runtime = await startRuntime();
    const stop = () => { try { runtime.close(); } catch (e) { process.stderr.write(String(e)); process.exitCode = 1; } };
    let shutdown: Promise<unknown> | undefined;
    const graceful = () => { shutdown ??= runtime.quit().then(r => { if (!r.ok) { process.stderr.write(r.error + "\n"); process.exitCode = 1; shutdown = undefined; } }).catch(e => { process.stderr.write(String(e) + "\n"); process.exitCode = 1; shutdown = undefined; }); };
    process.on("SIGINT", graceful);
    process.on("SIGTERM", graceful);
    if (process.platform === "linux") process.on("SIGHUP", graceful);
    process.on("exit", stop);
  } catch (e) { process.stderr.write("Runtime startup failed: " + String(e) + "\n"); process.exitCode = 1; }
}
