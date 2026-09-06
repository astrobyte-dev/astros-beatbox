import type { ProjectDocument, ProjectEdit } from "./project.js";

// A curated edit intention, not a browser-owned project or an audition engine.
// Used only for an empty project; validation/application/history stay in P0b.
export function pocketGroove(
  p: ProjectDocument,
  uid = () => globalThis.crypto.randomUUID(),
): ProjectEdit[] {
  if (p.tracks.length || p.clips.length || p.arrangement.length)
    throw new Error(
      "Start the groove in an empty project. Your current jam is kept.",
    );
  const scene = p.scenes.find((s) => s.id === p.sceneOrder[0])!;
  const refs: Record<string, string> = {};
  const edits: ProjectEdit[] = [
    { type: "project.rename", name: "Pocket groove" },
    { type: "tempo.set", bpm: 108, beatsPerCycle: 4 },
  ];
  const voices = [
    {
      name: "Kick",
      sound: "bd",
      level: 0.85,
      steps: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    },
    {
      name: "Snare",
      sound: "sd",
      level: 0.65,
      steps: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    },
    {
      name: "Hi-hat",
      sound: "hh",
      level: 0.5,
      steps: [
        0.7, 0, 0.45, 0, 0.7, 0, 0.45, 0, 0.7, 0, 0.45, 0, 0.7, 0, 0.45, 0.25,
      ],
    },
    {
      name: "Clap",
      sound: "cp",
      level: 0.5,
      steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0],
    },
  ];
  voices.forEach((voice, i) => {
    const tid = uid(),
      cid = uid(),
      aid = uid();
    refs[tid] = cid;
    edits.push(
      {
        type: "asset.put",
        asset: {
          id: aid,
          kind: "sample",
          reference: voice.sound,
          name: voice.sound,
          index: 0,
        },
      },
      {
        type: "track.add",
        track: {
          id: tid,
          name: voice.name,
          slot: i + 1,
          channel: i,
          activeClipId: cid,
          mixer: { level: voice.level, balance: 0, mute: false, solo: false },
        },
      },
      {
        type: "clip.put",
        clip: {
          id: cid,
          trackId: tid,
          name: "Pocket groove",
          kind: "steps",
          assetId: aid,
          steps: voice.steps,
          swing: 0.08,
          parameters: {},
        },
      },
    );
  });
  edits.push({ type: "scene.put", scene: { ...scene, clips: refs } });
  return edits;
}
