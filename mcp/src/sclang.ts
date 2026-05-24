import { ProcDriver } from "./proc.js";
import { SCLANG, SUPERDIRT_STARTUP, SUPERDIRT_READY, SC_WELCOME, FORM_FEED, AUDIO_DEVICE_FILE } from "./config.js";

// Drives a headless sclang interpreter (the SuperDirt audio engine).
// IMPORTANT: evaluate code by sending  <code>\n <0x0C>\n  and keep stdin open;
// boot logic must run on SystemClock (see superdirt_startup.scd), not AppClock.
export class Sclang extends ProcDriver {
  constructor() {
    // detached: give sclang (and its scsynth child) its own process group/console
    // context so the audio callback thread can run when spawned from Node.
    super(SCLANG, [], process.env, { detached: true, windowsHide: true });
  }

  /** Evaluate a chunk of SuperCollider code in the running interpreter. */
  eval(code: string): void {
    this.writeRaw(code + "\n" + FORM_FEED + "\n");
  }

  /** Boot scsynth + SuperDirt and wait until it's listening on :57120. */
  async bootSuperDirt(timeoutMs = 120000): Promise<void> {
    await this.waitFor(SC_WELCOME, 60000); // class library compiled, interpreter live
    // Use .load (not raw stdin eval): sending the multi-line file via stdin+form-feed
    // mis-parses `var`/comments; .load compiles the whole file like the IDE does.
    const path = SUPERDIRT_STARTUP.replace(/\\/g, "/");
    // tell the startup where the audio-device file lives (keeps the user's path out
    // of the committed .scd; the .scd uses ~devFile if set, else a relative fallback).
    const dev = AUDIO_DEVICE_FILE.replace(/\\/g, "/");
    this.eval(`~devFile = "${dev}"; "${path}".load;`);
    await this.waitFor(SUPERDIRT_READY, timeoutMs);
  }
}
