import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { validateCommand, type Command, type CommandResult } from "./commands.js";
import { track, applyParam, scStr, type RigState } from "./track.js";
import type { EvalResult } from "./protocol.js";

export interface CommandEngine {
  generation: number; running: boolean; state: string; error: string | null;
  ensureBooted(): Promise<void>; reboot(): Promise<void>; assertGeneration(generation: number): void;
  tidal: { eval(code: string, id?: string): Promise<EvalResult>; hush(id?: string): Promise<EvalResult> };
  sclang: { eval(code: string, id?: string): Promise<EvalResult>; evalRoutine(code: string, id?: string): Promise<EvalResult> };
}
export interface ApplicationPaths { sets: string; recordings: string; device: string }
export interface LiveRig extends RigState { paused: boolean; stopped: boolean; recording: boolean; recPath: string; synchronized: boolean }

// P0a deliberately keeps the existing slot/code model. This is the single command
// boundary for HTTP and MCP, not the future project document or sequencer model.
export class Application {
  readonly sessionId = randomUUID();
  readonly rig: LiveRig = { slots: {}, tempoBpm: 0, muted: new Set(), solo: null, paused: false, stopped: false, recording: false, recPath: "", synchronized: true };
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private requests = new Map<string, { fingerprint: string; at: number; result: Promise<CommandResult>; done: boolean }>();
  static readonly RETRY_MS = 5 * 60 * 1000;

  constructor(readonly engine: CommandEngine, private paths: ApplicationPaths) {}

  dispatch(input: unknown): Promise<CommandResult> {
    let c: Command;
    try { c = validateCommand(input); }
    catch (e) {
      const candidate = (input as Partial<Command> | null)?.operationId;
      return Promise.resolve(this.failure(typeof candidate === "string" && candidate.length <= 100 ? candidate : randomUUID(), "VALIDATION", e));
    }
    const id = c.operationId ?? randomUUID(), now = Date.now();
    if (c.sessionId && c.sessionId !== this.sessionId) return Promise.resolve(this.failure(id, "STALE_SESSION", "Server session changed; refresh before sending a new operation."));
    if (c.issuedAt !== undefined && (now - c.issuedAt > Application.RETRY_MS || c.issuedAt > now + 10000)) return Promise.resolve(this.failure(id, "EXPIRED", "Request expired; it will not be replayed."));
    const fingerprint = JSON.stringify({ cmd: c.cmd, slot: c.slot, param: c.param, value: c.value });
    const prior = this.requests.get(id);
    if (prior) return prior.fingerprint === fingerprint ? prior.result : Promise.resolve(this.failure(id, "ID_CONFLICT", "Operation ID was already used for a different command."));
    for (const [key, entry] of this.requests) if (entry.done && now - entry.at > Application.RETRY_MS) this.requests.delete(key);
    if (this.waiting >= 256 || this.requests.size >= 8192) return Promise.resolve(this.failure(id, "BUSY", "Command queue is full; wait for current operations."));
    this.waiting++;
    const generation = this.engine.generation;
    const result = this.queue.then(async (): Promise<CommandResult> => {
      try {
        // Do not execute work queued against an engine that has since restarted.
        this.engine.assertGeneration(generation);
        const reply = await this.handle(c, id);
        return { ok: true, operationId: id, sessionId: this.sessionId, generation: this.engine.generation, ...reply };
      } catch (e) { return this.failure(id, "EXECUTION", e); }
      finally { this.waiting--; }
    });
    const entry = { fingerprint, at: c.issuedAt ?? now, result, done: false };
    this.requests.set(id, entry);
    this.queue = result.then(() => { entry.done = true; });
    return result;
  }

