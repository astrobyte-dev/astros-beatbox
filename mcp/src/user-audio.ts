import { createReadStream, createWriteStream, lstatSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { rename, open, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "./project-storage.js";
import { AUDIO_LIMIT, LIBRARY_LIMIT, audioMetadataSchema, libraryDetailsSchema, type LibraryDetails } from "./sampling.js";
import type { Asset } from "./sound-library.js";
import type { analyzeAudio } from "./audio-worker.js";

const entrySchema = z.object({ id: z.string().regex(/^audio_[a-f0-9]{64}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), origin: z.enum(["user", "captured"]), metadata: audioMetadataSchema, details: libraryDetailsSchema, revision: z.number().int().nonnegative() }).strict();
export type UserAudioEntry = z.infer<typeof entrySchema>;
type Analysis = ReturnType<typeof analyzeAudio>;
export function analyze(file: string): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./audio-worker.js", import.meta.url), { workerData: { file } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Audio analysis exceeded 60 seconds")); }, 60000);
    worker.once("message", result => { clearTimeout(timer); result.ok ? resolve(result.audio) : reject(new Error(result.error)); });
    worker.once("error", e => { clearTimeout(timer); reject(e); });
    worker.once("exit", code => { clearTimeout(timer); if (code) reject(new Error("Audio worker stopped")); });
  });
}
// Reject links at every existing component, including parent directories. No glob,
// directory recursion or executable metadata is accepted by import/relink.
export function safeAudioPath(file: string, mustExist = true): string {
  if (!path.isAbsolute(file) || /[\x00-\x1f]/.test(file) || file.split(/[\\/]/).includes("..")) throw new Error("Use an absolute, non-traversing file path");
  const resolved = path.resolve(file), root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep)) {
    current = path.join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links are not imported"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" && !mustExist) continue; throw e; }
  }
  if (mustExist && !statSync(resolved).isFile()) throw new Error("Select an individual audio file");
  return resolved;
}
export class UserAudioLibrary {
  private entries = new Map<string, UserAudioEntry>();
  private stamps = new Map<string, string>();
  private invalid = new Map<string, string>();
  warning: string | null = null;
  progress = { busy: false, name: "", bytes: 0, phase: "idle" };
  constructor(readonly directory: string) {
    try { safeAudioPath(directory, false); mkdirSync(directory, { recursive: true }); } catch (e) { this.warning = "Audio storage unavailable: " + String(e); return; }
    for (const f of readdirSync(directory).filter(f => /^audio_[a-f0-9]{64}\.json$/.test(f)).slice(0, LIBRARY_LIMIT)) {
      try {
        const file = safeAudioPath(path.join(directory, f));
        if (statSync(file).size > 16384) throw new Error("Large library entry");
        const e = entrySchema.parse(JSON.parse(readFileSync(file, "utf8")));
        if (f !== e.id + ".json" || e.id !== "audio_" + e.sha256) throw new Error("Library identity mismatch");
        this.entries.set(e.id, e);
      } catch (e) { this.warning = "Unreadable library entry retained: " + String(e); }
    }
  }
  file(id: string) { if (!/^audio_[a-f0-9]{64}$/.test(id)) throw new Error("Invalid audio identity"); return path.join(this.directory, id + ".wav"); }
  get(id: string) { const e = this.entries.get(id); if (!e) throw new Error("Unknown user sound"); return structuredClone(e); }
  status(id: string): "available" | "missing" {
    try { const e = this.get(id), f = safeAudioPath(this.file(id)); const s = statSync(f); return s.size === e.metadata.bytes && this.invalid.get(id) !== `${s.size}:${s.mtimeMs}:${s.ctimeMs}` ? "available" : "missing"; } catch { return "missing"; }
  }
  list() { return [...this.entries.values()].map(e => ({ ...structuredClone(e), status: this.status(e.id) })).sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt)); }
  asset(id: string): Asset {
    const e = this.get(id), name = "abx_" + e.sha256;
    return { id, kind: "sample", name, reference: name, index: 0, source: { library: "Beatbox", origin: e.origin, file: "audio/" + id + ".wav", sha256: e.sha256 }, audio: e.metadata };
  }
  async verify(id: string) {
    const e = this.get(id), f = safeAudioPath(this.file(id)), s = statSync(f), stamp = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    if (this.stamps.get(id) !== stamp) {
      try { const a = await analyze(f); if (a.sha256 !== e.sha256) throw new Error("Sound content changed; relink the original WAV"); }
      catch (e) { this.invalid.set(id, stamp); throw e; }
      this.invalid.delete(id); this.stamps.set(id, stamp); if (this.stamps.size > 128) this.stamps.delete(this.stamps.keys().next().value!);
    }
    return f;
  }
  waveform(id: string) { this.get(id); const f = safeAudioPath(path.join(this.directory, id + ".wave.json")); if (statSync(f).size > 16384) throw new Error("Invalid waveform cache"); return z.array(z.number().finite().min(0).max(1)).length(512).parse(JSON.parse(readFileSync(f, "utf8"))); }
  update(id: string, revision: number, details: LibraryDetails) {
    const e = this.get(id); if (e.revision !== revision) throw new Error("Library sound changed; refresh before editing");
    e.details = libraryDetailsSchema.parse(details); e.revision++; this.persist(e); return e;
  }
  private persist(e: UserAudioEntry) { safeAudioPath(path.join(this.directory, e.id + ".json"), false); atomicWrite(path.join(this.directory, e.id + ".json"), JSON.stringify(entrySchema.parse(e))); this.entries.set(e.id, e); }
  async importFile(file: string, origin: "user" | "captured" = "user", expectedId?: string) {
    file = safeAudioPath(file);
    if (statSync(file).size > AUDIO_LIMIT) throw new Error("Sound exceeds 256 MiB");
    if (!/\.wav$/i.test(file) || path.basename(file).startsWith(".")) throw new Error("Choose a visible .wav file");
    const stream = createReadStream(file); stream.on("error", () => {});
    return this.importStream(stream, path.basename(file), origin, expectedId);
  }
  async importStream(stream: Readable, originalName: string, origin: "user" | "captured" = "user", expectedId?: string) {
    stream.on("error", () => {}); // early rejection must also observe asynchronous file-open errors
    if (this.progress.busy) { stream.destroy(); throw new Error("An import is in progress; wait for it to finish"); }
    if (originalName.length > 255 || !/^[^/\\\x00-\x1f]{1,255}\.wav$/i.test(originalName) || originalName.startsWith(".")) { stream.destroy(); throw new Error("Choose a visible .wav file; PCM16 mono/stereo supported"); }
    if (this.entries.size >= LIBRARY_LIMIT && !expectedId) { stream.destroy(); throw new Error("Library limit is 4096 sounds"); }
    safeAudioPath(this.directory, false);
    const temp = path.join(this.directory, randomUUID() + ".import.wav");
    this.progress = { busy: true, name: originalName, bytes: 0, phase: "copying" };
    try {
      const limiter = new Transform({ transform: (chunk, _encoding, callback) => { this.progress.bytes += chunk.length; callback(this.progress.bytes > AUDIO_LIMIT ? new Error("Sound exceeds 256 MiB") : null, chunk); } });
      await pipeline(stream, limiter, createWriteStream(temp, { flags: "wx" }));
      this.progress.phase = "analyzing";
      const audio = await analyze(temp), id = "audio_" + audio.sha256;
      if (expectedId && id !== expectedId) throw new Error("Relink requires the exact original content");
      const old = this.entries.get(id);
      if (!old && this.entries.size >= LIBRARY_LIMIT) throw new Error("Library is full");
      if (old && this.status(id) === "available") {
        try { await this.verify(id); return { entry: this.get(id), duplicate: true }; } catch { /* explicit same-content import repairs a changed copy */ }
      }
      const e: UserAudioEntry = old ?? { id, sha256: audio.sha256, origin, metadata: { originalName, duration: audio.duration, channels: audio.channels, sampleRate: audio.sampleRate, frames: audio.frames, bytes: audio.bytes, createdAt: new Date().toISOString() }, details: { name: originalName.replace(/\.wav$/i, "").slice(0, 120), tags: [], favorite: false, collection: "", classification: "one-shot", bpm: null }, revision: 0 };
      const fd = await open(temp, "r+"); try { await fd.sync(); } finally { await fd.close(); }
      safeAudioPath(this.file(id), false);
      await rename(temp, this.file(id));
      atomicWrite(path.join(this.directory, id + ".wave.json"), JSON.stringify(audio.peaks));
      this.persist(e); this.stamps.delete(id); this.invalid.delete(id);
      return { entry: structuredClone(e), duplicate: !!old };
    } finally { await rm(temp, { force: true }); this.progress = { ...this.progress, busy: false, phase: "idle" }; }
  }
}
