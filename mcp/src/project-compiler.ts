import { macroOffset } from "./jam-model.js";
import { defaultPlayback } from "./sampling.js";
import { compileFxAutomation } from "./fx-automation.js";
import { definition } from "./sound-lab.js";
import { modulationControls } from "./sound-lab-engine.js";
import { type ProjectDocument, type Clip, type Track, type Automation, ranges, type Parameter } from "./project.js";

const number = (v: number) => String(Number(v.toFixed(6)));
// A negative function argument needs parentheses in Haskell; otherwise '-' is
// parsed as subtraction from the partially applied control function.
const argument = (v: number) => v < 0 ? `(${number(v)})` : number(v);
function curve(a: Automation): string {
  const [lo, hi] = a.parameter.startsWith("synth.") ? [0, 1] : ranges[a.parameter as Parameter];
  const values = '"' + a.values.map(v => number(lo + v * (hi - lo))).join(" ") + '"';
  return a.bars === 1 ? values : `(slow ${a.bars} ${values})`;
}
export function compileClip(p: ProjectDocument, c: Clip): string {
  if (c.kind === "code") return c.source; // Opaque expression; never parse/rewrite it.
  const asset = p.assets.find(a => a.id === c.assetId)!;
  const track = p.tracks.find(t => t.id === c.trackId)!, source = track.source;
  const synth = source?.type === "synth" ? definition("instrument", source.definitionId, source.version) : undefined;
  if (source?.type === "synth" && !synth || source?.type === "sample" && asset.kind === "synth") return "silence";
  const sound = synth ? synth.engine : asset.name + (asset.index ? ":" + asset.index : "");
  let body = 's "' + c.steps.map(v => v > 0 ? sound : "~").join(" ") + '"';
  // Velocity stays multiplicative, even when gain has a musical automation lane.
  body += ' # gain "' + c.steps.map(number).join(" ") + '"';
  const automation = p.automation.filter(a => !a.parameter.startsWith("fx.") && a.enabled && a.trackId === c.trackId && (a.clipId === null || a.clipId === c.id));
  if (synth && source?.type === "synth") {
    // Allow envelopes to ring across pads; explicit clip legato/sustain still wins.
    body += " # legato 4";
    const notes = c.steps.map((_, i) => Math.max(0, Math.min(127, (c.notes?.[i] ?? 36) + (c.octave ?? 0) * 12)));
    body += ' # midinote "' + notes.join(" ") + '"';
    const previous = notes.map((_, i) => { for (let back = 1; back <= notes.length; back++) { const j = (i - back + notes.length) % notes.length; if (c.steps[j] > 0) return 440 * 2 ** ((notes[j] - 69) / 12); } return 110; });
    body += ' # pF "abxprev" "' + previous.map(number).join(" ") + '"';
    if (["dirtymono", "sub808"].includes(synth.id)) body += ' # cut ' + (100 + track.slot);
    for (const param of synth.parameters) if (!automation.some(a => a.parameter === "synth." + param.id)) body += ' # pF "abx' + param.id + '" ' + number(source.values[param.id]);
    for (const param of synth.parameters) { const offset = macroOffset(p, track.id, "synth." + param.id); if (offset) body += ' # pF "j' + param.id + '" ' + argument(offset); }
    for (const [key, value] of Object.entries(modulationControls(track.modulation ?? [], "synth."))) body += ' # pF "' + key + '" ' + argument(value);
  }
  for (const key of Object.keys(c.parameters).sort() as (keyof typeof c.parameters)[]) {
    if (automation.some(a => a.parameter === key)) continue;
    body += (key === "gain" ? " |* gain " : ` # ${key} `) + argument(c.parameters[key]!);
  }
  for (const a of automation.filter(a => a.clipId !== null || !automation.some(b => b.clipId === c.id && b.parameter === a.parameter)).sort((a, b) => a.parameter.localeCompare(b.parameter))) {
    body += (a.parameter === "gain" ? " |* gain " : a.parameter.startsWith("synth.") ? ` # pF "abx${a.parameter.slice(6)}" ` : ` # ${a.parameter} `) + curve(a);
  }
  if (!synth && (c.playback || c.slices?.length)) {
    const v = c.playback ?? defaultPlayback();
    const regions = c.steps.map((_, i) => c.slices?.find(s => s.id === c.sliceSteps?.[i]) ?? v);
    body += ' # begin "' + regions.map(s => number(s.start)).join(" ") + '" # end "' + regions.map(s => number(s.end)).join(" ") + '"';
    body += ' |* speed ' + argument((v.reverse ? -1 : 1) * 2 ** (v.pitch / 12));
    body += ' # pF "abxattack" ' + number(v.attack) + ' # pF "abxrelease" ' + number(v.release);
    if (v.mode === "loop") body = `slow ${number(v.beats / p.tempo.beatsPerCycle)} $ ${body}`;
  }
  return c.swing ? `swingBy ${number(c.swing)} 8 $ ${body}` : body;
}
export function compileTrack(p: ProjectDocument, t: Track, clipId = t.activeClipId): string | null {
  const c = p.clips.find(c => c.id === clipId);
  const controls = t.channel !== null ? compileFxAutomation(p, t, clipId) : [];
  if (!c && !controls.length) return null;
  const music = c ? compileClip(p, c) : "silence";
  const body = controls.length ? `stack [(${music}
), ${controls.join(", ")}]` : music;
  // Routing is an outer projection, separate from the opaque source expression.
  return !c || c.kind === "steps" || c.managed ? `(${body}${c?.kind === "code" ? "\n" : ""}) # orbit ${t.channel}` : body;
}
export function projectSlots(p: ProjectDocument): Record<string, string> {
  return Object.fromEntries(p.tracks.flatMap(t => { const body = compileTrack(p, t); return body === null ? [] : [["d" + t.slot, body]]; }));
}
export function compileArrangement(p: ProjectDocument): Record<string, string> {
  if (!p.arrangement.length) return projectSlots(p);
  const total = p.arrangement.reduce((n, e) => n + e.cycles, 0);
  return Object.fromEntries(p.tracks.map(t => ["d" + t.slot, `slow ${total} $ timeCat [` + p.arrangement.map(e => {
    const s = p.scenes.find(s => s.id === e.sceneId)!;
    return `(${e.cycles}, fast ${e.cycles} $ ${compileTrack(p, t, s.clips[t.id] ?? null) ? "(" + compileTrack(p, t, s.clips[t.id] ?? null) + ")" : "silence"})`;
  }).join(", ") + "]"]));
}
export function channelValues(p: ProjectDocument): { channel: number; level: number; balance: number }[] {
  const anySolo = p.tracks.some(t => t.mixer.solo);
  return p.tracks.filter(t => t.channel !== null).map(t => ({ channel: t.channel!, level: t.mixer.mute || anySolo && !t.mixer.solo ? 0 : t.mixer.level, balance: t.mixer.balance }));
}
// A linear stereo balance preserves both source channels at centre; it never folds
// a stereo signal to mono or boosts an already hard-panned source.
export function balanceGains(level: number, balance: number): [number, number] {
  return [level * Math.min(1, 1 - balance), level * Math.min(1, 1 + balance)];
}
export const CHANNEL_SYNTH = `SynthDef(\\abxChannel, { |inBus, level = 1, balance = 0| var sig = In.ar(inBus, 2); var lev = Lag.kr(level, 0.02); var bal = Lag.kr(balance, 0.02); Out.ar(0, sig * [min(1, 1-bal), min(1, 1+bal)] * lev); }).add;`;
export function mixerCommand(p: ProjectDocument): string {
  const values = channelValues(p);
  // Set all twelve: a removed track must not leave its reused route muted.
  return Array.from({ length: 12 }, (_, i) => {
    const c = values.find(c => c.channel === i);
    return `~abxChannels[${i}].set(\\level, ${number(c?.level ?? 1)}, \\balance, ${number(c?.balance ?? 0)});`;
  }).join(" ") + " s.sync;";
}
