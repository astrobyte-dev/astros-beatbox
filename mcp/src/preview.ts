import type { CommandEngine } from "./application.js";
import { libraryAsset } from "./sound-library.js";
import { scStr } from "./track.js";

export const PREVIEW_SYNTHS = [1, 2].map(ch => `SynthDef(\\abxPreview${ch}, { |buf, gate = 1, duration = 5| var sig = PlayBuf.ar(${ch}, buf, BufRateScale.kr(buf), doneAction: 2); var env = EnvGen.kr(Env.asr(0.003, 1, 0.02), gate, doneAction: 2); var life = Line.kr(0, 1, duration, doneAction: 2); Out.ar(0, Limiter.ar(${ch === 1 ? "sig ! 2" : "sig"} * env * 0.65, 0.7)) }).add;`).join(" ");
export class Preview {
  private current = { state: "idle", key: null as string | null, until: 0, generation: 0, error: null as string | null };
  constructor(private engine: CommandEngine, private samples?: string) {}
  snapshot() {
    const c = this.current;
    if (c.state === "previewing" && (!this.engine.running || c.generation !== this.engine.generation)) return { ...c, state: "unavailable", error: "Audio engine became unavailable." };
    return { ...c, state: c.state === "previewing" && Date.now() >= c.until ? "idle" : c.state };
  }
  async play(key: string, id: string) {
    const asset = libraryAsset(this.samples, key, "preview");
    this.current = { state: "preparing", key, until: 0, generation: this.engine.generation, error: null };
    try {
      await this.engine.ensureBooted();
      if (this.engine.state !== "ready") throw new Error("Audio is unavailable for preview. Reset the engine to recover.");
      this.engine.assertSampleLoaded?.(asset);
      const gen = this.engine.generation;
      const file = scStr(asset.source!.file.split("/")[1]);
      const result = await this.engine.sclang.evalRoutine(`var buffers = ~dirt.soundLibrary.buffers["${scStr(asset.name)}".asSymbol], b, duration; if(buffers.isNil or: { buffers.size <= ${asset.index} }) { Error("Preview sample is not loaded").throw }; b = buffers[${asset.index}]; if(b.path.basename != "${file}") { Error("Loaded sample identity changed; Reset audio").throw }; if([1,2].includes(b.numChannels).not or: { b.numFrames <= 0 }) { Error("Preview requires a loaded mono or stereo sample").throw }; ~abxPreviewGroup.set(\\gate, 0); 0.025.wait; ~abxPreviewGroup.freeAll; s.sync; duration = b.duration.min(5); Synth.tail(~abxPreviewGroup, ("abxPreview" ++ b.numChannels).asSymbol, [\\buf, b.bufnum, \\duration, duration]); s.sync; ("ABX_PRE" ++ "VIEW " ++ duration).postln;`, id);
      this.engine.assertGeneration(gen);
      const duration = Number(/ABX_PREVIEW ([0-9.]+)/.exec(result.output)?.[1] ?? 5);
      this.current = { state: "previewing", key, until: Date.now() + duration * 1000, generation: gen, error: null };
    } catch (e) { this.current = { ...this.current, state: "unavailable", error: String(e) }; throw e; }
  }
  async stop(id: string) {
    if (this.engine.running) {
      const gen = this.engine.generation;
      await this.engine.sclang.evalRoutine("~abxPreviewGroup.set(\\gate, 0); 0.025.wait; ~abxPreviewGroup.freeAll; s.sync;", id);
      this.engine.assertGeneration(gen);
    } else if (this.engine.state !== "idle") throw new Error("Preview stop could not be confirmed: engine unavailable");
    this.current = { state: "idle", key: null, until: 0, generation: this.engine.generation, error: null };
  }
}