  private failure(id: string, code: string, e: unknown): CommandResult {
    return { ok: false, operationId: id, sessionId: this.sessionId, generation: this.engine.generation, code, error: (e instanceof Error ? e.message : String(e)).slice(-16000) };
  }
  private async tidal(code: string, id: string): Promise<EvalResult> {
    const gen = this.engine.generation;
    try { const result = await this.engine.tidal.eval(code, id); this.engine.assertGeneration(gen); return result; }
    catch (e) { this.rig.synchronized = false; throw e; }
  }
  private async sc(code: string, id: string, routine = false): Promise<EvalResult> {
    const gen = this.engine.generation;
    const result = await (routine ? this.engine.sclang.evalRoutine(code, id) : this.engine.sclang.eval(code, id));
    this.engine.assertGeneration(gen); return result;
  }
  private async restore(id: string): Promise<void> {
    const r = this.rig;
    await this.tidal("hush", id);
    if (r.tempoBpm) await this.tidal(`setcps (${r.tempoBpm}/60/4)`, id);
    for (const k of Object.keys(r.slots)) await this.tidal(`${k} $ ${r.slots[k]}`, id);
    await this.tidal("unmuteAll >> unsoloAll", id);
    for (const k of r.muted) await this.tidal(`mute ${k.slice(1)}`, id);
    if (r.solo) await this.tidal(`solo ${r.solo.slice(1)}`, id);
    if (r.stopped || r.paused) await this.tidal("hush", id);
    r.synchronized = true;
  }

