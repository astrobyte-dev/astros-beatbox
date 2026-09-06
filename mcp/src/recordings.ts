import { randomUUID, createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "./project-storage.js";

const phases = z.enum(["preparing", "recording", "finalizing", "ready", "failed", "interrupted", "missing"]);
const measurements = z.object({ bytes: z.number(), frames: z.number(), sampleRate: z.number(), channels: z.number(), duration: z.number(), peak: z.number(), rms: z.number(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const entrySchema = z.object({ id: z.string().uuid(), name: z.string().max(200), projectId: z.string(), createdAt: z.string(), finishedAt: z.string().optional(), state: phases, error: z.string().optional(), audio: measurements.optional() }).strict();
export type RecordingEntry = z.infer<typeof entrySchema>;
export type WavMeasurements = z.infer<typeof measurements>;

// Stream PCM samples: large takes do not need to fit in memory. A RIFF label alone
// is insufficient: require finalized sizes, format, alignment and a data chunk.
export function validateWav(file: string): WavMeasurements {
  const bytes = statSync(file).size, fd = openSync(file, "r");
  const read = (length: number, offset: number) => { const b = Buffer.alloc(length); if (readSync(fd, b, 0, length, offset) !== length) throw new Error("Truncated WAV"); return b; };
  try {
    const head = read(12, 0);
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE" || head.readUInt32LE(4) + 8 !== bytes) throw new Error("WAV finalization could not be verified");
    let channels = 0, sampleRate = 0, align = 0, data = 0, length = 0;
    for (let offset = 12; offset + 8 <= bytes;) {
      const h = read(8, offset), size = h.readUInt32LE(4), tag = h.toString("ascii", 0, 4);
      if (offset + 8 + size > bytes) throw new Error("Invalid WAV chunk size");
      if (tag === "fmt ") {
        if (size < 16) throw new Error("Invalid WAV format");
        const fmt = read(16, offset + 8);
        channels = fmt.readUInt16LE(2); sampleRate = fmt.readUInt32LE(4); align = fmt.readUInt16LE(12);
        if (fmt.readUInt16LE(0) !== 1 || fmt.readUInt16LE(14) !== 16 || channels !== 2 || align !== channels * 2 || !sampleRate || fmt.readUInt32LE(8) !== sampleRate * align) throw new Error("Expected stereo PCM16 WAV");
      }
      if (tag === "data") { data = offset + 8; length = size; }
      offset += 8 + size + (size % 2);
    }
    if (!channels || !data || !length || length % align) throw new Error("WAV has no complete audio frames");
    let peak = 0, squares = 0; const hash = createHash("sha256");
    for (let offset = 0; offset < length;) {
      const b = read(Math.min(65536, length - offset), data + offset);
      hash.update(b);
      for (let i = 0; i < b.length; i += 2) { const v = b.readInt16LE(i); peak = Math.max(peak, Math.abs(v)); squares += v * v; }
      offset += b.length;
    }
    return { bytes, frames: length / align, sampleRate, channels, duration: length / align / sampleRate, peak, rms: Math.sqrt(squares / (length / 2)), sha256: hash.digest("hex") };
  } finally { closeSync(fd); }
}

// One atomic sidecar per take; independent of project undo and recovery. Startup
// never promotes an unfinished file to ready, even if a plausible WAV remains.
export class RecordingCatalog {
  private entries = new Map<string, RecordingEntry>();
  private checked = new Map<string, { stamp: string; error: string | null }>();
  warning: string | null = null;
  constructor(readonly directory: string) {
    if (!existsSync(directory)) return;
    try {
      for (const name of readdirSync(directory).filter(n => /^[a-f0-9-]{36}\.recording\.json$/.test(n))) {
        try {
          const file = path.join(directory, name);
          if (statSync(file).size > 16384) throw new Error("Catalog entry too large");
          const e = entrySchema.parse(JSON.parse(readFileSync(file, "utf8")));
          if (name !== e.id + ".recording.json") throw new Error("Catalog identity mismatch");
          this.entries.set(e.id, e);
          if (["preparing", "recording", "finalizing"].includes(e.state)) this.update(e.id, { state: "interrupted", error: "Runtime ended before finalization was confirmed. This take is not ready." });
        } catch (e) { this.warning = "An unreadable recording catalog entry was retained: " + String(e); }
      }
    } catch (e) { this.warning = "Recording catalog unavailable: " + String(e); }
  }
  file(id: string): string {
    if (!this.entries.has(id)) throw new Error("Unknown recording");
    return path.join(this.directory, "jam-" + id + ".wav");
  }
  create(projectId: string, name: string): RecordingEntry {
    const take = [...this.entries.values()].filter(e => e.projectId === projectId).length + 1;
    const e: RecordingEntry = { id: randomUUID(), projectId, name: (name || "Untitled") + " · Take " + take, createdAt: new Date().toISOString(), state: "preparing" };
    this.persist(e); return e;
  }
  private persist(e: RecordingEntry) { atomicWrite(path.join(this.directory, e.id + ".recording.json"), JSON.stringify(e)); this.entries.set(e.id, e); }
  update(id: string, patch: Partial<RecordingEntry>): RecordingEntry {
    const old = this.entries.get(id); if (!old) throw new Error("Unknown recording");
    const e = entrySchema.parse({ ...old, ...patch }); this.persist(e); return e;
  }
  fail(id: string, error: string, state: "failed" | "interrupted" = "failed") {
    const old = this.entries.get(id); if (!old) return;
    const entry = { ...old, state, error };
    // Even a full disk must not leave the live UI claiming "finalizing" forever.
    this.entries.set(id, entry);
    try { this.persist(entry); } catch (e) { this.warning = "Recording status could not be saved: " + String(e); }
  }
  private check(e: RecordingEntry): string | null {
    try {
      const file = this.file(e.id), s = statSync(file), stamp = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
      const cached = this.checked.get(e.id); if (cached?.stamp === stamp) return cached.error;
      let error: string | null = null;
      try { if (JSON.stringify(validateWav(file)) !== JSON.stringify(e.audio)) error = "Recording file changed since finalization."; }
      catch { error = "Recording file is invalid or incomplete."; }
      this.checked.set(e.id, { stamp, error }); return error;
    } catch { return "Recording file is missing."; }
  }
  get(id: string): RecordingEntry | undefined { return this.list().find(e => e.id === id); }
  list(): RecordingEntry[] {
    return [...this.entries.values()].map(e => {
      if (e.state === "ready") {
        const error = this.check(e); if (error) return { ...e, state: "missing" as const, error };
      }
      return structuredClone(e);
    }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  retrieve(id: string): string {
    const e = this.get(id); if (e?.state !== "ready") throw new Error(e?.error ?? "Recording is not ready");
    return this.file(id);
  }
}
