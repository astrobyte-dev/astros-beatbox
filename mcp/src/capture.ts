import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { atomicWrite } from "./project-storage.js";
import { analyze, safeAudioPath, type UserAudioLibrary } from "./user-audio.js";
import type { CommandEngine } from "./application.js";
import { scStr } from "./track.js";

const schema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), createdAt: z.string().datetime(), state: z.enum(["preparing", "recording", "finalizing", "ready", "kept", "discarded", "failed", "interrupted"]), generation: z.number().int(), error: z.string().optional(), duration: z.number().finite().positive().max(900).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), assetId: z.string().regex(/^audio_[a-f0-9]{64}$/).optional() }).strict().superRefine((t, ctx) => {
  if (["ready", "kept"].includes(t.state) && (!t.duration || !t.sha256) || t.state === "kept" && t.assetId !== "audio_" + t.sha256) ctx.addIssue({ code: "custom", message: "Finalized capture metadata is incomplete" });
});
export type CaptureTake = z.infer<typeof schema>;
export interface InputConfiguration { enabled: boolean; device: string; channel: number }
export const INPUT_SYNTHS = `SynthDef(\\abxInput, { |bus, channel = 0, inputGain = 1| var sig = SoundIn.ar(channel) * Lag.kr(inputGain, 0.02); Out.ar(bus, sig); SendReply.kr(Impulse.kr(10), '/abxInputLevel', A2K.kr(Peak.ar(sig, Impulse.ar(10)))); }).add; SynthDef(\\abxInputMonitor, { |bus, gate = 1| var sig = In.ar(bus, 1); Out.ar(0, Limiter.ar(sig ! 2, 0.7) * EnvGen.kr(Env.asr(0.02, 0.5, 0.03), gate, doneAction: 2)) }).add; SynthDef(\\abxInputWriter, { |buf, bus| Line.kr(0, 1, 300, doneAction: 2); DiskOut.ar(buf, In.ar(bus, 1)) }).add; s.sync; ~abxInputBus = Bus.audio(s, 1); ~abxInputGroup = Group.tail(RootNode(s)); ~abxInputNode = Synth.head(~abxInputGroup, \\abxInput, [\\bus, ~abxInputBus.index]); OSCdef(\\abxInputForward, { |msg| NetAddr("127.0.0.1", __ABX_INPUT_PORT__).sendRaw("INPUT " ++ msg[3].abs.round(0.001)) }, '/abxInputLevel'); s.sync;`;
export const FINISH_CAPTURE = `if(~abxInputWriter.notNil) { ~abxInputWriter.free; s.sync; ~abxInputWriter = nil }; if(~abxInputBuffer.notNil) { ~abxInputBuffer.close; s.sync; ~abxInputBuffer.free; s.sync; ~abxInputBuffer = nil };`;

