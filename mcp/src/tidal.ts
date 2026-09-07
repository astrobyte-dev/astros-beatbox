import { ProcDriver } from "./proc.js";
import { tidalFrame } from "./protocol.js";
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
  if (CABAL_DIR) env.CABAL_DIR = CABAL_DIR;
  return env;
}

// Drives a GHCi instance with TidalCycles loaded (the pattern language).
// ghci is line-based: send each statement newline-terminated. Multi-line blocks
// are wrapped in :{ ... :}. Node's stdin.write emits no BOM, so no lexical errors.
export class Tidal extends ProcDriver {
  constructor() {
    super(GHCI, ["-ghci-script", BOOT_TIDAL], ghciEnv(), {}, true);
  }

  /** Wait until BootTidal.hs has finished loading (tidal> prompt). */
  async waitConnected(timeoutMs = 90000): Promise<void> {
    await this.waitFor(TIDAL_READY, timeoutMs);
    await this.eval("do { abxPrepare silence; _ <- getnow; pure () }", "p3-ready", timeoutMs);
  }

  /** Evaluate Tidal code (single or multi-line). */
  eval(code: string, operationId?: string, timeoutMs?: number) {
    return this.execute((token) => tidalFrame(code, token), operationId, timeoutMs);
  }

  async clock(): Promise<number> {
    const result = await this.eval('do { now <- getnow; putStrLn ("ABX_CLOCK " ++ show (fromRational now :: Double)) }');
    const { parseCycle } = await import("./performance.js");
    return parseCycle(result.output, "ABX_CLOCK");
  }

  hush(operationId?: string) {
    return this.eval("hush", operationId);
  }
}
