// Ambient types for dashboard-mixer.js (window.AbxMixer), the mixer module. The browser loads it
// as a classic <script>; Node tests import it for side-effect and read globalThis.AbxMixer. Only
// the pure math is typed here (the tested surface); the DOM/UI methods are runtime-only.
export interface AbxMixerApi {
  /** Fader position 0..1 -> SuperDirt gain. dB-linear; unity at 0.75; top (1.0) = 2.0; <=0.02 = silence. */
  faderToGain(p: number): number;
  /** Inverse of faderToGain; out-of-range gains park at the nearest fader end. */
  gainToFader(g: number): number;
  /** Pan position 0..1 -> formatted pan value string (0.5 = centre). */
  panPositionToString(p: number): string;
  /** Parse a pan value string back to position; clamps to 0..1, centre on garbage. */
  panStringToPosition(s: string): number;
}
declare global {
  // eslint-disable-next-line no-var
  var AbxMixer: AbxMixerApi;
}