// External input has a separate node, file directory, catalogue and lifecycle from
// performance recording. Only Keep publishes to the normal user-audio library.
export class Capture {
  private takes = new Map<string, CaptureTake>();
  private active: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private inputGeneration = -1;
  private uncertain = false;
  private monitored = false;
  private gain = 1;
  warning: string | null = null;
  constructor(private engine: CommandEngine, readonly directory: string, private library: UserAudioLibrary, private expire: (takeId: string) => void, private meterPort = 0) {
    try { safeAudioPath(directory, false); mkdirSync(directory, { recursive: true }); } catch (e) { this.warning = "Audio storage unavailable: " + String(e); return; }
    for (const name of readdirSync(directory).filter(n => /^[a-f0-9-]{36}\.capture\.json$/.test(n)).slice(0, 4096)) {
      try {
        const f = safeAudioPath(path.join(directory, name)); if (statSync(f).size > 8192) throw new Error("Invalid capture catalogue");
        const t = schema.parse(JSON.parse(readFileSync(f, "utf8"))); if (name !== t.id + ".capture.json") throw new Error("Capture identity mismatch");
        this.takes.set(t.id, t);
        if (["preparing", "recording", "finalizing"].includes(t.state)) this.save({ ...t, state: "interrupted", error: "Runtime ended before finalization was confirmed" });
      } catch (e) { this.warning = String(e); }
    }
  }
  private save(t: CaptureTake) { schema.parse(t); safeAudioPath(path.join(this.directory, t.id + ".capture.json"), false); atomicWrite(path.join(this.directory, t.id + ".capture.json"), JSON.stringify(t)); this.takes.set(t.id, structuredClone(t)); }
  private fail(t: CaptureTake, e: unknown) {
    const failed: CaptureTake = { ...t, state: "failed", error: String(e) };
    this.takes.set(t.id, failed);
    try { this.save(failed); } catch (error) { this.warning = "Capture failure status could not be saved: " + String(error); }
  }
  file(id: string) { if (!this.takes.has(id)) throw new Error("Unknown capture"); return path.join(this.directory, id + ".wav"); }
  get(id: string) { const t = this.takes.get(id); if (!t) throw new Error("Unknown capture"); return structuredClone(t); }
  snapshot() {
    if (this.inputGeneration !== this.engine.generation || !this.engine.running) {
      this.monitored = false;
      if (this.active) { const t = this.get(this.active); this.active = null; clearTimeout(this.timer); try { this.save({ ...t, state: "interrupted", error: "Audio engine ended before capture finalization" }); } catch (e) { this.warning = String(e); } }
    }
    for (const t of this.takes.values()) if (t.state === "ready" && !existsSync(this.file(t.id))) {
      try { this.save({ ...t, state: "failed", error: "Capture file is missing" }); } catch (e) { this.warning = String(e); }
    }
    return { activeId: this.active, inputReady: this.inputGeneration === this.engine.generation && this.engine.running && this.engine.state === "ready", monitor: this.monitored, gain: this.gain, warning: this.warning, takes: [...this.takes.values()].map(t => structuredClone(t)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) };
  }
  async prepare(channel: number, id: string) {
    if (this.active) throw new Error("Stop capture before changing input");
    const g = this.engine.generation;
    await this.engine.sclang.evalRoutine(INPUT_SYNTHS.replace("__ABX_INPUT_PORT__", String(this.meterPort)) + `~abxInputNode.set(\\channel, ${channel}); s.sync;`, id);
    this.engine.assertGeneration(g); this.inputGeneration = g; this.monitored = false; this.gain = 1; this.uncertain = false;
  }
  async controls(gain: number, monitor: boolean, id: string) {
    if (!this.snapshot().inputReady || this.uncertain) throw new Error("Prepare input again before monitoring or capturing");
    const g = this.engine.generation;
    await this.engine.sclang.evalRoutine(`~abxInputNode.set(\\inputGain, ${gain}); ${monitor ? "if(~abxInputMonitor.isNil) { ~abxInputMonitor = Synth.tail(~abxInputGroup, \\abxInputMonitor, [\\bus, ~abxInputBus.index]) };" : "if(~abxInputMonitor.notNil) { ~abxInputMonitor.set(\\gate, 0); ~abxInputMonitor = nil };"} s.sync;`, id);
    this.engine.assertGeneration(g); this.gain = gain; this.monitored = monitor;
  }
  async start(name: string, id: string) {
    if (!this.snapshot().inputReady || this.uncertain) throw new Error("Prepare an audio input first");
    if (this.active) throw new Error("Capture is already recording");
    if (this.takes.size >= 4096) throw new Error("Capture catalogue limit reached");
    const t: CaptureTake = { id: randomUUID(), name, createdAt: new Date().toISOString(), state: "preparing", generation: this.engine.generation };
    try {
      this.save(t); this.active = t.id;
      const file = safeAudioPath(this.file(t.id), false);
      await this.engine.sclang.evalRoutine(`~abxInputBuffer = Buffer.alloc(s, 65536, 1); s.sync; ~abxInputBuffer.write("${scStr(file.replace(/\\/g, "/"))}", "wav", "int16", 0, 0, true); s.sync; ~abxInputWriter = Synth.tail(~abxInputGroup, \\abxInputWriter, [\\buf, ~abxInputBuffer.bufnum, \\bus, ~abxInputBus.index]); s.sync;`, id);
      this.engine.assertGeneration(t.generation); this.save({ ...t, state: "recording" });
      this.timer = setTimeout(() => this.expire(t.id), 300000); this.timer.unref();
      return t.id;
    } catch (e) { this.uncertain = true; this.active = null; this.fail(t, e); throw e; }
  }
  async stop(takeId: string, id: string) {
    const t = this.get(takeId);
    if (["ready", "kept"].includes(t.state)) return;
    if (this.active !== takeId || t.state !== "recording") throw new Error("This capture is not recording");
    clearTimeout(this.timer);
    try {
      this.save({ ...t, state: "finalizing" }); this.engine.assertGeneration(t.generation);
      await this.engine.sclang.evalRoutine(FINISH_CAPTURE, id); this.engine.assertGeneration(t.generation);
      const a = await analyze(safeAudioPath(this.file(t.id))); this.engine.assertGeneration(t.generation);
      atomicWrite(path.join(this.directory, t.id + ".wave.json"), JSON.stringify(a.peaks));
      this.save({ ...t, state: "ready", duration: a.duration, sha256: a.sha256 });
    } catch (e) { this.uncertain = true; this.fail(t, e); throw e; }
    finally { this.active = null; }
  }
  async keep(takeId: string) {
    const t = this.get(takeId);
    if (t.state === "kept") { await this.library.verify(t.assetId!); return this.library.get(t.assetId!); }
    if (t.state !== "ready") throw new Error("Only a finalized ready capture can be kept");
    const file = await this.previewFile(t.id);
    const result = await this.library.importStream(createReadStream(file), t.name.replace(/[\\/\x00-\x1f]/g, "-") + ".wav", "captured", "audio_" + t.sha256);
    if (!result.duplicate) this.library.update(result.entry.id, result.entry.revision, { ...result.entry.details, name: t.name });
    this.save({ ...t, state: "kept", assetId: result.entry.id });
    try { await rm(this.file(t.id), { force: true }); } catch (e) { this.warning = "Kept sound is safe; temporary capture cleanup failed: " + String(e); }
    return this.library.get(result.entry.id);
  }
  async discard(takeId: string) {
    const t = this.get(takeId);
    if (this.active === takeId || t.state === "kept") throw new Error("Stop capture before discarding; kept sounds belong to My Sounds");
    this.save({ ...t, state: "discarded" });
    await rm(this.file(t.id), { force: true }); await rm(path.join(this.directory, t.id + ".wave.json"), { force: true });
  }
  async previewFile(takeId: string) {
    const t = this.get(takeId); if (t.state !== "ready") throw new Error("Capture is not ready");
    const file = safeAudioPath(this.file(t.id)), a = await analyze(file); if (a.sha256 !== t.sha256) throw new Error("Capture file changed"); return file;
  }
  waveform(takeId: string) { this.get(takeId); const f = safeAudioPath(path.join(this.directory, takeId + ".wave.json")); if (statSync(f).size > 16384) throw new Error("Invalid waveform"); return z.array(z.number().finite().min(0).max(1)).length(512).parse(JSON.parse(readFileSync(f, "utf8"))); }
  async beforeReset(id: string) {
    try { if (this.active) await this.stop(this.active, id); } catch (e) { this.warning = "Capture could not finalize before reset: " + String(e); }
    try { if (this.snapshot().inputReady && !this.uncertain) await this.controls(this.gain, false, id); } catch (e) { this.warning = "Monitor shutdown was not confirmed before audio reset: " + String(e); }
    clearTimeout(this.timer);
  }
}
