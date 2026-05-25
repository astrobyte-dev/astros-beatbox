import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

// Project root, resolved from this file's location so the rig is portable:
// compiled config.js lives at <root>/mcp/dist/config.js -> root is two dirs up.
// Override with TIDAL_HOME if you keep the project somewhere unusual.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LIVECODING = process.env.TIDAL_HOME ?? path.resolve(HERE, "..", "..");

// --- external toolchains: override via env vars, else sensible Windows defaults ---

// SuperCollider: env TIDAL_SCLANG, else newest "SuperCollider-*" under Program Files.
function findSclang(): string {
  if (process.env.TIDAL_SCLANG) return process.env.TIDAL_SCLANG;
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  try {
    const dirs = readdirSync(pf).filter((d) => d.startsWith("SuperCollider")).sort().reverse();
    for (const d of dirs) { const p = path.join(pf, d, "sclang.exe"); if (existsSync(p)) return p; }
  } catch { /* fall through to default */ }
  return "C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe";
}
export const SCLANG = findSclang();

// GHCup (provides ghci + cabal + the mingw64 tidal-link deps). Override base with TIDAL_GHCUP.
const GHCUP = process.env.TIDAL_GHCUP ?? "C:\\ghcup";
export const GHCI = process.env.TIDAL_GHCI ?? path.join(GHCUP, "bin", "ghci.exe");
export const CABAL_DIR = process.env.CABAL_DIR ?? "C:\\cabal";
// ghci needs ghcup bin (its own runtime) + mingw64 (tidal-link C++ deps) on PATH.
export const GHCI_PATH = [path.join(GHCUP, "bin"), path.join(GHCUP, "msys64", "mingw64", "bin"), process.env.PATH ?? ""].join(path.delimiter);

// Rig files — always inside the project, so portable automatically.
export const SUPERDIRT_STARTUP = path.join(LIVECODING, "sc", "superdirt_startup.scd");
export const BOOT_TIDAL = path.join(LIVECODING, "tidal", "BootTidal.hs");
// Dashboard HTML served from a file (read fresh per request -> edit + browser refresh,
// no MCP reload needed for UI tweaks).
export const DASHBOARD_HTML = path.join(LIVECODING, "mcp", "dashboard.html");

// readiness markers printed by each engine
// Echo-proof marker (sclang echoes piped stdin, so the marker must NOT appear
// verbatim in superdirt_startup.scd; it's assembled there at runtime).
export const SUPERDIRT_READY = "SDIRT_RDY_7731";
export const SC_WELCOME = "Welcome to SuperCollider";
// BootTidal's last action is to set the prompt to "tidal>" -> reliable "loaded" signal.
export const TIDAL_READY = "tidal>";

// sclang interactive eval trigger: send  <code>\n <0x0C>\n
export const FORM_FEED = "\x0c";

// Web dashboard (HTTP) + the UDP port the SuperDirt meter synth forwards levels to.
export const DASHBOARD_PORT = Number(process.env.TIDAL_DASH_PORT ?? 3737);
export const METER_UDP_PORT = Number(process.env.TIDAL_METER_PORT ?? 57199);

// Per-channel live "synth board" scope: each dN card gets a live-moving waveform.
// Built on SuperDirt's own per-orbit RMS (startSendRMS) — additive, degrades safely.
// Default ON; set TIDAL_SCOPE=0 to disable (no RMS enabled, no scopes in /state).
export const SCOPE_ENABLED = (process.env.TIDAL_SCOPE ?? "1") !== "0";
// SuperDirt RMS reply rate (Hz). 20 reads as "live" without flooding loopback UDP
// (12 orbits x 20 Hz). SendPeakRMS rate isn't modulatable, so it's set at boot.
export const SCOPE_RMS_HZ = Number(process.env.TIDAL_SCOPE_HZ ?? 20);
// Waveform (Strategy B) detail: N raw samples captured across a WAVE_MS window. This is
// RAW MATERIAL for the client-side triggered oscilloscope — the window must be wide
// enough to contain >=2 cycles of the lowest content to lock onto (sub-bass ~50Hz needs
// ~40ms+), so the client can phase-trigger + auto-zoom to ~2 clean cycles. More N =
// finer per-cycle resolution. (Decimation rate = N/WAVE_MS kHz; keep < SR/2.)
export const SCOPE_WAVE_N = Number(process.env.TIDAL_SCOPE_N ?? 96);
export const SCOPE_WAVE_MS = Number(process.env.TIDAL_SCOPE_MS ?? 48);

// Audio output device. The startup .scd reads the device name from this file at boot
// (empty/absent or "SYSTEM" = let the OS pick). The dashboard writes it + reboots to
// switch outputs. For reliable HEADLESS audio pick a "Windows WASAPI : <output>" device.
export const AUDIO_DEVICE_FILE = path.join(LIVECODING, "audio_device.txt");
export const DEFAULT_AUDIO_DEVICE = process.env.TIDAL_AUDIO_DEVICE ?? "System default";

// Saved jams, recordings, and the sample library (for the dashboard browser).
export const SETS_DIR = path.join(LIVECODING, "sets");
export const RECORDINGS_DIR = path.join(LIVECODING, "recordings");
// Dirt-Samples quark (per-user). Uses %LOCALAPPDATA% so it isn't tied to one username.
export const DIRT_SAMPLES_DIR = process.env.TIDAL_DIRT_SAMPLES
  ?? path.join(
    process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "C:\\Users\\Default", "AppData", "Local"),
    "SuperCollider", "downloaded-quarks", "Dirt-Samples",
  );
