// Opt-in Windows integration test. Boots real audio, plays a short beat, and uses
// only a new temporary directory. Never included in npm test or CI.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Engine, assertAudioPortsFree } from "./engine.js";
import { Application } from "./application.js";
import { Meter } from "./meter.js";
import { METER_UDP_PORT } from "./config.js";

const dir = mkdtempSync(path.join(tmpdir(), "abx-p0a-live-"));
const engine = new Engine(), meter = new Meter();
const app = new Application(engine, { sets: dir, recordings: dir, device: path.join(dir, "device.txt") });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function send(command: unknown) {
  const result = await app.dispatch(command);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
try {
  await meter.start(METER_UDP_PORT);
  process.stderr.write("P0a: booting owned engines...\n");
  await send({ cmd: "boot" }); assert.equal(engine.state, "ready", engine.error ?? "");
  await send({ cmd: "eval", value: 'do { setcps (120/60/4); d1 $ s "bd*4" # gain 0.8; d2 $ s "~ cp" # gain 0.5 }' });
  await send({ cmd: "mute", slot: "d2" });
  const slots = { ...app.rig.slots };
  await send({ cmd: "stop" }); assert.deepEqual(app.rig.slots, slots); assert.ok(app.rig.muted.has("d2"));
  await send({ cmd: "resume" }); assert.ok(app.rig.muted.has("d2"));
  await send({ cmd: "save", value: "session" });
  await send({ cmd: "load", value: "session" }); assert.deepEqual(app.rig.slots, slots);

  const record = { cmd: "record", operationId: "record-once", sessionId: app.sessionId, issuedAt: Date.now() };
  await send(record);
  let peak = 0;
  for (let i = 0; i < 20; i++) { await sleep(100); peak = Math.max(peak, meter.l + meter.r); }
  await send(record); assert.equal(app.rig.recording, true, "retry must not toggle recording off");
  await send({ cmd: "record" });
  const wav = readFileSync(app.rig.recPath);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF"); assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let samplePeak = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4), end = Math.min(wav.length, offset + 8 + size);
    if (wav.toString("ascii", offset, offset + 4) === "data") {
      for (let i = offset + 8; i + 1 < end; i += 2) samplePeak = Math.max(samplePeak, Math.abs(wav.readInt16LE(i)));
    }
    offset += 8 + size + (size % 2);
  }
  assert.ok(peak > 0.05, "live meter must move"); assert.ok(samplePeak > 100, "WAV must contain actual audio");
  process.stderr.write(`P0a: Stop/Play/save/load/record/retry passed; meter ${peak.toFixed(3)}, WAV ${wav.length} bytes, PCM peak ${samplePeak}.\n`);

  assert.equal((await app.dispatch({ cmd: "eval", value: "d1 $ missingP0aPattern" })).ok, false);
  assert.deepEqual(app.rig.slots, slots);
  assert.equal((await app.dispatch({ cmd: "eval", value: 'do { ioError (userError "P0a runtime failure") }' })).ok, false);
  assert.equal((await app.dispatch({ cmd: "eval_sc", value: "1 + ;" })).ok, false);
  assert.equal((await app.dispatch({ cmd: "eval_sc", value: 'Error("P0a SC runtime failure").throw;' })).ok, false);
  await send({ cmd: "eval_sc", value: '"after error".postln;' });
  await send({ cmd: "eval", value: "let p0aValue = 42" });
  await send({ cmd: "eval", value: "p0aValue" });
  await send({ cmd: "eval_sc", value: 'Routine({ 0.2.wait; Error("P0a late failure").throw; }).play(SystemClock);' });
  await sleep(500); assert.match(engine.error ?? "", /P0a late failure/);
  assert.equal(engine.lastFault?.observedDuringOperationId, undefined);
  await send({ cmd: "stop" });

  // The late ACK after this timeout must never make the driver healthy again.
  await assert.rejects(engine.sclang.evalRoutine("0.3.wait;", "intentional-timeout", 50), /timed out/);
  await sleep(500); assert.equal(engine.state, "error");
  assert.equal((await app.dispatch({ cmd: "boot" })).ok, false);
  process.stderr.write("P0a: compiler/runtime/late errors and timeout quarantine passed; resetting...\n");
  const generation = engine.generation;
  await send({ cmd: "reset" }); assert.ok(engine.generation > generation); assert.equal(engine.state, "ready");
  assert.equal(app.rig.stopped, true); assert.deepEqual(app.rig.slots, slots);
  await send({ cmd: "resume" }); await send({ cmd: "stop" });
  await app.dispatch({ cmd: "eval_sc", value: "s.quit;" });
  await sleep(800); assert.equal(engine.state, "error");
  process.stderr.write("P0a: reset retained the stopped set; audio-server exit detected.\n");
} finally {
  meter.stop();
  try { engine.stop(); } finally { rmSync(dir, { recursive: true, force: true }); }
}
await assertAudioPortsFree();
process.stderr.write("P0A LIVE PASS; owned audio ports released.\n");
