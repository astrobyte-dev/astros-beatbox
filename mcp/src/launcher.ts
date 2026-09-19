import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectRuntime } from "./runtime-client.js";
import { openBrowser } from "./browser.js";

try {
  const runtime = await connectRuntime();
  const studio = runtime.url + "/studio" + (runtime.reused ? "?alreadyRunning=1" : "");
  console.log(JSON.stringify({ reused: runtime.reused, studio, system: runtime.url + "/system", message: runtime.reused ? "Beatbox was already running." : "Beatbox is ready." }));
  if (process.argv.includes("--open")) {
    const warning = await openBrowser(studio);
    if (warning) {
      if (process.platform === "win32") throw new Error(warning);
      console.error(warning);
    }
  }
  rmSync(fileURLToPath(new URL("../launch-error.txt", import.meta.url)), { force: true });
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  writeFileSync(fileURLToPath(new URL("../launch-error.txt", import.meta.url)), message);
  console.error(message); process.exitCode = 1;
}
