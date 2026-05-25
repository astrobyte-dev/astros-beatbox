// Ambient types for dashboard-dsp.js, the single-source DSP module.
// The browser loads it as a classic <script> and reads window.AbxDsp; Node tests import it
// for side-effect and read globalThis.AbxDsp. Both see the same object, declared here so
// there is exactly one implementation paired with exactly one type contract.

export interface ScopeSlice {
  seg: number[];
  mx: number;
}

export interface DspClock {
  have: boolean;
  cps: number;
  cycle: number;
  recvAt: number;
  lead: number;
}

export interface AbxDspApi {
  /** Phase-locked ~2-cycle slice when tonal, the raw mean-subtracted window otherwise, null when silent. */
  stabilize(wave: number[]): ScopeSlice | null;
  /** Linearly resample seg to exactly D points; endpoints are preserved. */
  resample(seg: number[], D: number): number[];
  /** Fractional cycle phase [0,1) from the audio clock, null until a clock arrives. Pure: pass performance.now() as nowMs. */
  audioPhase(clk: DspClock, nowMs: number): number | null;
}

declare global {
  // eslint-disable-next-line no-var
  var AbxDsp: AbxDspApi;
}
