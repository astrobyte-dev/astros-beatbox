import { Engine } from "./engine.js";

// Diagnostic self-test: isolates SC audio path (direct kicks) from the Tidal path.
const engine = new Engine();
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

  // (B) Tidal path — d1 pattern.
  process.stderr.write("Phase B: Tidal beat (8s)...\n");
  engine.tidal.eval("setcps 0.575");
  await sleep(300);
  engine.tidal.eval('d1 $ stack [ sound "bd*4", sound "~ cp" # gain 0.9, sound "hh*8" # gain 0.6 ]');
  await sleep(8000);
  engine.tidal.hush();
  await sleep(800);

  dump("AFTER RUN");
  engine.stop();
  process.stderr.write("DONE.\n");
  process.exit(0);
})().catch((e) => {
  process.stderr.write("SELFTEST FAILED: " + String(e) + "\n");
  dump("ON FAILURE");
  engine.stop();
  process.exit(1);
});
