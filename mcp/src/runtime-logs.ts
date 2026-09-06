export type LogSource = "runtime" | "studio" | "mcp" | "tidal" | "supercollider" | "audio" | "telemetry" | "recording";
export interface LogEntry { id: number; at: string; source: LogSource; level: "info" | "error" | "diagnostic"; message: string; generation?: number }

// Diagnostics only: never record requests, environment maps, argv or echoed code.
export function sanitizeLog(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\b(?:Bearer\s+)[\w.\-]+/gi, "Bearer [redacted]")
    .replace(/\b(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\bsk-[\w-]+/g, "[redacted]")
    .replace(/[A-Z]:[\\/]Users[\\/][^\\/\s]+/gi, "[user]")
    .replace(/[\x00-\x08\x0b-\x1f]/g, "").slice(0, 2048);
}
export class RuntimeLogs {
  private entries: LogEntry[] = [];
  private sequence = 0;
  private fragments = new Map<string, string>();
  private fragmentGenerations = new Map<string, number>();
  constructor(readonly capacity = 800) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new Error("Invalid log capacity"); }
  add(source: LogSource, message: string, level: LogEntry["level"] = "info", generation?: number) {
    const clean = sanitizeLog(message).trim();
    if (!clean) return;
    this.entries.push({ id: ++this.sequence, at: new Date().toISOString(), source, level, message: clean, generation });
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }
  child(source: LogSource, stream: string, text: string, generation: number) {
    const key = source + stream;
    const prior = this.fragmentGenerations.get(key) === generation ? this.fragments.get(key) ?? "" : "";
    this.fragmentGenerations.set(key, generation);
    const lines = (prior + text).split(/\r?\n/);
    this.fragments.set(key, lines.pop()!.slice(-4096));
    for (const line of lines) {
      if (/ABX_|\.compile;|System\.IO\.|^\s*(?:tidal>|->|\^)/.test(line)) continue;
      this.add(source, line, /error|failed|exception/i.test(line) ? "error" : "diagnostic", generation);
    }
  }
  read(source?: string, after = 0, diagnostic = false): LogEntry[] {
    return this.entries.filter(e => (!source || source === "all" || e.source === source) && e.id > after && (diagnostic || e.level !== "diagnostic")).map(e => ({ ...e }));
  }
  get lastId() { return this.sequence; }
}
