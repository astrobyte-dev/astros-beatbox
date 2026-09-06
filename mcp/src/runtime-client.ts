import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, existsSync, statSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DASHBOARD_PORT, RECOVERY_DIR } from "./config.js";
import { RUNTIME_PROTOCOL, runtimeKey, startRuntime } from "./runtime.js";
import { inspectWindows } from "./runtime-inspection.js";

export function validRuntime(info: unknown): info is { ready: boolean; sessionId: string; pid: number } {
  const i = info as Record<string, unknown> | null;
  return !!i && i.kind === "astros-beatbox-runtime" && i.protocol === RUNTIME_PROTOCOL && i.key === runtimeKey && typeof i.ready === "boolean" && Number.isSafeInteger(i.pid) && Number(i.pid) > 0 && (!i.ready || typeof i.sessionId === "string" && /^[a-f0-9-]{36}$/.test(i.sessionId));
}
export async function portConflict(port: number): Promise<Error> {
  const os = await inspectWindows();
  const sockets = os.sockets.filter(s => s.port === port && s.protocol === "TCP");
  const owners = sockets.map(s => { const p = os.processes.find(p => p.pid === s.pid); return `${p?.name ?? "unknown process"}, PID ${s.pid}${p?.path ? ", " + p.path : ""}${p?.startedAt ? ", started " + p.startedAt : ""}`; });
  return new Error(`PORT CONFLICT (EADDRINUSE) on TCP ${port}: ${owners.join("; ") || "owner could not be inspected"}. This is not a verified compatible Beatbox runtime. No process was stopped.`);
}

export async function connectRuntime(): Promise<{ url: string; reused: boolean; close: () => void }> {
  // Port zero is explicitly ephemeral: retained for embedded tests and isolated
  // callers. The registered, fixed-port MCP launch uses the persistent owner.
  if (DASHBOARD_PORT === 0) { const r = await startRuntime(0); return { url: r.url, reused: false, close: r.close }; }
  const url = `http://127.0.0.1:${DASHBOARD_PORT}`;
  const probe = async () => {
    let response: Response;
    try { response = await fetch(url + "/runtime", { signal: AbortSignal.timeout(1000) }); }
    catch (e) { if ((e as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") return "absent"; throw await portConflict(DASHBOARD_PORT); }
    let info;
    try { info = await response.json(); } catch { throw await portConflict(DASHBOARD_PORT); }
    if (!response.ok || !validRuntime(info)) throw await portConflict(DASHBOARD_PORT);
    return info.ready ? "ready" : "preparing";
  };
  const existing = await probe();
  if (existing === "ready") return { url, reused: true, close() {} };
  if (existing === "absent") {
    mkdirSync(RECOVERY_DIR, { recursive: true });
    const logPath = path.join(RECOVERY_DIR, "runtime.log");
    if (existsSync(logPath) && statSync(logPath).size > 1024 * 1024) renameSync(logPath, logPath + ".previous");
    const log = openSync(logPath, "a");
    try {
      // Keep P2's detached owner: libuv otherwise assigns it to a job that dies
      // with the MCP/launcher parent. Audio children use no-window creation.
      const child = spawn(process.execPath, [fileURLToPath(new URL("runtime.js", import.meta.url))], { env: process.env, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
    } finally { closeSync(log); }
  }
  for (let i = 0; i < 100; i++) { if (await probe() === "ready") return { url, reused: existing !== "absent", close() {} }; await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Persistent runtime did not start. Inspect .abx-recovery/runtime.log");
}
