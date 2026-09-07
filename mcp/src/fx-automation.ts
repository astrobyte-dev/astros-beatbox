import { createHash } from "node:crypto";
import type { ProjectDocument, Track } from "./project.js";
import { definition, type Effect } from "./sound-lab.js";

export const FX_CONTROL_SOUND = "abx_fxcontrol";
export const fxNodeKey = (channel: number, fx: Effect) => `${channel}_${fx.id}_${fx.definitionId}_${fx.version}`;
export function fxAutomationTargets(p: ProjectDocument, track: Track) {
  return (track.effects ?? []).flatMap(effect => {
    const def = definition("effect", effect.definitionId, effect.version);
    return (def?.parameters ?? []).filter(param => param.automatable).map(param => {
      const target = `fx.${effect.id}.${param.id}`;
      const lanes = p.automation.filter(a => a.trackId === track.id && a.parameter === target).sort((a,b) => a.id.localeCompare(b.id));
      // No rack position, base value, modulation or unrelated project revision.
      const token = createHash("sha256").update(JSON.stringify([p.id, track.id, target, effect.definitionId, effect.version, lanes])).digest("hex");
      const key = fxNodeKey(track.channel!, effect);
      const authorizations = [null, ...lanes.filter(a => a.enabled)].map(lane => ({
        laneId: lane?.id ?? "",
        eventId: lane ? `lane_${lane.id}` : "base",
        key: `${key}:${param.id}:${lane ? `lane_${lane.id}` : "base"}`,
        token: createHash("sha256").update(JSON.stringify([p.id, track.id, target, effect.definitionId, effect.version, lane])).digest("hex"),
      }));
      return { effect, parameter: param.id, target, lanes, token, key, authorizations };
    });
  });
}
export function compileFxAutomation(p: ProjectDocument, track: Track, clipId: string | null): string[] {
  return fxAutomationTargets(p, track).filter(t => t.lanes.length).map(t => {
    const enabled = t.lanes.filter(a => a.enabled);
    const lane = enabled.find(a => a.clipId !== null && a.clipId === clipId) ?? enabled.find(a => a.clipId === null);
    // Control events own their rhythm: rests never sample/hold an unrelated note.
    const values = lane?.values ?? [0], bars = lane?.bars ?? 1;
    const authorization = t.authorizations.find(a => a.laneId === (lane?.id ?? ""))!;
    return `(slow ${bars} $ s "${FX_CONTROL_SOUND}*${values.length}" # pS "abxfxkey" "${t.key}" # pS "abxparam" "${t.parameter}" # pS "abxlane" "${authorization.eventId}" # pS "abxtoken" "${authorization.token}" # pF "abxactive" ${lane ? 1 : 0} # pF "abxvalue" "${values.map(v => Number(v.toFixed(6))).join(" ")}")`;
  });
}

// SuperDirt's custom play event returns non-nil, so no voice/gate/global FX is
// created. Tidal determines composition event times; SC delivers a one-shot at
// that event's latency. Control-rate modulation remains inside the insert DSP.
// Capture the runtime dictionaries lexically: Dirt uses its own event environment.
export const INSTALL_FX_AUTOMATION = `
~abxFXAuto = Dictionary.new; ~abxFXAutoSerial = Dictionary.new; ~abxFXAutoVersions = Dictionary.new; ~abxFXAutoActive = Dictionary.new;
~abxFXAutoState = (running: false, epoch: 0, next: 0);
{
  var nodes = ~abxFX, tokens = ~abxFXAuto, serials = ~abxFXAutoSerial, versions = ~abxFXAutoVersions, activeLanes = ~abxFXAutoActive, state = ~abxFXAutoState;
  ~dirt.soundLibrary.addSynth(\\abx_fxcontrol, (play: {
    var key = ~abxfxkey.asString, parameter = ~abxparam.asString, token = ~abxtoken.asString;
    var target = key ++ ":" ++ parameter, value = ~abxvalue, active = ~abxactive;
    var authorization = target ++ ":" ++ (~abxlane ? "base").asString;
    var node = nodes[key], version = versions[authorization];
    var epoch = state[\\epoch], duration = (~delta ? 0.1).max(0.001), latency = (~latency ? 0).max(0);
    SystemClock.sched(latency, {
      var serial;
      if(state[\\running] and: { state[\\epoch] == epoch } and: { tokens[authorization] == token } and: { node.notNil } and: { nodes[key] === node } and: { versions[authorization] == version }) {
        serial = (serials[target] ? 0) + 1; serials[target] = serial; activeLanes[target] = authorization;
        node.set(("a" ++ parameter ++ "value").asSymbol, value.clip(0,1), ("a" ++ parameter ++ "enabled").asSymbol, active.clip(0,1));
        // A finite arrangement, muted slot or lost event returns to base instead
        // of leaving its final automation value latched onto an effect tail.
        SystemClock.sched(duration, {
          if(state[\\epoch] == epoch and: { tokens[authorization] == token } and: { serials[target] == serial } and: { nodes[key] === node } and: { versions[authorization] == version }) {
            node.set(("a" ++ parameter ++ "enabled").asSymbol, 0);
          }; nil;
        });
      }; nil;
    }); true;
  }));
}.value;
`;
export const STOP_FX_AUTOMATION = `~abxFXAutoState[\\running] = false; ~abxFXAutoState[\\epoch] = ~abxFXAutoState[\\epoch] + 1; ~abxFXAuto.keysValuesDo { |target, token| var parts = target.split($:), node = ~abxFX[parts[0]]; if(node.notNil) { node.set(("a" ++ parts[1] ++ "enabled").asSymbol, 0) } }; s.sync;`;
