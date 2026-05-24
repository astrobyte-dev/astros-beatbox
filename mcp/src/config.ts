import path from "node:path";

// Absolute paths for the rig (proven 2026-05-24).
export const SCLANG = "C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe";
export const GHCI = "C:\\ghcup\\bin\\ghci.exe";

export const LIVECODING = "C:\\Users\\thr3e\\livecoding";
export const SUPERDIRT_STARTUP = path.join(LIVECODING, "sc", "superdirt_startup.scd");
export const BOOT_TIDAL = path.join(LIVECODING, "tidal", "BootTidal.hs");

// ghci needs ghcup bin (its own runtime) + mingw64 (tidal-link C++ deps) on PATH,
// plus CABAL_DIR so it resolves the installed tidal library env.
export const GHCI_PATH = ["C:\\ghcup\\bin", "C:\\ghcup\\msys64\\mingw64\\bin", process.env.PATH ?? ""].join(path.delimiter);
export const CABAL_DIR = "C:\\cabal";

// readiness markers printed by each engine
// Echo-proof marker (sclang echoes piped stdin, so the marker must NOT appear
// verbatim in superdirt_startup.scd; it's assembled there at runtime).
export const SUPERDIRT_READY = "SDIRT_RDY_7731";
export const SC_WELCOME = "Welcome to SuperCollider";
// BootTidal's last action is to set the prompt to "tidal>" -> reliable "loaded" signal.
// (Don't use "Connected to SuperDirt": that's a handshake reply that doesn't always print,
// and isn't required for d1 to send OSC and make sound.)
export const TIDAL_READY = "tidal>";

// sclang interactive eval trigger: send  <code>\n <0x0C>\n
export const FORM_FEED = "\x0c";

// Web dashboard (HTTP) + the UDP port the SuperDirt meter synth forwards levels to.
export const DASHBOARD_PORT = Number(process.env.TIDAL_DASH_PORT ?? 3737);
export const METER_UDP_PORT = Number(process.env.TIDAL_METER_PORT ?? 57199);
// Dashboard HTML served from a file (read fresh per request -> edit + browser
// refresh, no MCP reload needed for UI tweaks).
export const DASHBOARD_HTML = "C:\\Users\\thr3e\\livecoding\\mcp\\dashboard.html";

// Audio output device. The startup .scd reads the device name from this file at
// boot (empty/absent = DEFAULT; the sentinel "SYSTEM" = let the OS pick). The
// dashboard writes it + reboots to switch speakers <-> headphones.
export const AUDIO_DEVICE_FILE = path.join(LIVECODING, "audio_device.txt");
export const DEFAULT_AUDIO_DEVICE = "Windows WASAPI : Speakers (Logitech G560 Gaming Speaker)";

// Saved jams, recordings, and the sample library (for the dashboard browser).
export const SETS_DIR = path.join(LIVECODING, "sets");
export const RECORDINGS_DIR = path.join(LIVECODING, "recordings");
export const DIRT_SAMPLES_DIR = "C:\\Users\\thr3e\\AppData\\Local\\SuperCollider\\downloaded-quarks\\Dirt-Samples";
