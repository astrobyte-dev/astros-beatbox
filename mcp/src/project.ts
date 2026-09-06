import { randomUUID } from "node:crypto";
import { z } from "zod";

export const CHANNELS = 12;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).refine(s => !["__proto__", "prototype", "constructor"].includes(s));
const finite = z.number().finite();
export const parameterSchema = z.enum(["gain", "pan", "cutoff", "shape", "room", "delay", "speed", "legato", "resonance", "size", "crush", "sustain"]);
export type Parameter = z.infer<typeof parameterSchema>;
export const ranges: Record<Parameter, [number, number]> = { gain: [0, 2], pan: [0, 1], cutoff: [0, 24000], shape: [0, 1], room: [0, 1], delay: [0, 1], speed: [-8, 8], legato: [0, 32], resonance: [0, 1], size: [0, 1], crush: [1, 16], sustain: [0, 60] };
const params = z.record(parameterSchema, finite).superRefine((p, ctx) => {
  for (const [k, v] of Object.entries(p)) { const [lo, hi] = ranges[k as Parameter]; if (v! < lo || v! > hi) ctx.addIssue({ code: "custom", message: "Parameter out of range: " + k }); }
});
const mixerSchema = z.object({ level: finite.min(0).max(2), balance: finite.min(-1).max(1), mute: z.boolean(), solo: z.boolean() }).strict();
const assetSchema = z.object({ id, kind: z.enum(["sample", "synth", "file"]), reference: z.string().min(1).max(2048), name: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100), index: z.number().int().min(0).max(65535) }).strict();
const clipBase = { id, trackId: id, name: z.string().max(120) };
export const clipSchema = z.discriminatedUnion("kind", [
  z.object({ ...clipBase, kind: z.literal("steps"), assetId: id, steps: z.array(finite.min(0).max(1.5)).min(1).max(128), swing: finite.min(0).max(0.5), parameters: params }).strict(),
  z.object({ ...clipBase, kind: z.literal("code"), source: z.string().min(1).max(65536), managed: z.boolean(), dependencyIds: z.array(id).max(128) }).strict(),
]);
export const automationSchema = z.object({ id, trackId: id, clipId: id.nullable(), parameter: parameterSchema, enabled: z.boolean(), bars: z.number().int().min(1).max(64), values: z.array(finite.min(0).max(1)).min(2).max(128) }).strict();
export const trackSchema = z.object({ id, name: z.string().max(120), slot: z.number().int().min(1).max(16), channel: z.number().int().min(0).max(CHANNELS - 1).nullable(), activeClipId: id.nullable(), mixer: mixerSchema }).strict();
const sceneSchema = z.object({ id, name: z.string().min(1).max(120), clips: z.record(id, id.nullable()) }).strict();
const arrangementSchema = z.array(z.object({ id, sceneId: id, cycles: z.number().int().min(1).max(128) }).strict()).max(512);
const documentSchema = z.object({
  schemaVersion: z.literal(1), id, revision: z.number().int().nonnegative().safe(), name: z.string().max(120),
  tempo: z.object({ bpm: finite.positive().max(1000), beatsPerCycle: finite.positive().max(32) }).strict(),
  tracks: z.array(trackSchema).max(16), clips: z.array(clipSchema).max(1024), scenes: z.array(sceneSchema).min(1).max(128), sceneOrder: z.array(id).min(1).max(128),
  arrangement: arrangementSchema, assets: z.array(assetSchema).max(2048), automation: z.array(automationSchema).max(2048),
  dependencies: z.array(z.object({ id, kind: z.enum(["tidal", "supercollider", "sample-library"]), name: z.string().min(1).max(200), version: z.string().max(100), source: z.string().max(65536) }).strict()).max(128),
  // Source artifacts are retained verbatim, never replayed as a recovery log.
  sources: z.array(z.object({ id, name: z.string().max(120), source: z.string().max(65536) }).strict()).max(128),
}).strict();
export type ProjectDocument = z.infer<typeof documentSchema>;
export type Track = ProjectDocument["tracks"][number];
export type Clip = ProjectDocument["clips"][number];
export type StepClip = Extract<Clip, { kind: "steps" }>;
export type Automation = z.infer<typeof automationSchema>;
export const uid = () => randomUUID();
export const clone = <T>(v: T): T => structuredClone(v);
export function emptyProject(name = "Untitled"): ProjectDocument {
  const scenes = ["A", "B", "C", "D"].map(name => ({ id: uid(), name, clips: {} }));
  return { schemaVersion: 1, id: uid(), revision: 0, name, tempo: { bpm: 120, beatsPerCycle: 4 }, tracks: [], clips: [], scenes, sceneOrder: scenes.map(s => s.id), arrangement: [], assets: [], automation: [], dependencies: [], sources: [] };
}
export function validateProject(value: unknown): ProjectDocument {
  if (JSON.stringify(value).length > 4 * 1024 * 1024) throw new Error("Project exceeds 4 MiB limit");
  const p = documentSchema.parse(value);
  for (const a of p.assets) if (a.kind === "sample" && a.reference !== a.name) throw new Error("Sample library references must match their registered sound name");
  const unique = (xs: string[], label: string) => { if (new Set(xs).size !== xs.length) throw new Error("Duplicate " + label); };
  unique([p.id, ...p.tracks.map(t => t.id), ...p.clips.map(c => c.id), ...p.scenes.map(s => s.id), ...p.assets.map(a => a.id), ...p.automation.map(a => a.id), ...p.dependencies.map(d => d.id), ...p.arrangement.map(a => a.id), ...p.sources.map(s => s.id)], "identity");
  unique(p.tracks.map(t => String(t.slot)), "slot");
  unique(p.tracks.filter(t => t.channel !== null).map(t => String(t.channel)), "channel");
  unique(p.sceneOrder, "scene order");
  if (p.sceneOrder.length !== p.scenes.length || p.sceneOrder.some(s => !p.scenes.some(x => x.id === s))) throw new Error("Invalid scene order");
  const ref = (trackId: string, clipId: string | null) => {
    if (!p.tracks.some(t => t.id === trackId) || clipId !== null && !p.clips.some(c => c.id === clipId && c.trackId === trackId)) throw new Error("Invalid track/clip reference");
  };
  for (const t of p.tracks) {
    ref(t.id, t.activeClipId);
    if (t.channel !== null && t.channel !== t.slot - 1) throw new Error("Managed channels use the existing d1..d12 routes; slot routing remains stable on reorder");
  }
  for (const c of p.clips) {
    ref(c.trackId, c.id);
    if (c.kind === "steps" && !p.assets.some(a => a.id === c.assetId)) throw new Error("Invalid asset reference");
    if (c.kind === "code" && c.dependencyIds.some(d => !p.dependencies.some(x => x.id === d))) throw new Error("Invalid dependency reference");
    if ((c.kind === "steps" || c.managed) && p.tracks.find(t => t.id === c.trackId)!.channel === null) throw new Error("Managed clips require an available channel (12 maximum)");
  }
  for (const s of p.scenes) for (const [t, c] of Object.entries(s.clips)) ref(t, c);
  for (const a of p.arrangement) if (!p.scenes.some(s => s.id === a.sceneId)) throw new Error("Invalid arrangement scene");
  for (const a of p.automation) { ref(a.trackId, a.clipId); if (a.clipId && p.clips.find(c => c.id === a.clipId)!.kind !== "steps") throw new Error("Visual automation requires a step clip"); }
  unique(p.automation.map(a => a.trackId + ":" + a.clipId + ":" + a.parameter), "automation target");
  return p;
}

