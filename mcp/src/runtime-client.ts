import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DASHBOARD_PORT, RECOVERY_DIR } from "./config.js";
import { RUNTIME_PROTOCOL, runtimeKey, startRuntime } from "./runtime.js";

export async function connectRuntime(): Promise<{ url: string; close: () => void }> {
  // Port zero is explicitly ephemeral: retained for embedded tests and isolated
  // callers. The registered, fixed-port MCP launch uses the persistent owner.
  if (DASHBOARD_PORT === 0) { const r = await startRuntime(0); return { url: r.url, close: r.close }; }
  const url = `http://127.0.0.1:${DASHBOARD_PORT}`;
  const probe = async () => {
    let response: Response;
    try { response = await fetch(url + "/runtime", { signal: AbortSignal.timeout(1000) }); }
    catch (e) { if ((e as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") return false; throw new Error("Runtime could not be identified; no process was replaced. " + String(e)); }
    let info;
    try { info = await response.json(); } catch { throw new Error("EADDRINUSE: dashboard port belongs to another service"); }
    if (!response.ok || info?.kind !== "astros-beatbox-runtime" || info.protocol !== RUNTIME_PROTOCOL || info.key !== runtimeKey) throw new Error("EADDRINUSE: port has an incompatible runtime or workspace; stop it explicitly");
    return info.ready === true;
  };
  if (await probe()) return { url, close() {} };
  mkdirSync(RECOVERY_DIR, { recursive: true });
  const log = openSync(path.join(RECOVERY_DIR, "runtime.log"), "a");
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL("runtime.js", import.meta.url))], { env: process.env, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
  } finally { closeSync(log); }
  for (let i = 0; i < 50; i++) { if (await probe()) return { url, close() {} }; await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Persistent runtime did not start. Inspect .abx-recovery/runtime.log");
}
