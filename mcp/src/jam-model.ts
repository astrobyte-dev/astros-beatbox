import { z } from "zod";
import type { ProjectDocument, Track } from "./project.js";
import { definition, targetDefinition } from "./sound-lab.js";

const id = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,100}$/)
  .refine((s) => !["__proto__", "prototype", "constructor"].includes(s));
export const jamScopeSchema = z.enum([
  "track",
  "rhythm",
  "sound",
  "fx",
  "motion",
]);
export type JamScope = z.infer<typeof jamScopeSchema>;
export const jamLockSchema = z
  .object({
    trackId: id,
    scopes: z.array(jamScopeSchema).max(5),
    parameters: z.array(z.string().max(140)).max(128).default([]),
  })
  .strict();
export const macroSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(60),
    value: z.number().finite().min(-1).max(1),
    enabled: z.boolean(),
    targets: z
      .array(
        z
          .object({
            trackId: id,
            parameter: z.string().max(140),
            amount: z.number().finite().min(-0.5).max(0.5),
          })
          .strict(),
      )
      .min(1)
      .max(128),
  })
  .strict();
export const performanceTakeSchema = z
  .object({
    id,
    name: z.string().min(1).max(60),
    sourceRevision: z.number().int().nonnegative(),
    events: z
      .array(
        z
          .object({
            operation: z.string().max(80),
            revision: z.number().int().nonnegative(),
            cycle: z.number().finite().nonnegative().nullable(),
            timing: z.enum(["scheduled", "unavailable"]),
            sceneId: id.optional(),
            macroId: id.optional(),
            value: z.number().finite().min(-1).max(1).optional(),
            description: z.string().max(400),
          })
          .strict(),
      )
      .max(128),
    limitation: z.literal(
      "Event notebook only; gestures are untimed acknowledgements, scene launches retain scheduled cycles. No automatic replay or arrangement conversion.",
    ),
  })
  .strict();
export type PerformanceTake = z.infer<typeof performanceTakeSchema>;
export const jamSchema = z
  .object({
    locks: z
      .array(
        jamLockSchema.extend({
          offsets: z
            .record(z.string().max(140), z.number().finite().min(-1).max(1))
            .refine((v) => Object.keys(v).length <= 128)
            .optional(),
        }),
      )
      .max(16),
    macros: z.array(macroSchema).max(8),
    takes: z.array(performanceTakeSchema).max(8).optional(),
  })
  .strict();
export type JamMacro = z.infer<typeof macroSchema>;
export const variationSchema = z
  .object({
    seed: z.number().int().min(0).max(4294967295),
    intensity: z.enum(["subtle", "fresh", "wild"]),
    trackIds: z.array(id).min(1).max(16),
    scopes: z
      .array(z.enum(["rhythm", "sound", "fx", "motion"]))
      .min(1)
      .max(4),
    operation: z.enum(["variation", "chaos", "fill"]).default("variation"),
  })
  .strict();