  private async finishRecording(id: string): Promise<void> {
    await this.sc("~recSynth.free; ~recBuf.close; s.sync; ~recBuf.free; s.sync;", id, true);
    this.rig.recording = false;
    if (!existsSync(this.rig.recPath) || statSync(this.rig.recPath).size < 44) throw new Error("Recorder stopped, but no valid-sized WAV was found: " + this.rig.recPath);
    const fd = openSync(this.rig.recPath, "r"), header = Buffer.alloc(12);
    try { readSync(fd, header, 0, 12, 0); } finally { closeSync(fd); }
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE" || header.readUInt32LE(4) + 8 !== statSync(this.rig.recPath).size) {
      throw new Error("Recorder stopped, but WAV finalization could not be verified: " + this.rig.recPath);
    }
  }

  private async handle(c: Command, id: string): Promise<{ msg: string; output?: string; acknowledgement?: EvalResult["acknowledgement"] }> {
    const r = this.rig, slot = c.slot!, n = slot?.slice(1);
    if (c.cmd === "eval" && /^hush\s*;?\s*$/.test(String(c.value))) return this.handle({ cmd: "hush" }, id);
    if (c.cmd === "save") {
      const name = String(c.value).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
      const keys = Object.keys(r.slots).sort((a, b) => +a.slice(1) - +b.slice(1));
      mkdirSync(this.paths.sets, { recursive: true });
      writeFileSync(path.join(this.paths.sets, name + ".tidal"), [`setcps (${r.tempoBpm || 120}/60/4)`, ...keys.map((k) => `${k} $ ${r.slots[k]}`)].join("\n") + "\n", "utf8");
      return { msg: "saved set: " + name };
    }
    if (c.cmd === "stop" || c.cmd === "pause" || c.cmd === "hush") {
      if (this.engine.running) await this.tidal("hush", id);
      else if (this.engine.state !== "idle") throw new Error("Engine unavailable: silence could not be confirmed. " + (this.engine.error ?? ""));
      r.stopped = true; r.paused = true;
      if (c.cmd === "hush") { r.slots = {}; r.muted.clear(); r.solo = null; }
      return { msg: c.cmd === "hush" ? "hush — patterns cleared" : "stopped — patterns kept; press Play to resume" };
    }
    if (c.cmd === "reset" || c.cmd === "setdevice") {
      let recordingFailure = "";
      if (r.recording) {
        try { await this.finishRecording(id); }
        catch (e) { recordingFailure = "Recording finalization was not confirmed: " + r.recPath + ". " + String(e); }
      }
      if (c.cmd === "setdevice") writeFileSync(this.paths.device, String(c.value).trim(), "utf8");
      r.synchronized = false;
      await this.engine.reboot(); r.recording = false; await this.restore(id);
      if (recordingFailure) throw new Error("Engine restarted and patterns restored. " + recordingFailure);
      return { msg: "engine restarted; patterns and mute/solo settings restored" };
    }
    // Clearing an empty row should not start an audio engine.
    if (c.cmd === "silence" && !r.slots[slot]) return { msg: slot + " already empty" };
    if (["set", "mute", "unmute", "solo"].includes(c.cmd) && !r.slots[slot]) throw new Error("No active layer " + slot);
    if (c.cmd === "load" && !existsSync(path.join(this.paths.sets, c.value + ".tidal"))) throw new Error("No set named " + c.value);
    await this.engine.ensureBooted();
    switch (c.cmd) {
      case "boot": return { msg: this.engine.state === "degraded" ? "engine running with reported issues: " + this.engine.error : "engine ready" };
      case "resume":
        if (r.stopped) { r.stopped = false; r.paused = false; try { await this.restore(id); } catch (e) { r.stopped = true; r.paused = true; throw e; } }
        else { await this.tidal("unmuteAll", id); r.muted.clear(); r.paused = false; }
        return { msg: "resumed" };
      case "mute": case "unmute": case "solo": case "unsolo":
        await this.tidal(c.cmd === "unsolo" ? "unsoloAll" : `${c.cmd} ${n}`, id);
        if (c.cmd === "mute") r.muted.add(slot);
        if (c.cmd === "unmute") r.muted.delete(slot);
        if (c.cmd === "solo") r.solo = slot;
        if (c.cmd === "unsolo") r.solo = null;
        return { msg: c.cmd + (slot ? " " + slot : "") };
      case "silence":
        await this.tidal(`d${n} silence`, id); delete r.slots[slot]; r.muted.delete(slot); if (r.solo === slot) r.solo = null;
        return { msg: "cleared " + slot };
      case "tempo":
        await this.tidal(`setcps (${c.value}/60/4)`, id); r.tempoBpm = Number(c.value);
        return { msg: "tempo " + c.value };
      case "set": {
        const next = applyParam(r.slots[slot], c.param!, Number(c.value));
        await this.tidal(`${slot} $ ${next}`, id); r.slots[slot] = next;
        if (r.stopped) await this.tidal("hush", id);
        return { msg: `set ${slot} ${c.param}=${c.value}` };
      }
      case "eval": {
        const code = String(c.value);
        const result = await this.tidal(code, id);
        track(r, code);
        if (/\bd(?:[1-9]|1[0-6])\s+(?:\$|\()/m.test(code)) { r.paused = false; r.stopped = false; }
        return { msg: result.acknowledgement === "action" ? "action evaluated" : "interpreter command completed; musical effects are not verified", output: result.output, acknowledgement: result.acknowledgement };
      }
      case "eval_sc": {
        const result = await this.sc(String(c.value), id);
        return { msg: "SuperCollider expression evaluated; any scheduled work may still be running", output: result.output, acknowledgement: result.acknowledgement };
      }
      case "load": {
        const lines = readFileSync(path.join(this.paths.sets, c.value + ".tidal"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("--"));
        const saved = { ...r.slots }, bpm = r.tempoBpm;
        await this.tidal("hush", id);
        const next: LiveRig = { ...r, slots: {}, muted: new Set(), solo: null, stopped: false, paused: false };
        try { for (const line of lines) { await this.tidal(line, id); track(next, line); } }
        catch (e) { r.slots = saved; r.tempoBpm = bpm; try { await this.restore(id); } catch { r.synchronized = false; } throw new Error("Set load failed; previous set retained. " + String(e)); }
        Object.assign(r, next); r.synchronized = true; return { msg: "loaded set: " + c.value };
      }
      case "record":
        if (r.recording) { await this.finishRecording(id); return { msg: "saved recording: " + r.recPath }; }
        mkdirSync(this.paths.recordings, { recursive: true });
        const file = path.join(this.paths.recordings, "jam-" + new Date().toISOString().replace(/[:.]/g, "-") + ".wav").replace(/\\/g, "/");
        await this.sc(`SynthDef(\\diskrec, { |buf| DiskOut.ar(buf, In.ar(0,2)) }).add; ~recBuf = Buffer.alloc(s, 65536, 2); s.sync; ~recBuf.write("${scStr(file)}", "wav", "int16", 0, 0, true); s.sync; ~recSynth = Synth.tail(RootNode(s), \\diskrec, [\\buf, ~recBuf.bufnum]); s.sync;`, id, true);
        r.recPath = file; r.recording = true; return { msg: "recording → " + path.basename(file) };
      default: throw new Error("Unsupported command " + c.cmd);
    }
  }
}
