import { ProcDriver } from "./proc.js";
import { sclangFrame, sclangFileFrame } from "./protocol.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCLANG, SCSYNTH, AUDIO_CAPABILITIES, DEFAULT_AUDIO_DEVICE, SUPERDIRT_STARTUP, SUPERDIRT_READY, SC_WELCOME, AUDIO_DEVICE_FILE, DIRT_SAMPLES_DIR } from "./config.js";
import { scStr } from "./track.js";

// Drives a headless sclang interpreter (the SuperDirt audio engine).
// IMPORTANT: evaluate code by sending  <code>\n <0x0C>\n  and keep stdin open;
// boot logic must run on SystemClock (see superdirt_startup.scd), not AppClock.
export class Sclang extends ProcDriver {
  constructor() {
    // The persistent runtime owns this interpreter. On Windows CREATE_NO_WINDOW
    // must not be combined with DETACHED_PROCESS (Windows ignores it there).
    // WASAPI/SystemClock do not require a separate visible console context.
    super(SCLANG, [], process.env, { detached: process.platform !== "win32", windowsHide: true }, true);
  }

  /** Evaluate a chunk of SuperCollider code in the running interpreter. */
  eval(code: string, operationId?: string, timeoutMs?: number) {
    return this.evaluate(code, false, operationId, timeoutMs);
  }

  // Internal asynchronous work acknowledges from inside the routine, after its
  // waits/syncs, rather than acknowledging only that it has been scheduled.
  evalRoutine(code: string, operationId?: string, timeoutMs = 15000) {
    return this.evaluate(code, true, operationId, timeoutMs);
  }

  private async evaluate(code: string, routine: boolean, operationId?: string, timeoutMs?: number) {
    let directory: string | undefined;
    try {
      return await this.execute(token => {
        const frame = sclangFrame(code, token, routine);
        // SC's lexer truncates large string literals in inline .compile frames.
        // Compile the same source from a private file, retaining all ACK/error and
        // SystemClock barriers. Keep the file until the queued operation finishes.
        if (Buffer.byteLength(frame.script, "utf8") <= 7000) return frame;
        directory = mkdtempSync(path.join(tmpdir(), "abx-sclang-"));
        const file = path.join(directory, "command.scd");
        writeFileSync(file, code, "utf8");
        return sclangFileFrame(file, token, routine);
      }, operationId, timeoutMs);
    } finally {
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  }

  /** Boot scsynth + SuperDirt and wait until it's listening on :57120. */
  async bootSuperDirt(timeoutMs = 120000, input = { enabled: false, device: "" }): Promise<void> {
    await this.waitFor(SC_WELCOME, 60000); // class library compiled, interpreter live
    // Use .load (not raw stdin eval): sending the multi-line file via stdin+form-feed
    // mis-parses `var`/comments; .load compiles the whole file like the IDE does.
    const path = SUPERDIRT_STARTUP.replace(/\\/g, "/");
    // tell the startup where the audio-device file lives (keeps the user's path out
    // of the committed .scd; the .scd uses ~devFile if set, else a relative fallback).
    const dev = AUDIO_DEVICE_FILE.replace(/\\/g, "/");
    const setup = `~abxInputChannels = ${input.enabled ? 2 : 0}; ~abxInputDevice = "${scStr(input.device)}"; ~abxJack = ${AUDIO_CAPABILITIES.backend === "jack"}; ~abxWindows = ${process.platform === "win32"}; ~abxDefaultDevice = "${scStr(DEFAULT_AUDIO_DEVICE)}"; `;
    const server = SCSYNTH ? `Server.program = "${scStr(SCSYNTH.replace(/\\/g, "/"))}"; ` : "";
    await this.eval(setup + server + `~devFile = "${scStr(dev)}"; ~samplePath = "${scStr(DIRT_SAMPLES_DIR.replace(/\\/g, "/"))}/*"; "${scStr(path)}".load;`);
    await this.waitFor(SUPERDIRT_READY, timeoutMs);
  }
}
