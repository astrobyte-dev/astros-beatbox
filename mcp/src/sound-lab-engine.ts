import {
  instruments,
  effects,
  definition,
  type SoundDefinition,
  type Modulation,
} from "./sound-lab.js";
import type { ProjectDocument } from "./project.js";
import { fxAutomationTargets, fxNodeKey } from "./fx-automation.js";
const n = (v: number) => String(Number(v.toFixed(6)));
// One route per target; base/automation arrives independently of bounded offsets.
// LFO/random and repeating envelope pulses run in scsynth. Voices start their
// own phase on each note; insert processors keep their phase while alive.
// SC binary operators share precedence: keep the modulation product grouped.
function controls(d: SoundDefinition, insert = false) {
  return d.parameters
    .map(
      (p) =>
        `var ${p.id} = (Lag.kr(${insert && p.automatable ? `Select.kr(\\a${p.id}enabled.kr(0), [\\abx${p.id}.kr(${p.default}), \\a${p.id}value.kr(${p.default})])` : `\\abx${p.id}.kr(${p.default})`}, 0.02) + (Select.kr(\\m${p.id}kind.kr(0), [SinOsc.kr(\\m${p.id}rate.kr(1)), LFNoise0.kr(\\m${p.id}rate.kr(1)), EnvGen.kr(Env.perc(0.01, 1), Impulse.kr(\\m${p.id}rate.kr(1)))]) * Lag.kr(\\m${p.id}amount.kr(0), 0.02))).clip(0, 1);`,
    )
    .join("\n");
}
const voices: Record<string, string> = {
  dirtymono: `sig = (Pulse.ar(f, character.linlin(0,1,0.12,0.85)) * 0.55) + (SinOsc.ar(f * 0.5) * sub * 0.5); sig = RLPF.ar(sig, (cutoff.linexp(0,1,45,16000) * (1 + (env * 2))).clip(30,18000), resonance.linlin(0,1,1,0.12)); sig = (sig * drive.linlin(0,1,1,12)).tanh * 0.32;`,
  sub808: `sig = (SinOsc.ar(f * (1 + (EnvGen.kr(Env.perc(0.001,0.15)) * drop * 3))) * sub.linlin(0,1,0.4,1)) + (SinOsc.ar(f * 2) * tone * 0.2); sig = (sig * drive.linlin(0,1,1,7)).tanh * 0.42;`,
  reese: `sig = Saw.ar(f * [1 - (detune * 0.025), 1 + (detune * 0.025)]); sig = RLPF.ar(sig, (cutoff.linexp(0,1,45,16000) * SinOsc.kr(movement.linexp(0,1,0.05,4)).range(0.7,1)).clip(30,18000), 0.5); sig = [sig[0] + (sig[1] * (1-width)), sig[1] + (sig[0] * (1-width))] * 0.5; sig = (sig * drive.linlin(0,1,1,8)).tanh * 0.3;`,
  prism: `sig = SelectX.ar(shape * 2, [SinOsc.ar(f), LFTri.ar(f), Pulse.ar(f, tone.linlin(0,1,0.1,0.9))]); sig = RLPF.ar(sig, (cutoff.linexp(0,1,60,16000) * SinOsc.kr(movement.linexp(0,1,0.05,5)).range(0.8,1)).clip(30,18000), 0.6) * 0.32;`,
  static: `sig = SinOsc.ar(f * (1 + (LFNoise1.kr(6) * instability * 0.2)), SinOsc.ar(f * metal.linlin(0,1,1,9)) * metal * 8) * (1-noise) + PinkNoise.ar(noise); sig = RLPF.ar(sig, cutoff.linexp(0,1,80,16000), 0.3); sig = (sig * drive.linlin(0,1,1,8)).tanh * 0.28;`,
};
const processors: Record<string, string> = {
  filter: `wet = RLPF.ar(dry, cutoff.linexp(0,1,35,18000), resonance.linlin(0,1,1,0.12));`,
  distortion: `wet = XFade2.ar(dry, (dry * drive.linlin(0,1,1,20)).tanh * 0.7, mix * 2 - 1);`,
  crush: `wet = Latch.ar(dry, Impulse.ar(rate.linexp(0,1,300,24000))); wet = wet.round(2 ** (0 - bits.linlin(0,1,2,16))); wet = dry.blend(wet, mix);`,
  reverb: `wet = FreeVerb2.ar(dry[0], dry[1], mix, size * 0.95, damping);`,
  delay: `wet = dry + (CombC.ar(dry, 2, Lag.kr(time.linexp(0,1,0.02,1.5),0.1), feedback.linlin(0,1,0.05,4)) * mix * 0.65);`,
  chorus: `wet = dry.blend(DelayC.ar(dry,0.06,SinOsc.kr(rate.linexp(0,1,0.05,5),[0,1.57]).range(0.015,0.015 + (depth * 0.02))),mix);`,
  compressor: `wet = Compander.ar(dry, dry, threshold.linexp(0,1,0.05,0.9),1,amount.linlin(0,1,1,0.2),0.01,0.15);`,
  ring: `wet = dry.blend(dry * SinOsc.ar(frequency.linexp(0,1,10,4000)),mix);`,
};
export const SOUND_LAB_SYNTHS =
  instruments
    .map(
      (
        d,
      ) => `SynthDef(\\${d.engine}, { |out, sustain = 1, freq = 110, pan = 0, abxprev = 110|
${controls(d)}
var f, env, sig;
f = ${d.parameters.some((p) => p.id === "glide") ? "Line.kr(abxprev.max(8), freq.max(8), (glide * 0.6).max(0.001))" : "freq.max(8)"}.clip(8,16000);
env = EnvGen.kr(Env.perc(${d.parameters.some((p) => p.id === "attack") ? "attack.linexp(0,1,0.002,0.8)" : "0.003"}, ${d.id === "prism" ? "((decay * 2) + (release * 2) + 0.05)" : "decay.linexp(0,1,0.04,4)"}), timeScale: sustain.clip(0.02,8), doneAction: 2);
${voices[d.id]}
Out.ar(out, DirtPan.ar(LeakDC.ar(sig).clip2(0.9), 2, pan, env));
}).add;`,
    )
    .join("\n") +
  effects
    .map(
      (d) => `SynthDef(\\${d.engine}, { |bus, enabled = 1|
${controls(d, true)}
var dry = In.ar(bus,2), wet;
${processors[d.id]}
ReplaceOut.ar(bus, dry.blend(Limiter.ar(LeakDC.ar(wet),0.95,0.002), Lag.kr(enabled.clip(0,1),0.02)));
}).add;`,
    )
    .join("\n");
