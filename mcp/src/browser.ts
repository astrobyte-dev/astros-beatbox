import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export function browserCommand(url: string, platform = process.platform): { exe: string; args: string[] } {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+\/(studio|system)(\?alreadyRunning=1)?$/.test(url)) throw new Error("Invalid local Beatbox URL");
  if (platform === "win32") return { exe: "cscript.exe", args: ["//Nologo", fileURLToPath(new URL("../open-studio.vbs", import.meta.url)), url] };
  if (platform === "linux") return { exe: "xdg-open", args: [url] };
  throw new Error("Automatic browser opening is unavailable on this platform");
}
export async function openBrowser(url: string): Promise<string | null> {
  try {
    const command = browserCommand(url);
    await promisify(execFile)(command.exe, command.args, { windowsHide: true, timeout: 15000 });
    return null;
  } catch (e) { return `Beatbox is running. Open ${url}. Browser opening was not confirmed: ${String(e)}`; }
}