export const editSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("track.add"), track: trackSchema }).strict(),
  z.object({ type: z.literal("track.delete"), trackId: id }).strict(),
  z.object({ type: z.literal("track.order"), ids: z.array(id).max(16) }).strict(),
  z.object({ type: z.literal("track.rename"), trackId: id, name: z.string().max(120) }).strict(),
  z.object({ type: z.literal("clip.put"), clip: clipSchema }).strict(),
  z.object({ type: z.literal("clip.delete"), clipId: id }).strict(),
  z.object({ type: z.literal("clip.activate"), trackId: id, clipId: id.nullable() }).strict(),
  z.object({ type: z.literal("steps.set"), clipId: id, steps: z.array(finite.min(0).max(1.5)).min(1).max(128) }).strict(),
  z.object({ type: z.literal("sound.set"), clipId: id, assetId: id }).strict(),
  z.object({ type: z.literal("swing.set"), clipId: id, value: finite.min(0).max(0.5) }).strict(),
  z.object({ type: z.literal("parameter.set"), clipId: id, parameter: parameterSchema, value: finite.nullable() }).strict(),
  z.object({ type: z.literal("mixer.set"), trackId: id, values: mixerSchema.partial().strict() }).strict(),
  z.object({ type: z.literal("asset.put"), asset: assetSchema }).strict(),
  z.object({ type: z.literal("scene.put"), scene: sceneSchema }).strict(),
  z.object({ type: z.literal("scene.delete"), sceneId: id }).strict(),
  z.object({ type: z.literal("scene.order"), ids: z.array(id).max(128) }).strict(),
  z.object({ type: z.literal("scene.capture"), sceneId: id }).strict(),
  z.object({ type: z.literal("scene.activate"), sceneId: id }).strict(),
  z.object({ type: z.literal("arrangement.set"), entries: arrangementSchema }).strict(),
  z.object({ type: z.literal("automation.put"), automation: automationSchema }).strict(),
  z.object({ type: z.literal("automation.delete"), automationId: id }).strict(),
  z.object({ type: z.literal("tempo.set"), bpm: finite.positive().max(1000), beatsPerCycle: finite.positive().max(32) }).strict(),
  z.object({ type: z.literal("project.rename"), name: z.string().max(120) }).strict(),
  z.object({ type: z.literal("dependencies.set"), dependencies: documentSchema.shape.dependencies }).strict(),
]);
export type ProjectEdit = z.infer<typeof editSchema>;
export function applyEdits(document: ProjectDocument, input: unknown): ProjectDocument {
  const edits = z.array(editSchema).min(1).max(512).parse(input), p = clone(document);
  const track = (id: string) => { const t = p.tracks.find(t => t.id === id); if (!t) throw new Error("Unknown track " + id); return t; };
  const steps = (id: string) => { const c = p.clips.find(c => c.id === id); if (!c || c.kind !== "steps") throw new Error("Visual editing requires a step clip; arbitrary code cannot be rewritten"); return c; };
  const scene = (id: string) => { const s = p.scenes.find(s => s.id === id); if (!s) throw new Error("Unknown scene"); return s; };
  const put = <T extends {id: string}>(xs: T[], x: T) => { const i = xs.findIndex(y => y.id === x.id); if (i < 0) xs.push(clone(x)); else xs[i] = clone(x); };
  const removeClip = (id: string) => { p.clips = p.clips.filter(c => c.id !== id); p.automation = p.automation.filter(a => a.clipId !== id); for (const t of p.tracks) if (t.activeClipId === id) t.activeClipId = null; for (const s of p.scenes) for (const t of Object.keys(s.clips)) if (s.clips[t] === id) s.clips[t] = null; };
  for (const e of edits) switch (e.type) {
    case "track.add": if (p.tracks.some(t => t.id === e.track.id)) throw new Error("Track already exists"); p.tracks.push(clone(e.track)); break;
    case "track.delete": track(e.trackId); for (const c of p.clips.filter(c => c.trackId === e.trackId)) removeClip(c.id); p.tracks = p.tracks.filter(t => t.id !== e.trackId); p.automation = p.automation.filter(a => a.trackId !== e.trackId); for (const s of p.scenes) delete s.clips[e.trackId]; break;
    case "track.order": if (e.ids.length !== p.tracks.length || new Set(e.ids).size !== e.ids.length) throw new Error("Track order must be a permutation"); p.tracks = e.ids.map(track); break;
    case "track.rename": track(e.trackId).name = e.name; break;
    case "clip.put": { const old = p.clips.find(c => c.id === e.clip.id); if (old && old.trackId !== e.clip.trackId) throw new Error("Clip ownership is stable"); put(p.clips, e.clip); break; }
    case "clip.delete": if (!p.clips.some(c => c.id === e.clipId)) throw new Error("Unknown clip"); removeClip(e.clipId); break;
    case "clip.activate": track(e.trackId).activeClipId = e.clipId; break;
    case "steps.set": steps(e.clipId).steps = e.steps; break;
    case "sound.set": steps(e.clipId).assetId = e.assetId; break;
    case "swing.set": steps(e.clipId).swing = e.value; break;
    case "parameter.set": if (e.value === null) delete steps(e.clipId).parameters[e.parameter]; else steps(e.clipId).parameters[e.parameter] = e.value; break;
    case "mixer.set": Object.assign(track(e.trackId).mixer, e.values); break;
    case "asset.put": { const old = p.assets.find(a => a.id === e.asset.id); if (old && JSON.stringify(old) !== JSON.stringify(e.asset)) throw new Error("Asset identities are immutable; add a new asset and replace the intended clip reference"); put(p.assets, e.asset); break; }
    case "scene.put": if (!p.scenes.some(s => s.id === e.scene.id)) p.sceneOrder.push(e.scene.id); put(p.scenes, e.scene); break;
    case "scene.delete": scene(e.sceneId); p.scenes = p.scenes.filter(s => s.id !== e.sceneId); p.sceneOrder = p.sceneOrder.filter(s => s !== e.sceneId); p.arrangement = p.arrangement.filter(a => a.sceneId !== e.sceneId); break;
    case "scene.order": p.sceneOrder = e.ids; break;
    case "scene.capture": scene(e.sceneId).clips = Object.fromEntries(p.tracks.map(t => [t.id, t.activeClipId])); break;
    case "scene.activate": { const s = scene(e.sceneId); for (const t of p.tracks) t.activeClipId = s.clips[t.id] ?? null; break; }
    case "arrangement.set": p.arrangement = e.entries; break;
    case "automation.put": put(p.automation, e.automation); break;
    case "automation.delete": p.automation = p.automation.filter(a => a.id !== e.automationId); break;
    case "tempo.set": p.tempo = { bpm: e.bpm, beatsPerCycle: e.beatsPerCycle }; break;
    case "project.rename": p.name = e.name; break;
    case "dependencies.set": p.dependencies = e.dependencies; break;
  }
  return validateProject(p);
}
