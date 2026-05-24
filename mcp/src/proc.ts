import { spawn, ChildProcess } from "node:child_process";

// Base driver: spawns a child process, captures stdout+stderr into a rolling
// buffer, and lets callers wait for a text marker to appear.
export class ProcDriver {
  protected proc: ChildProcess | null = null;
  private buf = "";
  private static MAX = 256 * 1024;
  exited = false;
  exitCode: number | null = null;

  constructor(
    protected exe: string,
    protected args: string[] = [],
    protected env: NodeJS.ProcessEnv = process.env,
    protected spawnOpts: Record<string, unknown> = {},
  ) {}

  start(): void {
    this.proc = spawn(this.exe, this.args, { env: this.env, stdio: ["pipe", "pipe", "pipe"], ...this.spawnOpts });
    const onData = (d: Buffer) => {
      this.buf += d.toString("utf8");
      if (this.buf.length > ProcDriver.MAX) this.buf = this.buf.slice(-ProcDriver.MAX);
    };
    this.proc.stdout!.on("data", onData);
    this.proc.stderr!.on("data", onData);
    this.proc.on("exit", (code) => { this.exited = true; this.exitCode = code; });
  }

  /** Write raw bytes to stdin (UTF-8, no BOM — unlike .NET StreamWriter). */
  protected writeRaw(s: string): void {
    if (!this.proc?.stdin) throw new Error(`${this.exe}: not started`);
    this.proc.stdin.write(Buffer.from(s, "utf8"));
  }

  /** Resolve when `marker` appears in output; reject on timeout or early exit. */
  waitFor(marker: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.buf.includes(marker)) return resolve();
      const iv = setInterval(() => {
        if (this.buf.includes(marker)) { cleanup(); resolve(); }
        else if (this.exited) { cleanup(); reject(new Error(`${this.exe} exited (code ${this.exitCode}) before "${marker}"`)); }
      }, 150);
      const to = setTimeout(() => { cleanup(); reject(new Error(`timeout (${timeoutMs}ms) waiting for "${marker}"`)); }, timeoutMs);
      const cleanup = () => { clearInterval(iv); clearTimeout(to); };
    });
  }

  /** Last `n` characters of captured output (for surfacing errors). */
  tail(n = 1500): string {
    return this.buf.slice(-n);
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  stop(): void {
    try { this.proc?.kill(); } catch { /* ignore */ }
  }
}
