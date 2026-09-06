// Opt-in Windows audio verification; temporary files and owned engines only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Engine, assertAudioPortsFree } from "./engine.js";
import { Application } from "./application.js";
import { Meter } from "./meter.js";
import { METER_UDP_PORT, DIRT_SAMPLES_DIR } from "./config.js";
import { type ProjectEdit } from "./project.js";
import { compileClip, compileArrangement } from "./project-compiler.js";

const dir = mkdtempSync(path.join(tmpdir(), "abx-p0b-live-")), engine = new Engine(), meter = new Meter();
const app = new Application(engine, { sets: dir, recordings: dir, projects: dir, recovery: path.join(dir, "recovery"), samples: DIRT_SAMPLES_DIR, device: path.join(dir, "device.txt") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function send(cmd: string, args: object = {}) { const p = app.project.document, r = await app.dispatchExternal({ cmd, projectId: p.id, revision: p.revision, ...args }); assert.equal(r.ok, true, JSON.stringify(r)); return r; }
const edit = (edits: ProjectEdit[]) => send("project.edit", { edits, label: "Live validation" });
async function levels() { await sleep(350); let l = 0, r = 0; for (let i = 0; i < 6; i++) { await sleep(70); l += meter.l; r += meter.r; } const result = [l / 6, r / 6]; process.stdout.write("Probe levels: " + result + "\n"); return result; }
try {
  await meter.start(METER_UDP_PORT); process.stdout.write("P0b: booting owned engines...\n"); await send("boot"); assert.equal(engine.state, "ready", engine.error ?? "");
  const p = app.project.document;
  await edit([
    { type: "asset.put", asset: { id: "bd", name: "bd", reference: "bd", index: 0, kind: "sample" } },
    { type: "track.add", track: { id: "t1", name: "Kick", slot: 1, channel: 0, activeClipId: "c1", mixer: { level: 1, balance: 0, mute: false, solo: false } } },
    { type: "track.add", track: { id: "t2", name: "Channel 2", slot: 2, channel: 1, activeClipId: null, mixer: { level: 1, balance: 0, mute: false, solo: false } } },
    { type: "clip.put", clip: { id: "c1", trackId: "t1", name: "A", kind: "steps", assetId: "bd", steps: [1, 0, 0.35, 0, 0.8, 0, 0.2, 0], swing: 0.1, parameters: { gain: 0.7, room: 0.2, shape: 0.1 } } },
    { type: "automation.put", automation: { id: "a1", trackId: "t1", clipId: "c1", parameter: "gain", bars: 2, enabled: true, values: [0.2, 0.8, 0.5, 0.9] } },
    { type: "scene.capture", sceneId: p.sceneOrder[0] },
    { type: "arrangement.set", entries: [{ id: "e1", sceneId: p.sceneOrder[0], cycles: 2 }, { id: "e2", sceneId: p.sceneOrder[1], cycles: 1 }] },
  ]);
  await send("resume"); await sleep(1000);
  const pattern = compileClip(app.project.document, app.project.document.clips[0]);
  // Force event values as well as the pattern's outer action, catching lazy map
  // arithmetic errors that a d1 action acknowledgement alone cannot prove absent.
  const values = await engine.tidal.eval(`print $ queryArc (${pattern}) (Arc 0 2)`, "compiler-values");
  assert.match(values.output, /gain/); assert.doesNotMatch(values.output, /Exception|error:/);
  const song = compileArrangement(app.project.document).d1;
  const songValues = await engine.tidal.eval(`print $ map (whole) $ queryArc (${song}) (Arc 0 3)`, "arrangement-events");
  assert.match(songValues.output, /Just/);
  await send("song.start"); await sleep(500); await send("song.stop"); await send("stop"); await sleep(1200);
  // The preceding compiler exercise enables room=0.2. SuperDirt's persistent,
  // modulated reverb keeps processing the injected sine even after Tidal Stop;
  // interference makes this supposedly steady measurement vary between runs.
  // Isolate the held dry probe, retaining all mixer assertions and authored FX.
  await engine.sclang.evalRoutine("~dirt.orbits.do { |o| o.getGlobalEffect(\\dirt_reverb).synth.set(\\room, 0, \\dry, 1) }; s.sync;", "isolate-held-probe");
  // One finite, unchanging stereo source through the actual Dirt dry+FX monitor
  // path. Faders below cannot retrigger it: only the persistent channel node changes.
  await engine.sclang.evalRoutine(`SynthDef(\\abxHeldProbe, { |out| Out.ar(out, [SinOsc.ar(440, 0, 0.06), SinOsc.ar(660, 0, 0.03)] * EnvGen.kr(Env.linen(0.01, 25, 0.01), doneAction: 2)); }).add; s.sync; ~held1 = Synth.head(~dirt.orbits[0].group, \\abxHeldProbe, [\\out, ~dirt.orbits[0].dryBus.index]); s.sync;`, "held-probe");
  await engine.sclang.evalRoutine("~dirt.orbits[0].getGlobalEffect(\\dirt_monitor).resume; s.sync;", "wake-monitor");
  const initial = await levels(); process.stdout.write("Held probe initial: " + initial + "\n"); assert.ok(initial[0] > 0.025 && initial[1] > 0.012, "held stereo tone must reach master");
  const clipBefore = app.project.document.clips;
  await edit([{ type: "mixer.set", trackId: "t1", values: { level: 0.25 } }]); const low = await levels();
  assert.ok(low[0] / initial[0] > 0.17 && low[0] / initial[0] < 0.33, "held tone follows fader without another note");
  await edit([{ type: "mixer.set", trackId: "t1", values: { level: 1, balance: -1 } }]); const left = await levels(); assert.ok(left[0] > 0.025 && left[1] < 0.002);
  await edit([{ type: "mixer.set", trackId: "t1", values: { balance: 1 } }]); const right = await levels(); assert.ok(right[0] < 0.002 && right[1] > 0.012);
  await edit([{ type: "mixer.set", trackId: "t1", values: { balance: 0, mute: true } }]); const muted = await levels(); assert.ok(muted[0] + muted[1] < 0.002);
  await edit([{ type: "mixer.set", trackId: "t1", values: { mute: false } }, { type: "mixer.set", trackId: "t2", values: { solo: true } }]); const solo = await levels(); assert.ok(solo[0] + solo[1] < 0.002);
  await edit([{ type: "mixer.set", trackId: "t2", values: { solo: false } }]); const restored = await levels(); assert.ok(restored[0] > 0.025 && restored[1] > 0.012);
  assert.deepEqual(app.project.document.clips, clipBefore);
  // Probe a second orbit, then mute only the first: route isolation is observable.
  await engine.sclang.evalRoutine(`~held2 = Synth.head(~dirt.orbits[1].group, \\abxHeldProbe, [\\out, ~dirt.orbits[1].dryBus.index]); ~dirt.orbits[1].getGlobalEffect(\\dirt_monitor).resume; s.sync;`, "second-channel");
  await edit([{ type: "mixer.set", trackId: "t1", values: { mute: true } }]); const independent = await levels(); assert.ok(independent[0] > 0.025 && independent[1] > 0.012);
  await engine.sclang.evalRoutine("~held1.free; ~held2.free; s.sync;", "probes-stop");
  await send("project.save", { value: "roundtrip" }); const saved = app.project.document;
  await send("project.new"); await send("project.load", { value: "roundtrip" }); assert.deepEqual(app.project.document.clips, saved.clips); assert.deepEqual(app.project.document.scenes, saved.scenes);
  await edit([{ type: "mixer.set", trackId: "t1", values: { level: 0.5 } }]); await send("project.undo"); assert.equal(app.project.document.tracks[0].mixer.level, 1); await send("project.redo"); assert.equal(app.project.document.tracks[0].mixer.level, 0.5);
  process.stdout.write(`P0B LIVE PASS: stereo held ${initial.map(x => x.toFixed(3))}; quarter level ${low.map(x => x.toFixed(3))}; left ${left.map(x => x.toFixed(3))}; right ${right.map(x => x.toFixed(3))}; mute/solo, channel isolation, compiler, arrangement, persistence, undo/redo passed.\n`);
} catch (e) { process.stderr.write(engine.sclang.tail(3000) + "\n" + engine.tidal.tail(3000) + "\n"); throw e; }
finally { meter.stop(); try { engine.stop(); } finally { rmSync(dir, { recursive: true, force: true }); } }
await assertAudioPortsFree(); process.stdout.write("Owned audio ports released.\n");
