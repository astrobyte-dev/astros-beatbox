import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Engine } from "./engine.js";
import { Application } from "./application.js";
import { Meter } from "./meter.js";
import { startDashboard } from "./dashboard.js";
import { DASHBOARD_PORT, METER_UDP_PORT, DASHBOARD_HTML, SETS_DIR, RECORDINGS_DIR, AUDIO_DEVICE_FILE, SCOPE_ENABLED, PROJECTS_DIR, RECOVERY_DIR, DIRT_SAMPLES_DIR } from "./config.js";

export const runtimeKey = createHash("sha256").update(JSON.stringify([DASHBOARD_HTML, PROJECTS_DIR, RECOVERY_DIR, RECORDINGS_DIR, DIRT_SAMPLES_DIR, METER_UDP_PORT])).digest("hex");
export const RUNTIME_PROTOCOL = 1;
export async function startRuntime(port = DASHBOARD_PORT) {
  const engine = new Engine(), meter = new Meter();
  let app: Application;
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
      recording: rig.recording && engine.running, recordingUnconfirmed: rig.recording && !engine.running, devices: engine.devices, device: engine.currentDevice,
      files: app.project.storage?.list() ?? [], dashboard: `http://127.0.0.1:${(dashboard.address() as { port: number } | null)?.port ?? port}` };
  };
  let closed = false, stopping = false, audioClosed = false;
  const dashboard = startDashboard(port, DASHBOARD_HTML, () => app ? state() : { status: "preparing" },
    () => ({ cycle: meter.cycle, cps: meter.cps, lead: meter.lead, age: Date.now() - meter.cycleAt }),
    c => stopping || !app ? Promise.resolve({ ok: false as const, operationId: "runtime", sessionId: app?.sessionId ?? "preparing", generation: engine.generation, code: "BUSY", error: "Runtime is preparing or stopping" }) : app.dispatchExternal(c), { sounds: () => app?.sounds() ?? [], get recordings() { return app?.recordings; },
      identity: () => ({ kind: "astros-beatbox-runtime", protocol: RUNTIME_PROTOCOL, key: runtimeKey, ready: !!app, sessionId: app?.sessionId, pid: process.pid }),
      shutdown: async session => {
        if (!app || session !== app.sessionId) throw new Error("Runtime session changed; refresh before stopping");
        if (stopping) return "Runtime is already stopping.";
        stopping = true;
        await app.drain();
        let message = "Runtime stopping. Authored music and completed recordings are kept.";
        if (app.rig.recording) {
          const active = app.projectState().recordingState;
          const r = await app.dispatch({ cmd: "record.stop", value: active!.id });
          if (!r.ok) message += " Recording finalization failed: " + r.error;
        }
        // Release audio before replying, so a subsequent launch cannot race the
        // old engine's owned-process cleanup. Keep HTTP alive for the response.
        try { closeAudio(); } catch (e) { message += " Owned audio cleanup failed: " + String(e); }
        setTimeout(() => close(), 50);
        return message;
      } });
  function close() {
    if (closed) return; closed = true;
    dashboard.close(); dashboard.closeAllConnections(); closeAudio();
  }
  function closeAudio() { if (audioClosed) return; audioClosed = true; meter.stop(); engine.stop(); }
  try {
    await once(dashboard, "listening"); await meter.start(METER_UDP_PORT);
    // Only the successful port owner may open recovery/catalogue storage. A
    // losing startup must not mark another runtime's active take interrupted.
    app = new Application(engine, { sets: SETS_DIR, recordings: RECORDINGS_DIR, device: AUDIO_DEVICE_FILE, projects: PROJECTS_DIR, recovery: RECOVERY_DIR, samples: DIRT_SAMPLES_DIR });
  }
  catch (e) { close(); throw e; }
  return { app, engine, meter, dashboard, state, close, url: `http://127.0.0.1:${(dashboard.address() as { port: number }).port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const runtime = await startRuntime();
    const stop = () => { try { runtime.close(); } catch (e) { process.stderr.write(String(e)); process.exitCode = 1; } };
    process.on("SIGINT", () => { stop(); process.exit(process.exitCode ?? 0); });
    process.on("SIGTERM", () => { stop(); process.exit(process.exitCode ?? 0); });
    process.on("exit", stop);
  } catch (e) { process.stderr.write("Runtime startup failed: " + String(e) + "\n"); process.exitCode = 1; }
}
