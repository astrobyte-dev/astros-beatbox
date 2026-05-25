import { test } from "node:test";
import assert from "node:assert/strict";

// Single source: the browser loads dashboard-mixer.js (window.AbxMixer) as a classic <script>;
// here we import it for side-effect under Node and read the same pure math off globalThis.AbxMixer.
// The module's DOM/UI parts are guarded by `typeof document`, so importing it in Node is safe, and
// there is no separate src/mixer.ts to drift from (same pattern as dashboard-dsp.js).
import "../dashboard-mixer.js";

const { faderToGain, gainToFader, panPositionToString, panStringToPosition } = globalThis.AbxMixer;
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------- faderToGain ----------------
test("faderToGain: bottom and the whole deadband are hard silence (no leak)", () => {
  assert.equal(faderToGain(0), 0);
  assert.equal(faderToGain(0.01), 0);
  assert.equal(faderToGain(0.02), 0); // deadband upper edge is still silent
});

test("faderToGain: just above the deadband is near-silent, not unity", () => {
  const g = faderToGain(0.021);
  assert.ok(g > 0 && g < 0.005); // ~ -58 dB
});

test("faderToGain: unity at 0.75", () => {
  assert.ok(close(faderToGain(0.75), 1.0));
});

test("faderToGain: midpoint 0.5 is -20 dB (gain 0.1)", () => {
  assert.ok(close(faderToGain(0.5), 0.1));
});

test("faderToGain: top at 1.0 is exactly 2.0 (matches the card gain knob max)", () => {
  assert.ok(close(faderToGain(1.0), 2.0));
});

test("faderToGain: monotonically non-decreasing across the travel", () => {
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const g = faderToGain(i / 100); assert.ok(g >= prev); prev = g; }
});

// ---------------- gainToFader (inverse) ----------------
test("gainToFader: unity -> 0.75, max -> 1.0, silence -> 0", () => {
  assert.ok(close(gainToFader(1.0), 0.75));
  assert.ok(close(gainToFader(2.0), 1.0));
  assert.equal(gainToFader(0), 0);
});

test("gainToFader/faderToGain round-trip is stable above the deadband", () => {
  for (const p of [0.1, 0.25, 0.3, 0.5, 0.75, 0.9, 1.0]) {
    assert.ok(close(gainToFader(faderToGain(p)), p), `p=${p}`);
  }
});

test("gainToFader: out-of-range gains park at the nearest valid fader end", () => {
  assert.equal(gainToFader(-0.5), 0);      // gain is never < 0 in valid Tidal -> bottom
  assert.equal(gainToFader(0), 0);         // exact silence -> bottom
  assert.ok(close(gainToFader(3.0), 1.0)); // above the 2.0 max -> parked at top (fader can't exceed max)
  assert.equal(gainToFader(NaN), 0);       // defensive -> bottom
});

// ---------------- pan ----------------
test("panPositionToString: centre / hard left / hard right", () => {
  assert.equal(panPositionToString(0.5), "0.50");
  assert.equal(panPositionToString(0), "0.00");
  assert.equal(panPositionToString(1), "1.00");
});

test("pan position round-trips through the string", () => {
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(close(panStringToPosition(panPositionToString(p)), p), `p=${p}`);
  }
});

test("panStringToPosition: clamps to range and defaults to centre on garbage", () => {
  assert.equal(panStringToPosition("-1"), 0);   // clamp left
  assert.equal(panStringToPosition("2"), 1);    // clamp right
  assert.equal(panStringToPosition("abc"), 0.5); // unparseable -> centre default
});
