import { DASHBOARD_PORT } from "./config.js";
import { RUNTIME_PROTOCOL, runtimeKey } from "./runtime.js";

// Explicitly stop only an identified runtime for this workspace. Never start a
// replacement as a side effect of Stop and never terminate a port owner by PID.
const url = `http://127.0.0.1:${DASHBOARD_PORT}`;
try {
  const response = await fetch(url + "/runtime", { signal: AbortSignal.timeout(5000) });
  const info = await response.json();
  if (!response.ok || info.kind !== "astros-beatbox-runtime" || info.protocol !== RUNTIME_PROTOCOL || info.key !== runtimeKey) throw new Error("Port is not this workspace's compatible runtime");
  const stopped = await fetch(url + "/runtime/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: info.sessionId }), signal: AbortSignal.timeout(180000) });
  if (!stopped.ok) throw new Error(await stopped.text());
  console.log(await stopped.text());
} catch (e) { console.error("Runtime stop was not confirmed: " + String(e)); process.exitCode = 1; }
