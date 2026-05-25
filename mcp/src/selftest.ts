import { Engine } from "./engine.js";
import { Meter } from "./meter.js";
import { METER_UDP_PORT } from "./config.js";

// Diagnostic self-test: isolates the SC audio path (direct kicks) from the Tidal path, and
// asserts the master meter actually moved during the Tidal beat, i.e. the chain is not
// silently dead. LOCAL-ONLY: it boots a real SuperDirt + Tidal (and boot's clearOrphans kills
// any running engine), so run it ALONE via `npm run selftest`, never in CI (no WASAPI there).
const engine = new Engine();
// Bind our own meter listener on the same UDP port the master meter forwards to. selftest runs
// standalone, so the port is free (a live server would already have been killed by boot).
const meter = new Meter();
meter.start(METER_UDP_PORT);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function dump(label: string) {
  process.stderr.write(`\n===== ${label} =====\n`);
  process.stderr.write("--- sclang tail ---\n" + engine.sclang.tail(1200) + "\n");
  process.stderr.write("--- tidal tail ---\n" + engine.tidal.tail(1500) + "\n");
}

(async () => {
  process.stderr.write("Booting engines (SuperDirt + Tidal)...\n");
  await engine.ensureBooted();
  process.stderr.write("READY.\n");

  // (A) Direct SuperCollider-side trigger — isolates the SC -> FlexASIO -> K11 path.
  process.stderr.write("Phase A: 3 direct SC kicks...\n");
  for (let i = 0; i < 3; i++) {
    engine.sclang.eval('NetAddr("127.0.0.1",57120).sendMsg("/dirt/play","s","bd","orbit",0,"gain",1.2);');
    await sleep(450);
  }
  await sleep(800);

  // (B) Tidal path — d1 pattern. Sample the master meter across the 8s window, keeping the
  // peak. We assert on peakLR = max over the window of (L + R); peakL/peakR are tracked
  // separately and reported so a one-channel / mono-summing regression is visible in the
  // output, even though it does not fail v1 (the failure this guards is a fully dead chain).
  process.stderr.write("Phase B: Tidal beat (8s) + meter check...\n");
  engine.tidal.eval("setcps 0.575");
  await sleep(300);
  engine.tidal.eval('d1 $ stack [ sound "bd*4", sound "~ cp" # gain 0.9, sound "hh*8" # gain 0.6 ]');
  let peakLR = 0, peakL = 0, peakR = 0;
  for (let i = 0; i < 80; i++) {          // ~8s sampled at 100ms (the meter forwards at 15Hz)
    peakLR = Math.max(peakLR, meter.l + meter.r);
    peakL = Math.max(peakL, meter.l);
    peakR = Math.max(peakR, meter.r);
    await sleep(100);
  }
  engine.tidal.hush();
  await sleep(800);

  // Threshold 0.05 on (L+R): well above the noise floor, yet about an order of magnitude below
  // a normal beat's level, so a working SuperDirt + Tidal chain clears it easily and only a
  // completely dead audio path fails. (peakL/peakR are diagnostic, not part of the assertion.)
  process.stderr.write(`Meter peak during phase B: L+R=${peakLR.toFixed(3)} (L=${peakL.toFixed(3)} R=${peakR.toFixed(3)})\n`);
  if (peakLR <= 0.05) {
    process.stderr.write(`SELFTEST FAILED: no audio detected (peak L+R ${peakLR.toFixed(3)} <= 0.05) — the chain appears dead.\n`);
    dump("ON FAILURE (no audio)");
    meter.stop();
    engine.stop();
    process.exit(1);
  }

  dump("AFTER RUN");
  meter.stop();
  engine.stop();
  process.stderr.write("DONE — audio verified.\n");
  process.exit(0);
})().catch((e) => {
  process.stderr.write("SELFTEST FAILED: " + String(e) + "\n");
  dump("ON FAILURE");
  meter.stop();
  engine.stop();
  process.exit(1);
});
