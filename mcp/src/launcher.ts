import { execFile } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectRuntime } from "./runtime-client.js";

try {
  const runtime = await connectRuntime();
  const studio = runtime.url + "/studio" + (runtime.reused ? "?alreadyRunning=1" : "");
  console.log(JSON.stringify({ reused: runtime.reused, studio, system: runtime.url + "/system", message: runtime.reused ? "Beatbox was already running." : "Beatbox is ready." }));
  if (process.argv.includes("--open")) {
    if (process.platform !== "win32") throw new Error("Open Studio at " + studio);
    try {
      await promisify(execFile)("cscript.exe", ["//Nologo", fileURLToPath(new URL("../open-studio.vbs", import.meta.url)), studio], { windowsHide: true, timeout: 15000 });
    } catch (e) { throw new Error("Beatbox is running. Open " + studio + ". Windows could not open the browser: " + String(e)); }
  }
  rmSync(fileURLToPath(new URL("../launch-error.txt", import.meta.url)), { force: true });
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  writeFileSync(fileURLToPath(new URL("../launch-error.txt", import.meta.url)), message);
  console.error(message); process.exitCode = 1;
}
