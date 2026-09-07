// Explicit test fixture only. No runtime environment flag can fabricate capture.
import { writeFileSync } from "node:fs";
import type { CommandEngine } from "./application.js";
import type { InputConfiguration } from "./capture.js";
export function fixtureWav(channels = 1, amplitude = 8000, frames = 24000) {
  const b = Buffer.alloc(44 + frames * channels * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(48000 * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(b.length - 44, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(Math.round(amplitude * (.12 + .88 * Math.sin((i - 44) / (b.length - 44) * Math.PI * 3) ** 2) * Math.sin(i / 31)), i);
  return b;
}
export class SamplingFixtureEngine implements CommandEngine {
  generation = 0; running = false; state = "idle"; error: string | null = null;
  audioCapabilities = { deviceSelection: true, configuration: "Deterministic fixture — no physical inputs" };
  inputDevices = ["Fixture microphone"];
  inputConfiguration: InputConfiguration = { enabled: false, device: "", channel: 0 };
  calls: string[] = []; captureFile = ""; recordingFile = ""; fail = ""; invalid = false; cycle = 10;
  before: (code: string) => Promise<void> = async () => {};
  async evaluate(code: string, operationId = "fixture") {
    this.calls.push(code); await this.before(code);
    if (this.fail && code.includes(this.fail)) throw new Error("Fixture injected failure");
    const f = /~abxInputBuffer\.write\("([^"\n]+)"/.exec(code); if (f) this.captureFile = f[1];
    const r = /~recBuf\.write\("([^"\n]+)"/.exec(code); if (r) this.recordingFile = r[1];
    if (code.includes("~abxInputBuffer.close") && this.captureFile) writeFileSync(this.captureFile, this.invalid ? Buffer.from("unfinalized") : fixtureWav());
    if (code.includes("~recBuf.close") && this.recordingFile) writeFileSync(this.recordingFile, fixtureWav(2));
    return { operationId, acknowledgement: "action" as const, output: code.includes("abxInstall") ? "ABX_SCHEDULED " + this.cycle : "ABX_PREVIEW 0.5" };
  }
  tidal = { eval: (c: string, id?: string) => this.evaluate(c, id), hush: (id?: string) => this.evaluate("hush", id), clock: async () => this.cycle };
  sclang = { eval: (c: string, id?: string) => this.evaluate(c, id), evalRoutine: (c: string, id?: string) => this.evaluate(c, id) };
  async ensureBooted() { this.running = true; this.state = "ready"; }
  async reboot() { this.generation++; await this.ensureBooted(); }
  async configureInput(c: InputConfiguration) { if (c.device && !this.inputDevices.includes(c.device)) throw new Error("Input device unavailable"); this.inputConfiguration = { ...c }; await this.reboot(); }
  assertGeneration(g: number) { if (g !== this.generation) throw new Error("Stale generation"); }
  stop() { this.generation++; this.running = false; this.state = "idle"; }
}
