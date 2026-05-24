import { ProcDriver } from "./proc.js";
import { GHCI, BOOT_TIDAL, GHCI_PATH, CABAL_DIR, TIDAL_READY } from "./config.js";

// Build a child env with exactly one PATH key. On Windows, spreading
// {...process.env, PATH} can leave a stale lowercase "Path" that the OS honors
// instead, so ghci would miss mingw64 and fail to load tidal-link's C++ DLLs.
function ghciEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase() === "path") continue; // drop every case-variant
    env[k] = v;
  }
  env.PATH = GHCI_PATH;
  env.CABAL_DIR = CABAL_DIR;
  return env;
}

// Drives a GHCi instance with TidalCycles loaded (the pattern language).
// ghci is line-based: send each statement newline-terminated. Multi-line blocks
// are wrapped in :{ ... :}. Node's stdin.write emits no BOM, so no lexical errors.
export class Tidal extends ProcDriver {
  constructor() {
    super(GHCI, ["-ghci-script", BOOT_TIDAL], ghciEnv());
  }

  /** Wait until BootTidal.hs has finished loading (tidal> prompt). */
  async waitConnected(timeoutMs = 90000): Promise<void> {
    await this.waitFor(TIDAL_READY, timeoutMs);
  }

  /** Evaluate Tidal code (single or multi-line). */
  eval(code: string): void {
    const trimmed = code.replace(/\r\n/g, "\n").trim();
    if (trimmed.includes("\n")) {
      this.writeRaw(":{\n" + trimmed + "\n:}\n");
    } else {
      this.writeRaw(trimmed + "\n");
    }
  }

  hush(): void {
    this.writeRaw("hush\n");
  }
}
