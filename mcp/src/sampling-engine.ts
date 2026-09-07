import type { CommandEngine } from "./application.js";
import type { Asset } from "./sound-library.js";
import { scStr } from "./track.js";
import type { UserAudioLibrary } from "./user-audio.js";

export const isUserAudio = (a: Asset) => a.source?.origin === "user" || a.source?.origin === "captured";
// Reuse Dirt's event envelope, fitting both fades inside its actual computed
// sample lifetime. This also works for bundled samples without browser decoding.
export const INSTALL_SAMPLE_ENVELOPE = `~dirt.addModule(\\abxSampleEnvelope, { |event| var a = (~abxattack ? 0.003).clip(0.001, 2), r = (~abxrelease ? 0.02).clip(0.001, 5), life = ~sustain.max(0.001), scale; scale = (life / (a + r)).min(1); a = a * scale; r = r * scale; event.sendSynth("dirt_envelope" ++ ~numChannels, [\\out, ~out, \\attack, a, \\hold, (life - a - r).max(0), \\release, r, \\curve, -3]); }, { ~abxattack.notNil }); s.sync;`;
// Dynamic buffers still belong to SuperDirt; no second playback authority. Bound
// total retained memory per generation, refusing further loads without evicting voices.
export class ManagedAudioBuffers {
  private generation = -1;
  private loaded = new Set<string>();
  private bytes = 0;
  constructor(private engine: CommandEngine, private library: UserAudioLibrary) {}
  async ensure(asset: Asset, operation: string) {
    const file = await this.library.verify(asset.id);
    if (this.generation !== this.engine.generation) { this.loaded.clear(); this.bytes = 0; this.generation = this.engine.generation; }
    if (this.loaded.has(asset.id)) return;
    const bytes = this.library.get(asset.id).metadata.frames * this.library.get(asset.id).metadata.channels * 4;
    if (this.bytes + bytes > 512 * 1024 * 1024) throw new Error("User audio buffer budget reached (512 MiB). Stop and restart audio to release unused sounds.");
    const gen = this.engine.generation;
    await this.engine.sclang.evalRoutine(`var b; ~dirt.soundLibrary.loadSoundFile("${scStr(file.replace(/\\/g, "/"))}", "${asset.name}".asSymbol); s.sync; b = ~dirt.soundLibrary.buffers["${asset.name}".asSymbol]; if(b.isNil or: { b.size != 1 } or: { b[0].numFrames <= 0 }) { Error("User audio did not load").throw };`, operation);
    this.engine.assertGeneration(gen); this.loaded.add(asset.id); this.bytes += bytes;
  }
}