export type VariationRequest = z.infer<typeof variationSchema>;
export const verbs = [
  {
    id: "dirt",
    name: "Get Dirtier",
    meaning: "dirt",
    direction: 1,
    description: "Push supported drive and reduce bit resolution.",
  },
  {
    id: "space",
    name: "Add Space",
    meaning: "space",
    direction: 1,
    description: "Raise supported reverb and echo controls.",
  },
  {
    id: "open",
    name: "Open Up",
    meaning: "brightness",
    direction: 1,
    description: "Open supported filters.",
  },
  {
    id: "dark",
    name: "Go Darker",
    meaning: "brightness",
    direction: -1,
    description: "Close supported filters.",
  },
  {
    id: "movement",
    name: "Add Movement",
    meaning: "movement",
    direction: 1,
    description: "Increase supported glide, shimmer and movement.",
  },
  {
    id: "strip",
    name: "Strip Back",
    meaning: "rhythm",
    direction: -1,
    description: "Remove offbeat hits while preserving the first active beat.",
  },
  {
    id: "build",
    name: "Build",
    meaning: "rhythm",
    direction: 1,
    description: "Add a few quiet offbeat hits to active rhythms.",
  },
] as const;
export const verbSchema = z.enum([
  "dirt",
  "space",
  "open",
  "dark",
  "movement",
  "strip",
  "build",
]);
export function locked(
  p: ProjectDocument,
  trackId: string,
  scope: JamScope,
  parameter?: string,
) {
  const lock = p.jam?.locks.find((l) => l.trackId === trackId);
  return (
    !!lock &&
    (lock.scopes.includes("track") ||
      lock.scopes.includes(scope) ||
      (!!parameter && lock.parameters.includes(parameter)))
  );
}
export function semanticTargets(t: Track, includeBypassed = false) {
  const source = t.source;
  const targets =
    source?.type === "synth"
      ? (
          definition("instrument", source.definitionId, source.version)
            ?.parameters ?? []
        ).map((p) => ({
          parameter: "synth." + p.id,
          meta: p,
          scope: "sound" as const,
        }))
      : [];
  return [
    ...targets,
    ...(t.effects ?? [])
      .filter((f) => includeBypassed || f.enabled)
      .flatMap((f) =>
        (definition("effect", f.definitionId, f.version)?.parameters ?? [])
          .filter((p) => p.automatable)
          .map((p) => ({
            parameter: `fx.${f.id}.${p.id}`,
            meta: p,
            scope: "fx" as const,
          })),
      ),
  ].filter((t) => t.meta.jam !== undefined);
}
export function jamCapabilities(p: ProjectDocument) {
  return p.tracks.map((t) => {
    const c = p.clips.find((c) => c.id === t.activeClipId);
    const known =
      t.source?.type !== "synth" ||
      !!definition("instrument", t.source.definitionId, t.source.version);
    const visual = c?.kind === "steps" && known && t.source?.type !== "code";
    const sample =
      c?.kind === "steps" &&
      p.assets.find((a) => a.id === c.assetId)?.kind === "sample";
    const targets =
      c?.kind === "code" || t.source?.type === "code" ? [] : semanticTargets(t);
    const scopes: JamScope[] = [];
    if (visual) {
      scopes.push("rhythm");
      if (
        t.source?.type !== "synth" ||
        targets.some((x) => x.scope === "sound")
      )
        scopes.push("sound");
    }
    if (targets.some((x) => x.scope === "fx")) scopes.push("fx");
    if (
      visual &&
      t.modulation?.some((m) => m.enabled && targetDefinition(t, m.target))
    )
      scopes.push("motion");
    return {
      trackId: t.id,
      name: t.name,
      source:
        c?.kind === "code"
          ? "code"
          : t.source?.type === "synth"
            ? known
              ? "synth"
              : "unavailable synth"
            : c?.kind === "steps"
              ? c.slices?.length
                ? "chops"
                : c.playback?.mode === "loop"
                  ? "phrase loop"
                  : p.assets.find((a) => a.id === c.assetId)?.source?.origin ===
                      "captured"
                    ? "captured sample"
                    : sample
                      ? "sample"
                      : "legacy synth"
              : "silent",
      scopes,
      targets,
      reason: scopes.length
        ? null
        : "No supported active source; code and unavailable definitions are protected.",
    };
  });
}
export function macroOffset(
  p: ProjectDocument,
  trackId: string,
  parameter: string,
) {
  const t = p.tracks.find((t) => t.id === trackId);
  if (
    !t ||
    !semanticTargets(t).some((x) => x.parameter === parameter) ||
    t.source?.type === "code" ||
    p.clips.find((c) => c.id === t.activeClipId)?.kind === "code"
  )
    return 0;
  if (
    locked(p, trackId, parameter.startsWith("fx.") ? "fx" : "sound", parameter)
  )
    return (
      p.jam?.locks.find((l) => l.trackId === trackId)?.offsets?.[parameter] ?? 0
    );
  return Math.max(
    -1,
    Math.min(
      1,
      (p.jam?.macros ?? [])
        .filter((m) => m.enabled)
        .reduce(
          (sum, m) =>
            sum +
            m.targets
              .filter((x) => x.trackId === trackId && x.parameter === parameter)
              .reduce((n, x) => n + m.value * x.amount, 0),
          0,
        ),
    ),
  );
}
// Unknown installed definitions retain project mappings losslessly, but expose
// no executable Jam capability until that exact definition/version is available.
function unavailableTarget(t: Track, key: string) {
  const parts = key.split(".");
  if (
    parts[0] === "synth" &&
    parts.length === 2 &&
    /^[a-z][a-z0-9]*$/.test(parts[1]) &&
    t.source?.type === "synth"
  )
    return !definition("instrument", t.source.definitionId, t.source.version);
  const fx =
    parts[0] === "fx" && parts.length === 3 && /^[a-z][a-z0-9]*$/.test(parts[2])
      ? t.effects?.find((f) => f.id === parts[1])
      : undefined;
  return !!fx && !definition("effect", fx.definitionId, fx.version);
}
export function validateJam(p: ProjectDocument) {
  if (!p.jam) return;
  const unique = (xs: string[]) => {
    if (new Set(xs).size !== xs.length)
      throw new Error("Duplicate Jam constraint or mapping");
  };
  unique((p.jam.takes ?? []).map((t) => t.id));
  unique(p.jam.locks.map((l) => l.trackId));
  unique(p.jam.macros.map((m) => m.id));
  for (const l of p.jam.locks) {
    const t = p.tracks.find((t) => t.id === l.trackId);
    if (!t) throw new Error("Unknown locked track");
    for (const key of Object.keys(l.offsets ?? {}))
      if (
        (!targetDefinition(t, key) && !unavailableTarget(t, key)) ||
        !locked(p, t.id, key.startsWith("fx.") ? "fx" : "sound", key)
      )
        throw new Error("Invalid held macro offset");
    unique(l.scopes);
    unique(l.parameters);
    for (const key of l.parameters)
      if (!targetDefinition(t, key) && !unavailableTarget(t, key))
        throw new Error("Unknown locked parameter");
  }
  for (const m of p.jam.macros) {
    unique(m.targets.map((t) => t.trackId + ":" + t.parameter));
    for (const target of m.targets) {
      const t = p.tracks.find((t) => t.id === target.trackId);
      if (
        !t ||
        (!semanticTargets(t, true).some(
          (x) => x.parameter === target.parameter,
        ) &&
          !unavailableTarget(t, target.parameter))
      )
        throw new Error("Unsupported macro target");
    }
  }
}
// Generic source/FX deletion safely removes dangling mappings in the SAME Undo.
// Bypass retains mappings: it only suspends their audible offsets.
export function pruneJam(p: ProjectDocument) {
  if (!p.jam) return;
  const exists = (trackId: string, key: string) => {
    const t = p.tracks.find((t) => t.id === trackId);
    return t && (!!targetDefinition(t, key) || unavailableTarget(t, key));
  };
  p.jam.locks = p.jam.locks
    .filter((l) => p.tracks.some((t) => t.id === l.trackId))
    .map((l) => ({
      ...l,
      parameters: l.parameters.filter((key) => exists(l.trackId, key)),
      ...(l.offsets
        ? {
            offsets: Object.fromEntries(
              Object.entries(l.offsets).filter(([key]) =>
                exists(l.trackId, key),
              ),
            ),
          }
        : {}),
    }));
  p.jam.macros = p.jam.macros
    .map((m) => ({
      ...m,
      targets: m.targets.filter((t) => exists(t.trackId, t.parameter)),
    }))
    .filter((m) => m.targets.length);
}
