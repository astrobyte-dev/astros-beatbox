import { test } from "node:test";
import assert from "node:assert/strict";
import { track, applyParam, scStr, type RigState } from "./track.js";

function fresh(): RigState {
  return { slots: {}, tempoBpm: 0, muted: new Set(), solo: null };
}

test("track stores a slot body without the 'dN $' prefix", () => {
  const r = fresh();
  track(r, 'd1 $ s "bd*4" # gain 1.1');
  assert.equal(r.slots.d1, 's "bd*4" # gain 1.1');
});

test("track reads setcps (BPM/60/4) tempo", () => {
  const r = fresh();
  track(r, "setcps (140/60/4)");
  assert.equal(r.tempoBpm, 140);
});

test("track handles a do-block: multiple slots + silence", () => {
  const r = fresh();
  track(r, 'do { setcps (120/60/4); d1 $ s "bd*4"; d2 $ s "~ cp" }');
  assert.equal(r.tempoBpm, 120);
  assert.equal(r.slots.d1, 's "bd*4"');
  assert.equal(r.slots.d2, 's "~ cp"');
  track(r, "do { d1 silence }");
  assert.equal(r.slots.d1, undefined);
  assert.equal(r.slots.d2, 's "~ cp"');
});

test("track keeps a stack (Set Loop) body intact despite commas", () => {
  const r = fresh();
  track(r, 'd12 $ stack [s "bd*4" # gain 1.1, s "~ cp"]');
  assert.equal(r.slots.d12, 'stack [s "bd*4" # gain 1.1, s "~ cp"]');
});

test("track silence clears mute + solo for that slot", () => {
  const r = fresh();
  r.slots.d3 = 's "hh*8"'; r.muted.add("d3"); r.solo = "d3";
  track(r, "d3 silence");
  assert.equal(r.slots.d3, undefined);
  assert.equal(r.muted.has("d3"), false);
  assert.equal(r.solo, null);
});

test("applyParam replaces an existing param and appends a new one", () => {
  assert.equal(applyParam('s "bd*4" # gain 1.1', "gain", 0.8), 's "bd*4" # gain 0.8');
  assert.equal(applyParam('s "bd*4"', "cutoff", 800), 's "bd*4" # cutoff 800');
  assert.equal(applyParam('s "bd*4" # gain 1 # room 0.3', "gain", 0.5), 's "bd*4" # gain 0.5 # room 0.3');
});

test("scStr escapes backslashes and quotes", () => {
  assert.equal(scStr("C:/a/b.wav"), "C:/a/b.wav");
  assert.equal(scStr('a"b\\c'), 'a\\"b\\\\c');
});
