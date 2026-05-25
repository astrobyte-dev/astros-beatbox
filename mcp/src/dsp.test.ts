import { test } from "node:test";
import assert from "node:assert/strict";

// Single source of truth: the browser loads dashboard-dsp.js as a classic <script>
// (window.AbxDsp); here we import it for side-effect under Node (type:module) and read
// the same functions off globalThis.AbxDsp. No TS port, so there is no second copy to drift.
import "../dashboard-dsp.js";

const { stabilize, resample, audioPhase } = globalThis.AbxDsp;

// ---------------- stabilize ----------------
test("stabilize: silence returns null", () => {
  assert.equal(stabilize(new Array(256).fill(0)), null);
});

test("stabilize: a clean sine locks to ~2 cycles (not the raw window)", () => {
  const sine = Array.from({ length: 256 }, (_, i) => Math.sin((2 * Math.PI * i) / 32));
  const s = stabilize(sine);
  assert.ok(s !== null);
  assert.equal(s!.seg.length, 64); // 2 * period (32 samples)
  assert.ok(s!.seg.length < sine.length); // proves it locked rather than returning raw
  assert.ok(Math.abs(s!.mx - 1) < 0.02);
});

test("stabilize: a single decaying impulse (kick) returns the raw window", () => {
  // a monotonic decay has no rising zero-crossings, so the trigger never locks
  const kick = Array.from({ length: 256 }, (_, i) => Math.exp(-i / 18));
  const k = stabilize(kick);
  assert.ok(k !== null);
  assert.equal(k!.seg.length, kick.length);
});

test("stabilize: irregular noise returns the raw window", () => {
  // mulberry32 (a quality PRNG), not a cheap LCG: white noise has dense, irregular
  // zero-crossings whose median interval sits below the P>=4 floor, so the trigger never
  // locks and we get the raw window. A low-bit LCG can have short-period regularity that
  // fakes a tone (seed 12345 actually locked to a 4-sample period), so it is the wrong tool
  // here. Seed 1 is arbitrary; verified raw across seeds 1/7/42/1337.
  let a = 1;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; };
  const noise = Array.from({ length: 256 }, rnd);
  const nz = stabilize(noise);
  assert.ok(nz !== null);
  assert.equal(nz!.seg.length, noise.length);
});

// ---------------- resample ----------------
test("resample: output length equals the requested D", () => {
  assert.equal(resample([0, 1, 2, 3], 10).length, 10);
});

test("resample: endpoints match the input", () => {
  const r = resample([0, 1, 2, 3], 10);
  assert.equal(r[0], 0);
  assert.equal(r[9], 3);
});

test("resample: the midpoint is linearly interpolated", () => {
  assert.equal(resample([0, 10], 3)[1], 5);
});

test("resample: degenerate input (length < 2) fills with the single value", () => {
  assert.deepEqual(resample([7], 4), [7, 7, 7, 7]);
});

// ---------------- audioPhase(clk, nowMs) ----------------
const base = { have: true, cps: 0.5, cycle: 0, recvAt: 0, lead: 0 };

test("audioPhase: returns null when no clock has been received", () => {
  assert.equal(audioPhase({ have: false, cps: 0, cycle: 0, recvAt: 0, lead: 0 }, 1000), null);
  assert.equal(audioPhase({ have: true, cps: 0, cycle: 0, recvAt: 0, lead: 0 }, 1000), null);
});

test("audioPhase: returns a fractional phase in [0,1)", () => {
  const p = audioPhase({ ...base }, 3000); // 3s * 0.5 cps = 1.5 cycles -> 0.5
  assert.equal(p, 0.5);
  assert.ok(p! >= 0 && p! < 1);
});

test("audioPhase: advances by cps*dt between calls", () => {
  const a = audioPhase({ ...base }, 1000);
  const b = audioPhase({ ...base }, 1100); // dt = 0.1s
  assert.ok(Math.abs(b! - a! - base.cps * 0.1) < 1e-9);
});

test("audioPhase: subtracts lead (scheduling latency) from the phase", () => {
  // lead 0.25s at 1 cps shifts the displayed phase back by 0.25 of a cycle
  assert.equal(audioPhase({ have: true, cps: 1, cycle: 0, recvAt: 0, lead: 0.25 }, 1000), 0.75);
});
