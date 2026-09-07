import { samplePlaybackSchema, sliceSchema, audioMetadataSchema } from "./sampling.js";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { sourceSchema, effectSchema, routeSchema, patchSchema, definition, validateValues, targetDefinition } from "./sound-lab.js";

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
const assetSchema = z.object({ id, kind: z.enum(["sample", "synth", "file"]), reference: z.string().min(1).max(2048), name: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100), index: z.number().int().min(0).max(65535), source: z.object({ library: z.string().min(1).max(100), origin: z.enum(["bundled", "external", "user", "captured"]), file: z.string().regex(/^[a-zA-Z0-9_-]+\/[^/\\\x00-\x1f]+$/).max(1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(), audio: audioMetadataSchema.optional() }).strict();
const clipBase = { id, trackId: id, name: z.string().max(120) };
export const clipSchema = z.discriminatedUnion("kind", [
  z.object({ ...clipBase, kind: z.literal("steps"), assetId: id, steps: z.array(finite.min(0).max(1.5)).min(1).max(128), swing: finite.min(0).max(0.5), playback: samplePlaybackSchema.optional(), slices: z.array(sliceSchema).max(16).optional(), sliceSteps: z.array(id.nullable()).min(1).max(128).optional(), notes: z.array(finite.int().min(0).max(127)).min(1).max(128).optional(), octave: z.number().int().min(-4).max(4).optional(), parameters: params }).strict(),
  z.object({ ...clipBase, kind: z.literal("code"), source: z.string().min(1).max(65536), managed: z.boolean(), draft: z.string().max(65536).optional(), dependencyIds: z.array(id).max(128) }).strict(),
]);
export const automationSchema = z.object({ id, trackId: id, clipId: id.nullable(), parameter: z.union([parameterSchema, z.string().regex(/^(synth\.[a-z][a-z0-9]*|fx\.[a-zA-Z0-9_-]+\.[a-z][a-z0-9]*)$/)]), enabled: z.boolean(), bars: z.number().int().min(1).max(64), values: z.array(finite.min(0).max(1)).min(2).max(128) }).strict();
export const trackSchema = z.object({ id, name: z.string().max(120), slot: z.number().int().min(1).max(16), channel: z.number().int().min(0).max(CHANNELS - 1).nullable(), activeClipId: id.nullable(), mixer: mixerSchema, source: sourceSchema.optional(), effects: z.array(effectSchema).max(8).optional(), modulation: z.array(routeSchema).max(16).optional() }).strict();
const sceneSchema = z.object({ id, name: z.string().min(1).max(120), clips: z.record(id, id.nullable()) }).strict();
const arrangementSchema = z.array(z.object({ id, sceneId: id, cycles: z.number().int().min(1).max(128) }).strict()).max(512);
const documentSchema = z.object({
  schemaVersion: z.literal(1), id, revision: z.number().int().nonnegative().safe(), name: z.string().max(120),
  tempo: z.object({ bpm: finite.positive().max(1000), beatsPerCycle: finite.positive().max(32) }).strict(),
  tracks: z.array(trackSchema).max(16), clips: z.array(clipSchema).max(1024), scenes: z.array(sceneSchema).min(1).max(128), sceneOrder: z.array(id).min(1).max(128),
  patches: z.array(patchSchema).max(128).optional(), arrangement: arrangementSchema, arrangementLoop: z.boolean().optional(), assets: z.array(assetSchema).max(2048), automation: z.array(automationSchema).max(2048),
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
  for (const a of p.assets) if (a.source?.origin === "user" || a.source?.origin === "captured") {
    if (a.source.library !== "Beatbox" || a.id !== "audio_" + a.source.sha256 || a.name !== "abx_" + a.source.sha256 || a.source.file !== "audio/" + a.id + ".wav" || a.index !== 0 || a.kind !== "sample" || !a.audio) throw new Error("Invalid managed audio identity");
  }
  for (const a of p.assets) if (a.kind === "sample" && a.reference !== a.name) throw new Error("Sample library references must match their registered sound name");
  const unique = (xs: string[], label: string) => { if (new Set(xs).size !== xs.length) throw new Error("Duplicate " + label); };
  unique([p.id, ...p.tracks.map(t => t.id), ...p.clips.map(c => c.id), ...p.scenes.map(s => s.id), ...p.assets.map(a => a.id), ...p.automation.map(a => a.id), ...p.dependencies.map(d => d.id), ...p.arrangement.map(a => a.id), ...p.sources.map(s => s.id), ...p.tracks.flatMap(t => [...(t.effects ?? []).map(e => e.id), ...(t.modulation ?? []).map(m => m.id)]), ...(p.patches ?? []).map(p => p.id)], "identity");
  for (const patch of p.patches ?? []) validateValues(definition(patch.kind, patch.definitionId, patch.version), patch.values);
  unique(p.tracks.map(t => String(t.slot)), "slot");
  unique(p.tracks.filter(t => t.channel !== null).map(t => String(t.channel)), "channel");
  unique(p.sceneOrder, "scene order");
  if (p.sceneOrder.length !== p.scenes.length || p.sceneOrder.some(s => !p.scenes.some(x => x.id === s))) throw new Error("Invalid scene order");
  const ref = (trackId: string, clipId: string | null) => {
    if (!p.tracks.some(t => t.id === trackId) || clipId !== null && !p.clips.some(c => c.id === clipId && c.trackId === trackId)) throw new Error("Invalid track/clip reference");
  };
  for (const t of p.tracks) {
    ref(t.id, t.activeClipId);
    if ((t.source?.type === "synth" || t.effects?.length) && t.channel === null) throw new Error("Sound Lab requires a managed channel");
    if (t.source?.type === "synth") validateValues(definition("instrument", t.source.definitionId, t.source.version), t.source.values);
    for (const fx of t.effects ?? []) validateValues(definition("effect", fx.definitionId, fx.version), fx.values);
    unique((t.modulation ?? []).map(m => m.target), "modulation target");
    for (const m of t.modulation ?? []) if (!targetDefinition(t, m.target)) {
      const unknown = t.source?.type === "synth" && !definition("instrument", t.source.definitionId, t.source.version) && m.target.startsWith("synth.") || (t.effects ?? []).some(f => !definition("effect", f.definitionId, f.version) && m.target.startsWith("fx." + f.id + "."));
      if (!unknown) throw new Error("Unsupported modulation target");
    }
    if (t.channel !== null && t.channel !== t.slot - 1) throw new Error("Managed channels use the existing d1..d12 routes; slot routing remains stable on reorder");
  }
  for (const c of p.clips) {
    ref(c.trackId, c.id);
    const source = p.tracks.find(t => t.id === c.trackId)!.source;
    if (source?.type === "synth" && c.kind !== "steps" || source?.type === "code" && c.kind !== "code") throw new Error("Clip does not match track source type");
    if (c.kind === "steps") {
      unique((c.slices ?? []).map(s => s.id), "slice identity");
      if (c.sliceSteps && (c.sliceSteps.length !== c.steps.length || c.sliceSteps.some(id => id !== null && !c.slices?.some(s => s.id === id)))) throw new Error("Invalid slice pad mapping");
    }
    if (c.kind === "steps" && c.notes && c.notes.length !== c.steps.length) throw new Error("One note is required per rhythm step");
    if (c.kind === "steps" && !p.assets.some(a => a.id === c.assetId)) throw new Error("Invalid asset reference");
    if (c.kind === "code" && c.dependencyIds.some(d => !p.dependencies.some(x => x.id === d))) throw new Error("Invalid dependency reference");
    if ((c.kind === "steps" || c.managed) && p.tracks.find(t => t.id === c.trackId)!.channel === null) throw new Error("Managed clips require an available channel (12 maximum)");
  }
  for (const s of p.scenes) for (const [t, c] of Object.entries(s.clips)) ref(t, c);
  for (const a of p.arrangement) if (!p.scenes.some(s => s.id === a.sceneId)) throw new Error("Invalid arrangement scene");
  for (const a of p.automation) { ref(a.trackId, a.clipId); if (a.parameter.startsWith("synth.")) { const t = p.tracks.find(t => t.id === a.trackId)!; if (!targetDefinition(t, a.parameter) && !(t.source?.type === "synth" && !definition("instrument", t.source.definitionId, t.source.version))) throw new Error("Unsupported synth automation target"); } if (a.parameter.startsWith("fx.")) { const t = p.tracks.find(t => t.id === a.trackId)!, fx = t.effects?.find(f => f.id === a.parameter.split(".")[1]); if (!fx || definition("effect", fx.definitionId, fx.version) && !targetDefinition(t, a.parameter)?.automatable) throw new Error("Unsupported FX automation target: " + a.parameter); } if (a.clipId && p.clips.find(c => c.id === a.clipId)!.kind !== "steps") throw new Error("Visual automation requires a step clip"); }
  unique(p.automation.map(a => a.trackId + ":" + a.clipId + ":" + a.parameter), "automation target");
  return p;
}

export const editSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sample.playback"), clipId: id, playback: samplePlaybackSchema }).strict(),
  z.object({ type: z.literal("sample.slices"), clipId: id, slices: z.array(sliceSchema).max(16), sliceSteps: z.array(id.nullable()).min(1).max(128) }).strict(),
  z.object({ type: z.literal("source.set"), trackId: id, source: sourceSchema }).strict(),
  z.object({ type: z.literal("synth.parameter"), trackId: id, parameter: z.string(), value: finite.min(0).max(1) }).strict(),
  z.object({ type: z.literal("notes.set"), clipId: id, notes: z.array(finite.int().min(0).max(127)).min(1).max(128), octave: z.number().int().min(-4).max(4) }).strict(),
  z.object({ type: z.literal("fx.put"), trackId: id, effect: effectSchema }).strict(),
  z.object({ type: z.literal("fx.remove"), trackId: id, effectId: id }).strict(),
  z.object({ type: z.literal("fx.order"), trackId: id, ids: z.array(id).max(8) }).strict(),
  z.object({ type: z.literal("modulation.put"), trackId: id, route: routeSchema }).strict(),
  z.object({ type: z.literal("modulation.remove"), trackId: id, routeId: id }).strict(),
  z.object({ type: z.literal("patch.put"), patch: patchSchema }).strict(),
  z.object({ type: z.literal("patch.load"), trackId: id, effectId: id.optional(), presetId: id }).strict(),
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
  z.object({ type: z.literal("scene.create"), sceneId: id, name: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal("scene.rename"), sceneId: id, name: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal("scene.duplicate"), sceneId: id, newSceneId: id, name: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal("scene.silence"), sceneId: id, trackId: id }).strict(),
  z.object({ type: z.literal("arrangement.loop"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("code.draft"), clipId: id, source: z.string().max(65536) }).strict(),
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
    case "sample.playback": steps(e.clipId).playback = clone(e.playback); break;
    case "sample.slices": { const c = steps(e.clipId); c.slices = clone(e.slices); c.sliceSteps = clone(e.sliceSteps); break; }
    case "source.set": { const t = track(e.trackId); t.source = clone(e.source); t.modulation = (t.modulation ?? []).filter(m => !m.target.startsWith("synth.") || !!targetDefinition(t, m.target)); p.automation = p.automation.filter(a => a.trackId !== t.id || !a.parameter.startsWith("synth.") || !!targetDefinition(t, a.parameter)); break; }
    case "synth.parameter": { const t = track(e.trackId); if (t.source?.type !== "synth" || !targetDefinition(t, "synth." + e.parameter)) throw new Error("Unsupported synth parameter"); t.source.values[e.parameter] = e.value; delete t.source.presetId; break; }
    case "notes.set": { const c = steps(e.clipId); c.notes = e.notes; c.octave = e.octave; break; }
    case "fx.put": { const t = track(e.trackId); const old = t.effects?.find(f => f.id === e.effect.id); if (old && (old.definitionId !== e.effect.definitionId || old.version !== e.effect.version)) throw new Error("Effect instance identity is stable"); t.effects ??= []; put(t.effects, e.effect); break; }
    case "fx.remove": { const t = track(e.trackId); if (!t.effects?.some(f => f.id === e.effectId)) throw new Error("Unknown effect"); t.effects = t.effects.filter(f => f.id !== e.effectId); p.automation = p.automation.filter(a => a.trackId !== t.id || !a.parameter.startsWith("fx." + e.effectId + ".")); t.modulation = (t.modulation ?? []).filter(m => !m.target.startsWith("fx." + e.effectId + ".")); break; }
    case "fx.order": { const t = track(e.trackId), fx = t.effects ?? []; if (e.ids.length !== fx.length || new Set(e.ids).size !== fx.length || e.ids.some(id => !fx.some(f => f.id === id))) throw new Error("Effect order must be a permutation"); t.effects = e.ids.map(id => fx.find(f => f.id === id)!); break; }
    case "modulation.put": { const t = track(e.trackId); if (!targetDefinition(t, e.route.target)) throw new Error("Unsupported modulation target"); t.modulation ??= []; put(t.modulation, e.route); break; }
    case "modulation.remove": { const t = track(e.trackId); t.modulation = (t.modulation ?? []).filter(m => m.id !== e.routeId); break; }
    case "patch.put": p.patches ??= []; put(p.patches, e.patch); break;
    case "patch.load": { const t = track(e.trackId), target = e.effectId ? t.effects?.find(f => f.id === e.effectId) : t.source?.type === "synth" ? t.source : undefined; if (!target) throw new Error("No compatible patch target"); const kind = e.effectId ? "effect" : "instrument", d = definition(kind, target.definitionId, target.version); const user = p.patches?.find(p => p.id === e.presetId && p.kind === kind && p.definitionId === target.definitionId && p.version === target.version); const preset = user ?? d?.presets.find(p => p.id === e.presetId); if (!d || !preset) throw new Error("Unknown or incompatible patch"); target.values = clone(preset.values); target.presetId = preset.id; break; }
    case "track.add": if (p.tracks.some(t => t.id === e.track.id)) throw new Error("Track already exists"); p.tracks.push(clone(e.track)); break;
    case "track.delete": track(e.trackId); for (const c of p.clips.filter(c => c.trackId === e.trackId)) removeClip(c.id); p.tracks = p.tracks.filter(t => t.id !== e.trackId); p.automation = p.automation.filter(a => a.trackId !== e.trackId); for (const s of p.scenes) delete s.clips[e.trackId]; break;
    case "track.order": if (e.ids.length !== p.tracks.length || new Set(e.ids).size !== e.ids.length) throw new Error("Track order must be a permutation"); p.tracks = e.ids.map(track); break;
    case "track.rename": track(e.trackId).name = e.name; break;
    case "clip.put": { const old = p.clips.find(c => c.id === e.clip.id); if (old && old.trackId !== e.clip.trackId) throw new Error("Clip ownership is stable"); put(p.clips, e.clip); break; }
    case "clip.delete": if (!p.clips.some(c => c.id === e.clipId)) throw new Error("Unknown clip"); removeClip(e.clipId); break;
    case "clip.activate": track(e.trackId).activeClipId = e.clipId; break;
    case "steps.set": { const c = steps(e.clipId); c.steps = e.steps; if (c.sliceSteps) c.sliceSteps = e.steps.map((_, i) => c.sliceSteps![i] ?? null); if (c.notes) c.notes = e.steps.map((_, i) => c.notes![i] ?? 36); break; }
    case "sound.set": { const c = steps(e.clipId), t = track(c.trackId); c.assetId = e.assetId; delete c.slices; delete c.sliceSteps; delete c.playback; if (t.source?.type === "synth") { t.source = { type: "sample" }; t.modulation = (t.modulation ?? []).filter(m => !m.target.startsWith("synth.")); p.automation = p.automation.filter(a => a.trackId !== t.id || !a.parameter.startsWith("synth.")); } break; }
    case "swing.set": steps(e.clipId).swing = e.value; break;
    case "parameter.set": if (e.value === null) delete steps(e.clipId).parameters[e.parameter]; else steps(e.clipId).parameters[e.parameter] = e.value; break;
    case "mixer.set": Object.assign(track(e.trackId).mixer, e.values); break;
    case "asset.put": { const old = p.assets.find(a => a.id === e.asset.id); if (old && JSON.stringify(old) !== JSON.stringify(e.asset)) throw new Error("Asset identities are immutable; add a new asset and replace the intended clip reference"); put(p.assets, e.asset); break; }
    case "scene.put": if (!p.scenes.some(s => s.id === e.scene.id)) p.sceneOrder.push(e.scene.id); put(p.scenes, e.scene); break;
    case "scene.create": if (p.scenes.some(s => s.id === e.sceneId)) throw new Error("Scene already exists"); p.scenes.push({ id: e.sceneId, name: e.name, clips: Object.fromEntries(p.tracks.map(t => [t.id, null])) }); p.sceneOrder.push(e.sceneId); break;
    case "scene.rename": scene(e.sceneId).name = e.name; break;
    case "scene.silence": track(e.trackId); scene(e.sceneId).clips[e.trackId] = null; break;
    case "scene.duplicate": {
      const source = scene(e.sceneId);
      if (p.scenes.some(s => s.id === e.newSceneId)) throw new Error("Scene already exists");
      const copiedId = (id: string) => "copy_" + createHash("sha256").update(e.newSceneId + ":" + id).digest("hex");
      const refs: Record<string, string | null> = {};
      for (const t of p.tracks) {
        const original = p.clips.find(c => c.id === source.clips[t.id]);
        if (!original) { refs[t.id] = null; continue; }
        const copy = clone(original); copy.id = copiedId(original.id); copy.name = e.name; p.clips.push(copy); refs[t.id] = copy.id;
        for (const a of p.automation.filter(a => a.clipId === original.id)) p.automation.push({ ...clone(a), id: copiedId(a.id), clipId: copy.id });
      }
      p.scenes.push({ id: e.newSceneId, name: e.name, clips: refs }); p.sceneOrder.splice(p.sceneOrder.indexOf(e.sceneId) + 1, 0, e.newSceneId); break;
    }
    case "arrangement.loop": p.arrangementLoop = e.enabled; break;
    case "code.draft": { const c = p.clips.find(c => c.id === e.clipId); if (!c || c.kind !== "code" || !c.managed) throw new Error("Select a managed code clip"); c.draft = e.source; break; }
    case "scene.delete": scene(e.sceneId); p.scenes = p.scenes.filter(s => s.id !== e.sceneId); p.sceneOrder = p.sceneOrder.filter(s => s !== e.sceneId); p.arrangement = p.arrangement.filter(a => a.sceneId !== e.sceneId); break;
    case "scene.order": p.sceneOrder = e.ids; break;
    case "scene.capture": scene(e.sceneId).clips = Object.fromEntries(p.tracks.map(t => [t.id, t.activeClipId])); break;
    case "scene.activate": { const s = scene(e.sceneId); for (const t of p.tracks) t.activeClipId = s.clips[t.id] ?? null; break; }
    case "arrangement.set": p.arrangement = e.entries; break;
    case "automation.put": if (e.automation.parameter.startsWith("fx.") && !targetDefinition(track(e.automation.trackId), e.automation.parameter)?.automatable) throw new Error("Unsupported FX automation target: " + e.automation.parameter); put(p.automation, e.automation); break;
    case "automation.delete": p.automation = p.automation.filter(a => a.id !== e.automationId); break;
    case "tempo.set": p.tempo = { bpm: e.bpm, beatsPerCycle: e.beatsPerCycle }; break;
    case "project.rename": p.name = e.name; break;
    case "dependencies.set": p.dependencies = e.dependencies; break;
  }
  return validateProject(p);
}
