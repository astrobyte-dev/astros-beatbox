import { createHash } from "node:crypto";
import {
  clone,
  validateProject,
  applyEdits,
  type ProjectDocument,
  type StepClip,
} from "./project.js";
import { defaultPlayback } from "./sampling.js";
import {
  jamCapabilities,
  locked,
  semanticTargets,
  variationSchema,
  verbs,
  type VariationRequest,
  type JamScope,
  type JamMacro,
} from "./jam-model.js";

export const JAM_ALGORITHM = 1;
export type JamSummary = {
  changed: string[];
  kept: string[];
  sourceRevision: number;
  seed?: number;
  intensity?: string;
  operation: string;
  algorithm: number;
  trackIds: string[];
  scopes: string[];
};
const clamp = (v: number, lo = 0, hi = 1) =>
  Number(Math.max(lo, Math.min(hi, v)).toFixed(6));
function move(value: number, delta: number, lo = 0, hi = 1) {
  const next = clamp(value + delta, lo, hi);
  return next === value ? clamp(value - delta, lo, hi) : next;
}
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function jamSummary(
  p: ProjectDocument,
  operation: string,
  trackIds: string[],
  scopes: string[],
): JamSummary {
  return {
    changed: [],
    kept: [],
    sourceRevision: p.revision,
    operation,
    algorithm: JAM_ALGORITHM,
    trackIds,
    scopes,
  };
}
function selected(p: ProjectDocument, ids: string[]) {
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !p.tracks.some((t) => t.id === id))
  )
    throw new Error("Choose distinct existing Jam tracks");
  return p.tracks.filter((t) => ids.includes(t.id));
}
function finish(
  p: ProjectDocument,
  next: ProjectDocument,
  summary: JamSummary,
) {
  summary.kept = p.tracks.flatMap((t) => {
    const n = next.tracks.find((n) => n.id === t.id)!;
    const clip = p.clips.find((c) => c.id === t.activeClipId),
      after = next.clips.find((c) => c.id === t.activeClipId);
    if (
      JSON.stringify(t) === JSON.stringify(n) &&
      JSON.stringify(clip) === JSON.stringify(after)
    )
      return [t.name];
    return (p.jam?.locks.find((l) => l.trackId === t.id)?.scopes ?? []).map(
      (scope) => `${t.name} ${scope}`,
    );
  });
  if (!summary.changed.length)
    throw new Error(
      "Nothing eligible to change. Unlock a supported part or choose another action; silence is preserved.",
    );
  return { document: validateProject(next), summary };
}
function rhythm(
  c: StepClip,
  random: () => number,
  count: number,
  mode: "variation" | "build" | "strip" | "fill",
) {
  const active = c.steps.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  if (!active.length) return; // Deliberate silence stays silent at every intensity.
  const anchor = active[0],
    cap = Math.max(active.length, Math.ceil(c.steps.length * 0.75));
  const candidates = c.steps
    .map((_, i) => i)
    .filter(
      (i) =>
        i !== anchor &&
        (mode !== "fill" || i >= Math.floor(c.steps.length * 0.75)),
    );
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  let changes = 0;
  for (const i of candidates) {
    if (changes >= count) break;
    const density = c.steps.filter((v) => v > 0).length;
    if (mode === "strip") {
      if (!c.steps[i] || i % 4 === 0) continue;
      c.steps[i] = 0;
    } else if (mode === "build" || mode === "fill") {
      if (c.steps[i] || density >= cap) continue;
      c.steps[i] = i % 4 === 0 ? 0.8 : 0.45;
    } else if (c.steps[i])
      c.steps[i] =
        random() > 0.5 && density > Math.max(1, Math.floor(active.length * 0.5))
          ? 0
          : clamp(c.steps[i] + (random() > 0.5 ? 0.15 : -0.15), 0.2, 1.2);
    else {
      if (density >= cap) continue;
      c.steps[i] = i % 4 === 0 ? 0.8 : 0.45;
    }
    changes++;
  }
}
export function makeVariation(p: ProjectDocument, input: VariationRequest) {
  const request = variationSchema.parse(input),
    next = clone(p),
    summary = jamSummary(
      p,
      request.operation,
      request.trackIds,
      request.scopes,
    );
  if (new Set(request.scopes).size !== request.scopes.length)
    throw new Error("Choose distinct variation scopes");
  const tracks = selected(next, request.trackIds),
    capabilities = jamCapabilities(p),
    amount = { subtle: 0.08, fresh: 0.2, wild: 0.4 }[request.intensity];
  Object.assign(summary, { seed: request.seed, intensity: request.intensity });
  for (const t of tracks) {
    const caps = capabilities.find((c) => c.trackId === t.id)!;
    // Track-level protection permits selecting heterogeneous projects. Explicit
    // unsupported unlocked scope requests reject the whole transaction.
    if (locked(p, t.id, "track")) continue;
    for (const scope of request.scopes)
      if (!locked(p, t.id, scope) && !caps.scopes.includes(scope))
        throw new Error(
          `${t.name} does not support ${scope}; keep it or choose a supported scope.`,
        );
    const random = seeded(
      parseInt(digest([request.seed, t.id]).slice(0, 8), 16),
    );
    const c = next.clips.find((c) => c.id === t.activeClipId);
    const count =
      c?.kind === "steps"
        ? Math.max(1, Math.floor(c.steps.length * amount))
        : 1;
    for (const scope of request.scopes) {
      if (locked(p, t.id, scope)) continue;
      const before = JSON.stringify([t, c]);
      if (scope === "rhythm" && c?.kind === "steps")
        rhythm(
          c,
          random,
          count,
          request.operation === "fill" ? "fill" : "variation",
        );
      if (scope === "sound" && c?.kind === "steps") {
        if (t.source?.type === "synth") {
          const targets = semanticTargets(t).filter(
            (x) =>
              x.scope === "sound" && !locked(p, t.id, "sound", x.parameter),
          );
          const target = targets[Math.floor(random() * targets.length)];
          if (target) {
            const key = target.meta.id;
            t.source.values[key] = move(
              t.source.values[key],
              random() > 0.5 ? amount : -amount,
            );
            delete t.source.presetId;
          }
          // Notes use a small transposition of the existing pitch collection.
          // Sound lock also protects notes; rhythm lock protects placement/velocity.
          if (
            request.intensity !== "subtle" &&
            c.notes &&
            !p.jam?.locks.find((l) => l.trackId === t.id)?.parameters.length
          ) {
            const shift = random() > 0.5 ? 12 : -12;
            if (c.notes.every((n) => n + shift >= 0 && n + shift <= 127))
              c.notes = c.notes.map((n) => n + shift);
          }
        } else {
          if (c.slices?.length && c.sliceSteps) {
            c.sliceSteps = c.sliceSteps.map((slice, i) =>
              c.steps[i] && random() < amount
                ? c.slices![Math.floor(random() * c.slices!.length)].id
                : slice,
            );
          } else {
            const playback = c.playback ?? defaultPlayback();
            c.playback = {
              ...playback,
              pitch: move(
                playback.pitch,
                (random() > 0.5 ? 1 : -1) *
                  (request.intensity === "wild"
                    ? 7
                    : request.intensity === "fresh"
                      ? 2
                      : 1),
                -24,
                24,
              ),
            };
          }
        }
      }
      if (scope === "fx")
        for (const target of semanticTargets(t).filter(
          (x) => x.scope === "fx" && !locked(p, t.id, "fx", x.parameter),
        )) {
          const f = t.effects!.find(
            (f) => f.id === target.parameter.split(".")[1],
          )!;
          f.values[target.meta.id] = move(
            f.values[target.meta.id],
            (random() > 0.5 ? amount : -amount) * Math.sign(target.meta.jam!),
          );
          delete f.presetId;
        }
      if (scope === "motion")
        for (const m of t.modulation ?? [])
          if (
            m.enabled &&
            !locked(
              p,
              t.id,
              m.target.startsWith("fx.") ? "fx" : "sound",
              m.target,
            )
          )
            m.amount = move(m.amount, random() > 0.5 ? amount : -amount, -1, 1);
      if (JSON.stringify([t, c]) !== before)
        summary.changed.push(`${t.name} ${scope}`);
    }
  }
  return finish(p, next, summary);
}
export function applyVerb(
  p: ProjectDocument,
  verbId: string,
  trackIds: string[],
) {
  const recipe = verbs.find((v) => v.id === verbId);
  if (!recipe) throw new Error("Unknown musical verb");
  const next = clone(p),
    summary = jamSummary(p, recipe.name, trackIds, [recipe.meaning]);
  for (const t of selected(next, trackIds)) {
    const cap = jamCapabilities(p).find((x) => x.trackId === t.id)!;
    const c = next.clips.find((c) => c.id === t.activeClipId);
    if (recipe.meaning === "rhythm") {
      if (
        !cap.scopes.includes("rhythm") ||
        locked(p, t.id, "rhythm") ||
        c?.kind !== "steps"
      )
        continue;
      const before = JSON.stringify(c.steps);
      rhythm(
        c,
        seeded(0),
        Math.max(1, Math.floor(c.steps.length / 4)),
        recipe.direction > 0 ? "build" : "strip",
      );
      if (before !== JSON.stringify(c.steps))
        summary.changed.push(`${t.name} rhythm`);
    } else
      for (const target of cap.targets.filter(
        (x) =>
          x.meta.meaning === recipe.meaning &&
          !locked(p, t.id, x.scope, x.parameter),
      )) {
        const values =
          target.scope === "sound" && t.source?.type === "synth"
            ? t.source
            : t.effects!.find((f) => f.id === target.parameter.split(".")[1])!;
        const before = values.values[target.meta.id];
        values.values[target.meta.id] = clamp(
          before + target.meta.jam! * recipe.direction * 0.5,
        );
        if (before !== values.values[target.meta.id]) {
          delete values.presetId;
          summary.changed.push(`${t.name} ${target.meta.name.toLowerCase()}`);
        }
      }
  }
  return finish(p, next, summary);
}
export function suggestedMacros(p: ProjectDocument): JamMacro[] {
  return ["dirt", "space", "movement", "brightness"].flatMap((meaning) => {
    const targets = jamCapabilities(p).flatMap((c) =>
      c.targets
        .filter((x) => x.meta.meaning === meaning)
        .map((x) => ({
          trackId: c.trackId,
          parameter: x.parameter,
          amount: x.meta.jam!,
        })),
    );
    return targets.length
      ? [
          {
            id: "jam_" + meaning,
            name:
              meaning === "brightness"
                ? "Brightness"
                : meaning[0].toUpperCase() + meaning.slice(1),
            value: 0,
            enabled: true,
            targets: targets.slice(0, 128),
          },
        ]
      : [];
  });
}
// Promotion copies the active clips, including independent clip automation. P3
// instruments/FX remain project-wide; there is no hidden scene patch authority.
export function promoteJam(p: ProjectDocument, sceneId: string, name: string) {
  const source = p.scenes[0];
  const staged = clone(p);
  staged.scenes[0].clips = Object.fromEntries(
    p.tracks.map((t) => [t.id, t.activeClipId]),
  );
  const next = applyEdits(staged, [
    { type: "scene.duplicate", sceneId: source.id, newSceneId: sceneId, name },
  ]);
  next.scenes[0] = clone(source);
  return validateProject(next);
}
