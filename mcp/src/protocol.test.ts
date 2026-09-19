import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameReader, tidalFrame, sclangFrame, sclangFileFrame, type Frame } from "./protocol.js";
import { ProcDriver } from "./proc.js";

function reader(): FrameReader { return new FrameReader(tidalFrame('d1 $ s "bd"', "current")); }
function begin(r: FrameReader) { r.line("stdout", "current:BEGIN"); r.line("stderr", "current:BEGIN"); }
function end(r: FrameReader) { r.line("stdout", "current:END"); r.line("stderr", "current:END"); }

test("END after a compiler error is not success", () => {
  const r = reader(); begin(r); r.line("stderr", "<interactive>:1: error: Variable not in scope"); end(r);
  assert.throws(() => r.result("op"), /not in scope/);
});
test("END without an in-action acknowledgement is not success", () => {
  const r = reader(); begin(r); end(r); assert.throws(() => r.result("op"), /did not acknowledge/);
});
test("stdout acknowledgement waits for the stderr boundary", () => {
  const r = reader(); begin(r); r.line("stdout", "current:OK"); r.line("stdout", "current:END");
  assert.equal(r.complete, false); r.line("stderr", "runtime error: failed"); r.line("stderr", "current:END");
  assert.throws(() => r.result("op"), /failed/);
});
test("runtime FAIL overrides an acknowledgement", () => {
  const r = reader(); begin(r); r.line("stdout", "current:OK"); r.line("stdout", "current:FAIL"); end(r);
  assert.throws(() => r.result("op"));
});
test("stale generation markers and old diagnostics cannot confirm/fail a new action", () => {
  const r = reader(); r.line("stderr", "error: old"); r.line("stdout", "old:OK"); begin(r);
  r.line("stdout", "current:OK"); end(r); assert.equal(r.result("op").operationId, "op");
});
test("late diagnostic within a frame overrides earlier OK", () => {
  const r = reader(); begin(r); r.line("stdout", "current:OK"); r.line("stderr", "Failed to Stream.doTick: bad pattern"); end(r);
  assert.throws(() => r.result("op"), /bad pattern/);
});
test("raw declarations explicitly have only diagnostic completion", () => {
  const frame = tidalFrame("let foo = 2", "current"); const r = new FrameReader(frame); begin(r); end(r);
  assert.equal(r.result("op").acknowledgement, "completion");
  assert.equal(tidalFrame('d1 $ s "bd"', "x").acknowledgement, "action");
});
test("SC source echoes cannot contain a complete acknowledgement marker", () => {
  const frame = sclangFrame('"hello".postln;', "current");
  assert.ok(!frame.script.includes("current:OK"));
  assert.ok(sclangFrame("s.sync;", "current", true).script.includes("Routine"));
});

test("SC file compilation retains framed failure/completion and escapes the source path", () => {
  const frame = sclangFileFrame('C:/a space/quoted"name.scd', "current", true);
  assert.ok(frame.script.includes('File.readAllString("C:/a space/quoted\\"name.scd").compile'));
  assert.ok(frame.script.includes("Routine"));
  assert.ok(!frame.script.includes("current:OK"));
  const r = new FrameReader(frame);
  r.line("stdout", "current:BEGIN"); r.line("stdout", "current:FAIL"); r.line("stdout", "current:END");
  assert.throws(() => r.result("large-command"));
});

test("ordinary output mentioning an error is not itself a diagnostic", () => {
  const r = reader(); begin(r); r.line("stdout", "after error"); r.line("stdout", "current:OK"); end(r);
  assert.equal(r.result("op").output, "after error");
});

const fake = `const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line', line=>{const {token,mode}=JSON.parse(line);
if(mode==='exit'){process.exit(7);return;} if(mode==='hang')return;
process.stdout.write(token+':BEGIN\\n');process.stderr.write(token+':BEGIN\\n');
if(mode==='audio-exit')process.stdout.write('ABX_AUDIO_EXIT\\n');
if(mode==='error')process.stderr.write('error: bad expression\\n');
else {process.stdout.write(token.slice(0,5)); setTimeout(()=>process.stdout.write(token.slice(5)+':OK\\n'),5);}
setTimeout(()=>{process.stdout.write(token+':END\\n');process.stderr.write(token+':END\\n');
if(mode==='late')setTimeout(()=>process.stderr.write('Failed to Stream.doTick: late failure\\n'),10);},10);
});`;
class FakeDriver extends ProcDriver {
  constructor() { super(process.execPath, ["-e", fake]); }
  run(mode = "ok", timeout = 2000) {
    return this.execute((token): Frame => ({ token, streams: ["stdout", "stderr"], acknowledgement: "action", script: JSON.stringify({ token, mode }) + "\n" }), mode, timeout);
  }
}
test("driver handles split markers, serializes work and recovers after a command error", async () => {
  const d = new FakeDriver(); d.start();
  try { await assert.rejects(d.run("error"), /bad expression/); const results = await Promise.all([d.run(), d.run()]); assert.equal(results.length, 2); }
  finally { d.stop(); }
});
test("timeout quarantines driver and rejects queued work without resending", async () => {
  const d = new FakeDriver(); d.start();
  try { const results = await Promise.allSettled([d.run("hang", 100), d.run()]); assert.ok(results.every((r) => r.status === "rejected")); }
  finally { d.stop(); }
});
test("process exit rejects pending and subsequent work", async () => {
  const d = new FakeDriver(); d.start();
  try { await assert.rejects(d.run("exit"), /exited/); await assert.rejects(d.run(), /exited/); }
  finally { d.stop(); }
});

test("audio server loss rejects work even if the language interpreter prints OK afterwards", async () => {
  const d = new FakeDriver(); d.start();
  try { await assert.rejects(d.run("audio-exit"), /Audio server stopped/); await assert.rejects(d.run(), /Audio server stopped/); }
  finally { d.stop(); }
});
test("spawn failure is a reported rejection rather than an unhandled process error", async () => {
  class Missing extends ProcDriver { run() { return this.execute((token) => tidalFrame("hush", token)); } }
  const d = new Missing("abx-nonexistent-executable"); d.start();
  try { await assert.rejects(d.run(), /Cannot start|input failed/); } finally { d.stop(); }
});
test("asynchronous failures are reported after the originating action completed", async () => {
  const d = new FakeDriver(); d.start();
  try {
    const fault = new Promise<string>((resolve) => d.on("fault", (e) => resolve(e.message)));
    await d.run("late"); assert.match(await fault, /late failure/);
  } finally { d.stop(); }
});
