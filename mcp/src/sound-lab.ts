import { z } from "zod";

// Browser-safe metadata shared by project validation, compiler, MCP and Studio.
// Authored controls are normalized; DSP mappings and display units are explicit.
export interface SoundParameter {
  id: string;
  name: string;
  default: number;
  min: number;
  max: number;
  step: number;
  meaning: string;
  // Signed normalized travel for Jam recipes/macros; the existing meaning is
  // the semantic identity. Omitted controls are deliberately not Jam targets.
  jam?: number;
  automatable?: boolean;
  advanced?: boolean;
  unit?: string;
}
export interface SoundDefinition {
  id: string;
  version: number;
  name: string;
  category: string;
  description: string;
  engine: string;
  parameters: SoundParameter[];
  presets: { id: string; name: string; values: Record<string, number> }[];
}
const control = (
  id: string,
  name: string,
  value: number,
  meaning = "tone",
  advanced = false,
): SoundParameter => ({
  id,
  name,
  default: value,
  min: 0,
  max: 1,
  step: 0.001,
  unit: "%",
  meaning,
  ...(!advanced && ["brightness", "dirt", "space", "movement", "energy"].includes(meaning) ? { jam: 0.35 } : {}),
  automatable: true,
  advanced,
});
const instrument = (
  id: string,
  name: string,
  category: string,
  description: string,
  parameters: SoundParameter[],
  patches: [string, Record<string, number>][],
): SoundDefinition => ({
  id,
  version: 1,
  name,
  category,
  description,
  engine: "abx_" + id,
  parameters,
  presets: patches.map(([name, values], i) => ({
    id: id + "_" + i,
    name,
    values: { ...defaults({ parameters }), ...values },
  })),
});
export function defaults(
  d: Pick<SoundDefinition, "parameters">,
): Record<string, number> {
  return Object.fromEntries(d.parameters.map((p) => [p.id, p.default]));
}
const cutoff = () => control("cutoff", "Cutoff", 0.58, "brightness");
const drive = () => control("drive", "Drive", 0.2, "dirt");
const glide = () => control("glide", "Glide", 0, "movement");
const decay = () => control("decay", "Decay", 0.35, "energy");
export const instruments: SoundDefinition[] = [
  instrument(
    "dirtymono",
    "Dirty Mono",
    "Bass",
    "A pulse, a sub and a bad attitude.",
    [
      cutoff(),
      drive(),
      control("resonance", "Resonance", 0.25),
      control("character", "Character", 0.35),
      glide(),
      control("sub", "Sub", 0.4),
      { ...decay(), advanced: true },
      control("attack", "Attack", 0.01, "energy", true),
    ],
    [
      ["Clean Pulse", { drive: 0.05, character: 0.15 }],
      ["Warehouse", { drive: 0.65, cutoff: 0.4, resonance: 0.5 }],
      ["Corroded", { drive: 0.9, character: 0.85 }],
    ],
  ),
  instrument(
    "sub808",
    "808 Sub",
    "Bass",
    "Deep sine weight with a falling pitch and sliding notes.",
    [
      control("tone", "Tone", 0.2),
      decay(),
      control("drop", "Pitch drop", 0.2),
      drive(),
      glide(),
      control("sub", "Weight", 0.6),
    ],
    [
      ["Deep", { drop: 0.08, decay: 0.65 }],
      ["Knock", { drop: 0.7, decay: 0.2, drive: 0.4 }],
      ["Long Slide", { glide: 0.6, decay: 0.8 }],
    ],
  ),
  instrument(
    "reese",
    "Reese",
    "Bass",
    "Detuned saws that drift across a wide stereo field.",
    [
      control("detune", "Detune", 0.35),
      control("width", "Width", 0.6),
      control("movement", "Movement", 0.25, "movement"),
      cutoff(),
      drive(),
      decay(),
    ],
    [
      ["Wide Dark", { cutoff: 0.35, width: 0.85 }],
      ["Moving", { movement: 0.7, detune: 0.6 }],
    ],
  ),
  instrument(
    "prism",
    "Prism",
    "Synth",
    "From rounded plucks to bright leads and slow clouds.",
    [
      control("shape", "Shape", 0.35),
      control("tone", "Tone", 0.45),
      cutoff(),
      decay(),
      control("movement", "Movement", 0.15, "movement"),
      control("attack", "Attack", 0.02, "energy", true),
      control("release", "Release", 0.3, "energy", true),
    ],
    [
      ["Glass Pluck", { shape: 0.1, decay: 0.2 }],
      ["Soft Cloud", { attack: 0.6, release: 0.8, decay: 0.8, cutoff: 0.45 }],
    ],
  ),
  instrument(
    "static",
    "Static Bloom",
    "Experimental",
    "Metal, air and unstable resonances under control.",
    [
      control("noise", "Air", 0.35),
      control("metal", "Metal", 0.4),
      control("instability", "Instability", 0.2, "movement"),
      cutoff(),
      decay(),
      drive(),
    ],
    [
      ["Rust", { metal: 0.8, noise: 0.2 }],
      ["Atmosphere", { noise: 0.7, decay: 0.85, cutoff: 0.3 }],
    ],
  ),
];
// Deliberate composition surface. Delay time, rate/frequency controls and
// compressor threshold remain manual/modulation targets pending native evaluation.
const fxAutomatable: Record<string, string[]> = {
  filter: ["cutoff", "resonance"], distortion: ["drive", "mix"],
  crush: ["bits", "mix"], reverb: ["size", "mix"], delay: ["feedback", "mix"],
  chorus: ["depth", "mix"], compressor: ["amount"], ring: ["mix"],
};
export const effects: SoundDefinition[] = [
  instrument(
    "filter",
    "Filter",
    "Tone",
    "Sculpt the edges.",
    [cutoff(), control("resonance", "Resonance", 0.15)],
    [["Warm", { cutoff: 0.45 }]],
  ),
  instrument(
    "distortion",
    "Distortion",
    "Dirt",
    "Soft saturation into harder clipping.",
    [drive(), control("mix", "Mix", 0.5)],
    [["Grit", { drive: 0.55, mix: 0.6 }]],
  ),
  instrument(
    "crush",
    "Bitcrush",
    "Dirt",
    "Coarse steps and broken digital edges.",
    [
      { ...control("bits", "Resolution", 0.7, "dirt"), jam: -0.35 },
      control("rate", "Sample rate", 0.8),
      control("mix", "Mix", 0.35, "dirt"),
    ],
    [["Broken", { bits: 0.25, rate: 0.3 }]],
  ),
  instrument(
    "reverb",
    "Reverb",
    "Space",
    "A room around your sound.",
    [
      control("size", "Size", 0.5, "space"),
      control("damping", "Damping", 0.5),
      control("mix", "Mix", 0.2, "space"),
    ],
    [
      ["Room", { size: 0.3 }],
      ["Cloud", { size: 0.9, mix: 0.45 }],
    ],
  ),
  instrument(
    "delay",
    "Delay",
    "Space",
    "A bounded trail of echoes.",
    [
      control("time", "Time", 0.3, "space"),
      control("feedback", "Repeats", 0.3, "space"),
      control("mix", "Mix", 0.25, "space"),
    ],
    [["Slap", { time: 0.05, feedback: 0.1 }]],
  ),
  instrument(
    "chorus",
    "Chorus",
    "Movement",
    "Slow stereo shimmer.",
    [
      control("rate", "Rate", 0.2, "movement"),
      control("depth", "Depth", 0.4, "movement"),
      control("mix", "Mix", 0.35, "movement"),
    ],
    [["Shimmer", { depth: 0.7 }]],
  ),
  instrument(
    "compressor",
    "Compressor",
    "Dynamics",
    "Gentle dynamic control.",
    [
      control("threshold", "Threshold", 0.6, "energy"),
      control("amount", "Amount", 0.3, "energy"),
    ],
    [["Glue", { amount: 0.45 }]],
  ),
  instrument(
    "ring",
    "Ring Mod",
    "Weird",
    "Turn harmonics into bells and machinery.",
    [control("frequency", "Frequency", 0.3), control("mix", "Mix", 0.3)],
    [["Machine", { frequency: 0.55, mix: 0.65 }]],
  ),
].map(d => ({ ...d, engine: "abxfx_" + d.id, parameters: d.parameters.map(p => ({ ...p, automatable: fxAutomatable[d.id].includes(p.id) })) }));
const identity = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,100}$/)
  .refine((s) => !["__proto__", "prototype", "constructor"].includes(s));
