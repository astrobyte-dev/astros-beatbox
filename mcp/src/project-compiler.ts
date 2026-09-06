import { type ProjectDocument, type Clip, type Track, type Automation, ranges } from "./project.js";

const number = (v: number) => String(Number(v.toFixed(6)));
function curve(a: Automation): string {
  const [lo, hi] = ranges[a.parameter];
  const values = '"' + a.values.map(v => number(lo + v * (hi - lo))).join(" ") + '"';
  return a.bars === 1 ? values : `(slow ${a.bars} ${values})`;
}
export function compileClip(p: ProjectDocument, c: Clip): string {
  if (c.kind === "code") return c.source; // Opaque expression; never parse/rewrite it.
  const asset = p.assets.find(a => a.id === c.assetId)!;
  const sound = asset.name + (asset.index ? ":" + asset.index : "");
  let body = 's "' + c.steps.map(v => v > 0 ? sound : "~").join(" ") + '"';
  // Velocity stays multiplicative, even when gain has a musical automation lane.
  body += ' # gain "' + c.steps.map(number).join(" ") + '"';
  for (const key of Object.keys(c.parameters).sort() as (keyof typeof c.parameters)[]) {
    body += (key === "gain" ? " |* gain " : ` # ${key} `) + number(c.parameters[key]!);
  }
  const automation = p.automation.filter(a => a.enabled && a.trackId === c.trackId && (a.clipId === null || a.clipId === c.id));
  for (const a of automation.filter(a => a.clipId !== null || !automation.some(b => b.clipId === c.id && b.parameter === a.parameter)).sort((a, b) => a.parameter.localeCompare(b.parameter))) {
    body += (a.parameter === "gain" ? " |* gain " : ` # ${a.parameter} `) + curve(a);
  }
  return c.swing ? `swingBy ${number(c.swing)} 8 $ ${body}` : body;
}
export function compileTrack(p: ProjectDocument, t: Track, clipId = t.activeClipId): string | null {
  const c = p.clips.find(c => c.id === clipId);
  if (!c) return null;
  const body = compileClip(p, c);
  // Routing is an outer projection, separate from the opaque source expression.
  return c.kind === "steps" || c.managed ? `(${body}) # orbit ${t.channel}` : body;
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
