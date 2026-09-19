import type { ProjectDocument, ProjectEdit } from "./project.js";
import { definition, synthSource } from "./sound-lab.js";
export function addSynth(
  p: ProjectDocument,
  sceneId: string,
  instrumentId = "dirtymono",
  uid = () => globalThis.crypto.randomUUID(),
): ProjectEdit[] {
  const slot = Array.from({ length: 12 }, (_, i) => i + 1).find(
    (i) => !p.tracks.some((t) => t.slot === i),
  );
  const d = definition("instrument", instrumentId),
    scene = p.scenes.find((s) => s.id === sceneId);
  if (!slot || !d || !scene)
    throw new Error("Choose an available managed channel and instrument");
  const tid = uid(),
    cid = uid(),
    aid = uid();
  return [
    {
      type: "asset.put",
      asset: {
        id: aid,
        kind: "synth",
        reference: d.id,
        name: d.engine,
        index: 0,
      },
    },
    {
      type: "track.add",
      track: {
        id: tid,
        name: d.name,
        slot,
        channel: slot - 1,
        activeClipId: cid,
        source: synthSource(d.id),
        effects: [],
        modulation: [],
        mixer: { level: 0.75, balance: 0, mute: false, solo: false },
      },
    },
    {
      type: "clip.put",
      clip: {
        id: cid,
        trackId: tid,
        kind: "steps",
        name: "First phrase",
        assetId: aid,
        steps: [1, 0, 0, 1, 0, 0, 1, 0],
        notes: [36, 36, 36, 43, 43, 43, 39, 36],
        octave: 0,
        swing: 0,
        parameters: {},
      },
    },
    {
      type: "scene.put",
      scene: { ...scene, clips: { ...scene.clips, [tid]: cid } },
    },
  ];
}
