import { Sclang } from "./sclang.js";

// Minimal SuperDirt state check: did samples load? what langPort? is ~dirt alive?
const sclang = new Sclang();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  sclang.start();
  await sclang.bootSuperDirt();
  // echo-proof marker: "DQRES" ++ 55  -> "DQRES55" never appears verbatim in source
  sclang.eval(
    `("DQRES" ++ 55 ++ " soundFolders:" ++ ~dirt.buffers.size ++ ` +
    `" hasBD:" ++ (~dirt.buffers[\\bd].notNil) ++ " langPort:" ++ NetAddr.langPort ++ ` +
    `" orbits:" ++ ~dirt.orbits.size).postln;`,
  );
  await sclang.waitFor("DQRES55", 8000).catch(() => {});
  const m = sclang.tail(12000).match(/DQRES55[^\r\n]*/);
  process.stderr.write("RESULT >>> " + (m ? m[0] : "DQRES LINE NOT FOUND") + "\n");
  // also dump any SuperDirt sample-loading summary from the boot
  const loadLines = sclang.tail(20000).match(/[^\r\n]*(loading|loaded|sample|buffers|folders|files)[^\r\n]*/gi);
  process.stderr.write("LOAD LINES >>>\n" + (loadLines ? loadLines.slice(-12).join("\n") : "(none)") + "\n");
  sclang.stop();
  process.exit(0);
})().catch((e) => {
  process.stderr.write("DIAG FAILED: " + String(e) + "\n" + sclang.tail(1500));
  sclang.stop();
  process.exit(1);
});