export const soundValues = z.record(
  z.string().regex(/^[a-z][a-z0-9]{0,31}$/),
  z.number().finite().min(0).max(1),
);
const patch = {
  definitionId: identity,
  version: z.number().int().min(1).max(10000),
  values: soundValues,
  presetId: identity.optional(),
};
export const sourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sample") }).strict(),
  z.object({ type: z.literal("synth"), ...patch }).strict(),
  z.object({ type: z.literal("code") }).strict(),
]);
export const effectSchema = z
  .object({ id: identity, ...patch, enabled: z.boolean() })
  .strict();
export const routeSchema = z
  .object({
    id: identity,
    target: z
      .string()
      .regex(/^(synth\.[a-z][a-z0-9]*|fx\.[a-zA-Z0-9_-]+\.[a-z][a-z0-9]*)$/),
    source: z.enum(["lfo", "random", "envelope"]),
    amount: z.number().finite().min(-1).max(1),
    rate: z.number().finite().min(0.02).max(20),
    enabled: z.boolean(),
  })
  .strict();
export const patchSchema = z
  .object({
    id: identity,
    name: z.string().min(1).max(80),
    kind: z.enum(["instrument", "effect"]),
    ...patch,
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type Modulation = z.infer<typeof routeSchema>;
export type Patch = z.infer<typeof patchSchema>;
export function definition(
  kind: "instrument" | "effect",
  id: string,
  version = 1,
) {
  return (kind === "instrument" ? instruments : effects).find(
    (d) => d.id === id && d.version === version,
  );
}
export function synthSource(id: string): Extract<Source, { type: "synth" }> {
  const d = definition("instrument", id);
  if (!d) throw new Error("Unknown instrument");
  return {
    type: "synth",
    definitionId: id,
    version: d.version,
    values: { ...d.presets[0].values },
    presetId: d.presets[0].id,
  };
}
export function validateValues(
  d: SoundDefinition | undefined,
  values: Record<string, number>,
) {
  // Unknown definitions/versions are retained losslessly but never executed.
  if (
    d &&
    (Object.keys(values).length !== d.parameters.length ||
      d.parameters.some((p) => values[p.id] === undefined))
  )
    throw new Error("Sound parameter set does not match definition");
}
export function targetDefinition(
  t: { source?: Source; effects?: Effect[] },
  target: string,
): SoundParameter | undefined {
  const parts = target.split(".");
  const d =
    parts[0] === "synth" && t.source?.type === "synth"
      ? definition("instrument", t.source.definitionId, t.source.version)
      : parts[0] === "fx"
        ? (() => {
            const fx = t.effects?.find((e) => e.id === parts[1]);
            return fx && definition("effect", fx.definitionId, fx.version);
          })()
        : undefined;
  return d?.parameters.find((p) => p.id === parts.at(-1));
}
