import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { diagnostic, FrameReader, type Frame, type EvalResult, type OutputStream } from "./protocol.js";
import { captureOwnedIdentity, checkOwnershipSupport, stopManagedTree, type ProcessIdentity } from "./owned-process.js";

export interface DriverFault { kind: "process" | "timeout" | "interpreter"; message: string; operationId?: string; observedDuringOperationId?: string }

// One driver owns one ChildProcess for its lifetime. Queued work and stale output
// cannot cross engine generations. Startup markers are separate from command ACKs.
export class ProcDriver extends EventEmitter {
  protected proc: ChildProcess | null = null;
  private buf = "";
  private lines = { stdout: "", stderr: "" };
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: { reader: FrameReader; id: string; resolve: (r: EvalResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
  private unavailable: Error | null = null;
  private stopping = false;
  private identity?: ProcessIdentity;
  readonly generation = randomUUID();
  exited = false;
  exitCode: number | null = null;
  startedAt: string | null = null;
  get ownershipIdentity(): ProcessIdentity | undefined { return this.identity && { ...this.identity }; }
  get health() { return { pid: this.pid ?? null, startedAt: this.startedAt, generation: this.generation, alive: !!this.pid && !this.exited, usable: this.running, exited: this.exited, exitCode: this.exitCode, error: this.stopping ? null : this.unavailable?.message ?? null }; }

  constructor(protected exe: string, protected args: string[] = [], protected env: NodeJS.ProcessEnv = process.env, protected spawnOpts: Record<string, unknown> = {}, private ownTree = false) { super(); }

  start(): void {
    if (this.proc || this.unavailable) throw new Error("Driver already started or stopped; create a new generation.");
    if (this.ownTree) {
      try { checkOwnershipSupport(); }
      catch (e) { throw new Error("Managed audio requires verified process ownership (on Linux: Python 3.9+ with pidfds). " + String(e)); }
    }
    this.proc = spawn(this.exe, this.args, { env: this.env, ...this.spawnOpts, ...(this.ownTree && process.platform === "linux" ? { detached: true } : {}), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.on("spawn", () => {
      this.startedAt = new Date().toISOString();
      if (this.ownTree && this.proc?.pid && !this.exited) {
        try { this.identity = captureOwnedIdentity(this.proc.pid); }
        catch (e) { this.fail("process", `Cannot verify interpreter ownership: ${String(e)}`); this.proc.kill(); }
      }
    });
    for (const stream of ["stdout", "stderr"] as const) {
      const decoder = new StringDecoder("utf8");
      this.proc[stream]!.on("data", (d: Buffer) => this.receive(stream, decoder.write(d)));
      this.proc[stream]!.on("end", () => this.receive(stream, decoder.end()));
    }
    this.proc.on("error", (e) => this.fail("process", `Cannot start ${this.exe}: ${e.message}`));
    this.proc.stdin!.on("error", (e) => this.fail("process", `Interpreter input failed: ${e.message}`));
    this.proc.on("exit", (code, signal) => {
      this.exited = true; this.exitCode = code;
      this.fail("process", `${this.exe} exited (${signal ?? code})`);
    });
  }

  private receive(stream: OutputStream, text: string): void {
    this.buf = (this.buf + text).slice(-256 * 1024);
    this.emit("output", text);
    this.emit("log", { stream, text });
    this.lines[stream] += text;
    let end: number;
    while ((end = this.lines[stream].indexOf("\n")) >= 0) {
      const line = this.lines[stream].slice(0, end).replace(/\r$/, "");
      this.lines[stream] = this.lines[stream].slice(end + 1);
      const p = this.pending;
      p?.reader.line(stream, line);
      if (line.trim() === "ABX_AUDIO_EXIT" || /server .*exited|server not running/i.test(line) && !line.includes(".compile;")) {
        this.fail("process", "Audio server stopped: " + line.trim());
      }
      if (diagnostic.test(line) && !line.includes('.compile;') && !line.includes('System.IO.')) {
        // A background Tidal/SC task can fail while an unrelated command is being
        // evaluated. Record observation context without claiming causal identity.
        this.emit("fault", { kind: "interpreter", message: line.trim().slice(0, 1000), observedDuringOperationId: p?.id } satisfies DriverFault);
      }
      if (p?.reader.complete && this.pending === p) {
        clearTimeout(p.timer); this.pending = undefined;
        try { p.resolve(p.reader.result(p.id)); } catch (e) { p.reject(e as Error); }
      }
    }
    if (this.lines[stream].length > 256 * 1024) this.fail("process", "Interpreter output exceeded the line limit.");
  }

  private fail(kind: DriverFault["kind"], message: string): void {
    this.unavailable ??= new Error(message);
    const p = this.pending;
    if (p) { clearTimeout(p.timer); this.pending = undefined; p.reject(new Error(message)); }
    if (!this.stopping) this.emit("fault", { kind, message, operationId: p?.id } satisfies DriverFault);
    this.emit("unavailable", this.unavailable);
  }

  protected writeRaw(s: string): void {
    if (this.unavailable) throw this.unavailable;
    if (!this.proc?.stdin || this.exited) throw new Error(`${this.exe}: not running`);
    this.proc.stdin.write(Buffer.from(s, "utf8"));
  }

  protected execute(build: (token: string) => Frame, operationId: string = randomUUID(), timeoutMs = 10000): Promise<EvalResult> {
    const run = () => new Promise<EvalResult>((resolve, reject) => {
      if (this.unavailable) { reject(this.unavailable); return; }
      const frame = build(`ABX_${this.generation.replace(/-/g, "")}_${randomUUID().replace(/-/g, "")}`);
      const timer = setTimeout(() => this.fail("timeout", `Interpreter timed out for operation ${operationId}; outcome unknown. Reset before sending more commands.`), timeoutMs);
      this.pending = { reader: new FrameReader(frame), id: operationId, resolve, reject, timer };
      try { this.writeRaw(frame.script); } catch (e) { clearTimeout(timer); this.pending = undefined; reject(e); }
    });
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  waitFor(marker: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.off("output", check); this.off("unavailable", failed); };
      const check = () => { if (this.buf.includes(marker)) { cleanup(); resolve(); } };
      const failed = (e: Error) => { cleanup(); reject(e); };
      const timer = setTimeout(() => failed(new Error(`Timeout waiting for startup marker ${marker}`)), timeoutMs);
      this.on("output", check); this.on("unavailable", failed);
      if (this.unavailable) failed(this.unavailable); else check();
    });
  }

  tail(n = 1500): string { return this.buf.slice(-n); }
  get pid(): number | undefined { return this.proc?.pid; }
  get running(): boolean { return !!this.proc?.pid && !this.exited && !this.unavailable; }

  stop(): void {
    this.stopping = true;
    this.fail("process", "Interpreter stopped; operation cancelled.");
    try {
      if (this.identity && (!this.exited || process.platform === "linux")) stopManagedTree(this.identity);
    } finally {
      // Kill only the direct child handle. Descendants require separate ownership proof.
      if (this.proc && !this.exited && !(this.ownTree && process.platform === "linux")) this.proc.kill();
    }
  }
}