export function modulationControls(
  routes: Modulation[],
  prefix: string,
): Record<string, number> {
  return Object.fromEntries(
    routes
      .filter((m) => m.target.startsWith(prefix))
      .flatMap((m) => {
        const key = m.target.slice(prefix.length);
        return [
          ["m" + key + "amount", m.enabled ? m.amount : 0],
          ["m" + key + "rate", m.rate],
          ["m" + key + "kind", ["lfo", "random", "envelope"].indexOf(m.source)],
        ];
      }),
  );
}
// Persistent per-instance processors, ordered before the existing channel fader.
// No bus/node IDs are authored. Generation reset reinstalls an empty dictionary.
export function rackCommand(p: ProjectDocument, running = true): string {
  const instances = p.tracks.flatMap((t) =>
    (t.effects ?? []).flatMap((f) => {
      const d = definition("effect", f.definitionId, f.version);
      return d && t.channel !== null
        ? [
            {
              t,
              f,
              d,
              key:
                fxNodeKey(t.channel, f),
            },
          ]
        : [];
    }),
  );
  const keys = instances.map((x) => '"' + x.key + '"').join(",");
  const targets = p.tracks.filter(t => t.channel !== null).flatMap(t => fxAutomationTargets(p, t)).filter(t => t.lanes.length);
  const authorizations = targets.flatMap(t => t.authorizations);
  const targetKeys = authorizations.map(a => JSON.stringify(a.key)).join(",");
  // Invalidate only the removed/changed lane. Editing a different scene must
  // neither reset the active selector nor revoke its already queued events.
  const reset = `var parts = authorization.split($:), target = parts[0] ++ ":" ++ parts[1], node = ~abxFX[parts[0]]; if(node.notNil and: { ~abxFXAutoActive[target] == authorization }) { node.set(("a" ++ parts[1] ++ "enabled").asSymbol, 0); ~abxFXAutoActive.removeAt(target) };`;
  const automation = `if(~abxFXAutoState[\\running] != ${running}) { ~abxFXAutoState[\\epoch] = ~abxFXAutoState[\\epoch] + 1 }; ~abxFXAutoState[\\running] = ${running}; ` +
    `~abxFXAuto.keys.asArray.do { |authorization| if([${targetKeys}].includesEqual(authorization).not) { ${reset} ~abxFXAuto.removeAt(authorization); ~abxFXAutoVersions.removeAt(authorization) } }; ` +
    authorizations.map(a => `if((~abxFXAuto["${a.key}"] != "${a.token}") or: { ${!running} }) { var authorization = "${a.key}"; ${reset} ~abxFXAutoState[\\next] = ~abxFXAutoState[\\next] + 1; ~abxFXAutoVersions[authorization] = ~abxFXAutoState[\\next] }; ~abxFXAuto["${a.key}"] = "${a.token}";`).join(" ") +
    ` ~abxFXAutoSerial.keys.asArray.do { |target| if(~abxFX[target.split($:)[0]].isNil) { ~abxFXAutoSerial.removeAt(target); ~abxFXAutoActive.removeAt(target) } };`;
  return (
    `~abxFX.keys.asArray.do { |key| if([${keys}].includesEqual(key).not) { ~abxFX.removeAt(key).free } }; ` +
    instances
      .map(({ t, f, d, key }) => {
        const mods = modulationControls(t.modulation ?? [], "fx." + f.id + ".");
        const values = Object.fromEntries(
          d.parameters.flatMap((param) => [
            ["abx" + param.id, f.values[param.id]],
            ["m" + param.id + "amount", 0],
            ["m" + param.id + "rate", 1],
            ["m" + param.id + "kind", 0],
          ]),
        );
        Object.assign(values, mods, { enabled: f.enabled ? 1 : 0 });
        const args = Object.entries(values)
          .map(([k, v]) => `\\${k}, ${n(v)}`)
          .join(", ");
        return `if(~abxFX["${key}"].isNil) { ~abxFX["${key}"] = Synth.before(~abxChannels[${t.channel}], \\${d.engine}, [\\bus, ~abxBuses[${t.channel}].index, ${args}]) } { ~abxFX["${key}"].set(${args}) }; ~abxFX["${key}"].moveBefore(~abxChannels[${t.channel}]);`;
      })
      .join(" ") +
    automation + " s.sync;"
  );
}
