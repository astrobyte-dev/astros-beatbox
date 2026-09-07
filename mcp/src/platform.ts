import path from "node:path";
import os from "node:os";
import { accessSync, constants } from "node:fs";
import { createHash } from "node:crypto";

export const PLATFORM = process.platform;
export const PLATFORM_NAME = PLATFORM === "win32" ? "Windows" : PLATFORM === "linux" ? "Linux" : PLATFORM;
export function findExecutable(name: string, override?: string, extra: string[] = [], env = process.env): string {
  if (override) return override;
  const candidates = [...extra, ...(env.PATH ?? "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name))];
  for (const candidate of candidates) try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* Try next installed location. */ }
  return name; // Direct spawn's ENOENT reports the missing executable; no fabricated absolute path.
}
export function linuxLocations(root: string, env = process.env, home = os.homedir()) {
  const posix = path.posix;
  const xdg = (key: string, fallback: string) => env[key] && posix.isAbsolute(env[key]!) ? env[key]! : posix.join(home, fallback);
  const workspace = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
  return {
    data: posix.join(xdg("XDG_DATA_HOME", ".local/share"), "astros-beatbox", workspace),
    state: posix.join(xdg("XDG_STATE_HOME", ".local/state"), "astros-beatbox", workspace),
    config: posix.join(xdg("XDG_CONFIG_HOME", ".config"), "astros-beatbox", workspace),
    samples: posix.join(xdg("XDG_DATA_HOME", ".local/share"), "SuperCollider", "downloaded-quarks", "Dirt-Samples"),
    ghcup: env.TIDAL_GHCUP ?? posix.join(home, ".ghcup"),
  };
}
export function audioCapabilities(platform: string, backend?: string) {
  const selected = backend ?? (platform === "win32" ? "portaudio" : platform === "linux" ? "jack" : "unavailable");
  if (!["jack", "portaudio", "unavailable"].includes(selected)) throw new Error("TIDAL_SC_BACKEND must be jack or portaudio");
  return { backend: selected, deviceSelection: selected === "portaudio", configuration: selected === "jack" ? "Audio routing and format are managed by the JACK server" : selected === "portaudio" ? "Audio device selection is available" : "Audio backend unavailable on this platform" };
}
