import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { validateCommand, requiresProjectRevision, type Command, type CommandResult } from "./commands.js";
import { track, scStr, type RigState } from "./track.js";
import type { EvalResult } from "./protocol.js";
import { ProjectService, ProjectConflict } from "./project-service.js";
import { ProjectStorage } from "./project-storage.js";
import { clone, emptyProject, uid, type ProjectDocument, type ProjectEdit, type Parameter } from "./project.js";
import { projectSlots, compileArrangement, mixerCommand } from "./project-compiler.js";
import { libraryAsset, resolveSample, soundLibrary } from "./sound-library.js";
import { Preview } from "./preview.js";
import { RecordingCatalog, validateWav } from "./recordings.js";
import type { Asset } from "./sound-library.js";

export interface CommandEngine {
  generation: number; running: boolean; state: string; error: string | null;
  ensureBooted(): Promise<void>; reboot(): Promise<void>; assertGeneration(generation: number): void;
  assertSampleLoaded?(asset: Asset): void;
  tidal: { eval(code: string, id?: string): Promise<EvalResult>; hush(id?: string): Promise<EvalResult> };
  sclang: { eval(code: string, id?: string): Promise<EvalResult>; evalRoutine(code: string, id?: string): Promise<EvalResult> };
}
export interface ApplicationPaths { sets: string; recordings: string; device: string; projects?: string; recovery?: string; samples?: string }
export interface LiveRig extends RigState { paused: boolean; stopped: boolean; recording: boolean; recPath: string; synchronized: boolean }

// HTTP and MCP share the P0a queue. The rig's musical fields are a compatibility
// projection; ProjectService owns authored music, revisions, history and recovery.
export class Application {
  readonly sessionId = randomUUID();
  readonly rig: LiveRig = { slots: {}, tempoBpm: 0, beatsPerCycle: 4, muted: new Set(), solo: null, paused: false, stopped: false, recording: false, recPath: "", synchronized: true };
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private requests = new Map<string, { fingerprint: string; at: number; result: Promise<CommandResult>; done: boolean }>();
  static readonly RETRY_MS = 5 * 60 * 1000;

  readonly project: ProjectService;
  readonly recordings: RecordingCatalog;
  readonly preview: Preview;
  private recordingId: string | null = null;
  private recordingGeneration: number | null = null;
  private recorderUncertain = false;
  readonly runtime = { appliedRevision: null as number | null, appliedProjectId: null as string | null, song: false, error: null as string | null };
  constructor(readonly engine: CommandEngine, private paths: ApplicationPaths) {
    this.recordings = new RecordingCatalog(paths.recordings);
    this.preview = new Preview(engine, paths.samples);
    this.project = new ProjectService(paths.projects && paths.recovery ? new ProjectStorage(paths.projects, paths.recovery) : undefined);
    if (this.project.workspace.recovered) { this.projectRig(); this.rig.stopped = true; this.rig.paused = true; }
  }
  projectState() {
    if (this.rig.recording && (!this.engine.running || this.recordingGeneration !== this.engine.generation) && this.recordingId) {
      this.recordings.fail(this.recordingId, "Audio engine ended before this take could be finalized.", "interrupted");
      this.rig.recording = false;
    }
    return { project: this.project.document, history: this.project.history, workspace: this.project.workspace, projectRuntime: { ...this.runtime, appliedGeneration: this.appliedGeneration, queued: this.waiting }, assets: this.project.assets(this.paths.samples), preview: this.preview.snapshot(), recordingState: this.recordingId ? this.recordings.get(this.recordingId) : null, recordings: this.recordings.list(), recordingWarning: this.recordings.warning };
  }
  sounds() { return soundLibrary(this.paths.samples); }
  async drain() { await this.queue; }
  private appliedGeneration: number | null = null;
  dispatchExternal(input: unknown): Promise<CommandResult> {
    try { const c = validateCommand(input); if (requiresProjectRevision(c.cmd) && c.projectId === undefined) return Promise.resolve(this.failure(c.operationId ?? uid(), "STALE_PROJECT", "Read status and provide projectId and revision before editing or executing music.")); }
    catch { return this.dispatch(input); }
    return this.dispatch(input);
  }
  private projectRig(): void {
    const p = this.project.document;
    this.rig.slots = projectSlots(p); this.rig.tempoBpm = p.tempo.bpm;
    this.rig.beatsPerCycle = p.tempo.beatsPerCycle;
    this.rig.muted = new Set(p.tracks.filter(t => t.mixer.mute).map(t => "d" + t.slot));
    this.rig.solo = p.tracks.find(t => t.mixer.solo) ? "d" + p.tracks.find(t => t.mixer.solo)!.slot : null;
  }

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
    const { operationId: _operation, sessionId: _session, issuedAt: _issued, ...payload } = c;
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const prior = this.requests.get(id);
    if (prior) return prior.fingerprint === fingerprint ? prior.result : Promise.resolve(this.failure(id, "ID_CONFLICT", "Operation ID was already used for a different command."));
    for (const [key, entry] of this.requests) if (entry.done && now - entry.at > Application.RETRY_MS) this.requests.delete(key);
    if (this.waiting >= 256 || this.requests.size >= 8192) return Promise.resolve(this.failure(id, "BUSY", "Command queue is full; wait for current operations."));
    this.waiting++;
    const generation = this.engine.generation;
    const projectId = this.project.document.id;
    const result = this.queue.then(async (): Promise<CommandResult> => {
      try {
        // Do not execute work queued against an engine that has since restarted.
        this.engine.assertGeneration(generation);
        if (c.projectId !== undefined) this.project.assert(c.projectId, c.revision!);
        else if (requiresProjectRevision(c.cmd) && projectId !== this.project.document.id) throw new ProjectConflict("Queued command belongs to a previous project");
        const reply = await this.execute(c, id);
        // Keep retry results small: full documents belong to status, not thousands
        // of cached command responses. Identity/revision is enough to chain local edits.
        return { ok: true, operationId: id, sessionId: this.sessionId, generation: this.engine.generation, projectId: this.project.document.id, revision: this.project.document.revision, history: this.project.history, ...reply };
      } catch (e) { return this.failure(id, e instanceof ProjectConflict ? e.code : "EXECUTION", e); }
      finally { this.waiting--; }
    });
    const entry = { fingerprint, at: c.issuedAt ?? now, result, done: false };
    this.requests.set(id, entry);
    this.queue = result.then(() => { entry.done = true; });
    return result;
  }

  private failure(id: string, code: string, e: unknown): CommandResult {
    return { ok: false, operationId: id, sessionId: this.sessionId, generation: this.engine.generation, projectId: this.project.document.id, revision: this.project.document.revision, code, error: (e instanceof Error ? e.message : String(e)).slice(-16000) };
  }
  private managed(p = this.project.document): boolean { return p.clips.some(c => c.kind === "steps" || c.managed); }
  private async verifySamples(p: ProjectDocument, id: string): Promise<void> {
    const active = new Set(this.runtime.song ? p.arrangement.flatMap(a => Object.values(p.scenes.find(s => s.id === a.sceneId)!.clips)) : p.tracks.map(t => t.activeClipId));
    const assets = new Set(p.clips.filter(c => active.has(c.id) && c.kind === "steps").map(c => (c as { assetId: string }).assetId));
    const checks: string[] = [];
    for (const a of p.assets) if (assets.has(a.id) && a.kind === "sample" && a.source && resolveSample(a, this.paths.samples).status === "available") {
      this.engine.assertSampleLoaded?.(a);
      const index = resolveSample(a, this.paths.samples).index;
      const file = scStr(path.resolve(this.paths.samples!, a.source.file).replace(/\\/g, "/"));
      // SC standardizePath can retain Windows backslashes; normalize separators
      // on both sides while still comparing the entire loaded file path.
      checks.push(`{ var buffers = ~dirt.soundLibrary.buffers["${scStr(a.name)}".asSymbol], b; if(buffers.isNil or: { buffers.size <= ${index} }) { Error("Saved sample is not loaded").throw }; b = buffers[${index}]; if(b.path.standardizePath.replace(92.asAscii.asString, "/") != "${file}".standardizePath.replace(92.asAscii.asString, "/") or: { b.numFrames <= 0 }) { Error("Loaded sample identity differs; Reset audio").throw }; }.value;`);
    }
    if (checks.length) await this.sc(checks.join(" ") + " s.sync;", id, true);
  }
  private audioSlots(p: ProjectDocument): Record<string, string> {
    // SuperDirt wraps out-of-range sample indices. Silence explicitly missing
    // references instead of allowing that silent substitution, retaining the document.
    const missing = new Set(this.project.assets(this.paths.samples, p).filter(a => a.status === "missing").map(a => a.id));
    // A file reference is saved intact but needs an explicitly registered library
    // before playback. Never accidentally play a built-in with the same name.
    for (const a of p.assets) if (a.kind === "file") missing.add(a.id);
    const safe = clone(p), clips = new Set(safe.clips.filter(c => c.kind === "steps" && missing.has(c.assetId)).map(c => c.id));
    for (const a of safe.assets) if (a.kind === "sample") a.index = resolveSample(a, this.paths.samples).index;
    for (const t of safe.tracks) if (t.activeClipId && clips.has(t.activeClipId)) t.activeClipId = null;
    for (const s of safe.scenes) for (const k of Object.keys(s.clips)) if (s.clips[k] && clips.has(s.clips[k]!)) s.clips[k] = null;
    return this.runtime.song ? compileArrangement(safe) : projectSlots(safe);
  }
  private async applyProject(next: ProjectDocument, previous: ProjectDocument, id: string, force = false): Promise<void> {
    if (!this.engine.running) { this.runtime.appliedRevision = null; this.rig.synchronized = false; return; }
    const before = this.audioSlots(previous), after = this.audioSlots(next);
    const mixing = this.managed(next) || this.managed(previous);
    try {
      if (!this.rig.stopped && !this.rig.paused && (force || JSON.stringify(before) !== JSON.stringify(after))) await this.verifySamples(next, id);
      if (mixing && (force || mixerCommand(next) !== mixerCommand(previous))) await this.sc(mixerCommand(next), id, true);
      const solo = next.tracks.some(t => t.mixer.solo);
      for (const t of next.tracks.filter(t => t.channel === null)) {
        const old = previous.tracks.find(o => o.id === t.id), muted = t.mixer.mute || solo && !t.mixer.solo;
        const wasMuted = old && (old.mixer.mute || previous.tracks.some(t => t.mixer.solo) && !old.mixer.solo);
        if (force || muted !== wasMuted) await this.tidal(`${muted ? "mute" : "unmute"} ${t.slot}`, id);
      }
      if (force || JSON.stringify(next.tempo) !== JSON.stringify(previous.tempo)) await this.tidal(`setcps (${next.tempo.bpm}/60/${next.tempo.beatsPerCycle})`, id);
      if (!this.rig.stopped && !this.rig.paused) {
        for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (force || before[k] !== after[k]) await this.tidal(after[k] ? `${k} $ ${after[k]}` : `${k} silence`, id);
      }
      if (force) this.rig.synchronized = true;
    } catch (e) { this.rig.synchronized = false; this.runtime.error = String(e); this.runtime.appliedRevision = null; throw e; }
  }
  private markApplied(): void {
    if (this.engine.running && this.rig.synchronized) { this.runtime.appliedRevision = this.project.document.revision; this.runtime.appliedProjectId = this.project.document.id; this.appliedGeneration = this.engine.generation; this.runtime.error = null; }
  }
  private async changeProject(next: ProjectDocument, c: Command, id: string, mode: "edit" | "undo" | "redo" | "switch" = "edit"): Promise<void> {
    const previous = this.project.document;
    try {
      await this.applyProject(next, previous, id, mode === "switch");
      if (mode === "switch") this.project.acceptSwitch(next);
      else if (mode === "undo" || mode === "redo") this.project.acceptHistory(mode === "redo", next);
      else this.project.commit(next, c.label ?? c.cmd, c.groupId);
      this.projectRig(); this.markApplied();
    } catch (e) {
      // No document/history swap on failed load, engine acknowledgement or write.
      // Restore managed playback best effort, but do not invent atomic engine rollback.
      try { await this.applyProject(previous, next, id, true); } catch { /* visible below */ }
      this.runtime.appliedRevision = null; this.runtime.error = String(e); this.rig.synchronized = false; throw e;
    }
  }
  private async execute(c: Command, id: string): Promise<{ msg: string; output?: string; acknowledgement?: EvalResult["acknowledgement"] }> {
    if (c.cmd === "preview.play") { await this.preview.play(String(c.value), id); return { msg: "Preview playing through your audio output" }; }
    if (c.cmd === "preview.stop") { await this.preview.stop(id); return { msg: "Preview stopped" }; }
    if (c.cmd === "sound.replace") {
      const asset = libraryAsset(this.paths.samples, String(c.value), uid());
      const next = this.project.prepare([{ type: "asset.put", asset }, { type: "sound.set", clipId: c.clipId!, assetId: asset.id }]);
      if (this.preview.snapshot().state === "previewing") await this.preview.stop(id);
      await this.changeProject(next, { ...c, label: "Replace sound" }, id);
      return { msg: "Sound replaced; rhythm and effects kept" };
    }
    if (c.cmd === "record.start" || c.cmd === "record" && !this.rig.recording) { await this.startRecording(id); return { msg: "Recording your jam" }; }
    if (c.cmd === "record.stop" || c.cmd === "record") {
      const target = c.cmd === "record.stop" ? String(c.value) : this.recordingId;
      const entry = target ? this.recordings.get(target) : null;
      if (entry?.state === "ready") { this.recordings.retrieve(entry.id); return { msg: "Recording ready. Find it in Recordings." }; }
      if (!target || target !== this.recordingId || !this.rig.recording) throw new Error(entry?.error ?? "This recording is not active or ready");
      await this.finishRecording(id); return { msg: "Recording ready. Find it in Recordings." };
    }
    if (c.cmd === "project.edit") { await this.changeProject(this.project.prepare(c.edits), c, id); for (const e of c.edits!) if (e.type === "scene.activate") this.project.workspace.selectedSceneId = e.sceneId; return { msg: c.label! }; }
    if (c.cmd === "project.undo" || c.cmd === "project.redo") { const redo = c.cmd === "project.redo"; await this.changeProject(this.project.historyTarget(redo), c, id, redo ? "redo" : "undo"); return { msg: redo ? "Redone" : "Undone" }; }
    if (c.cmd === "project.save") { if (!this.project.storage) throw new Error("Project storage not configured"); this.project.storage.save(String(c.value), this.project.document); return { msg: "Saved complete project: " + c.value }; }
    if (["project.load", "project.new", "project.recover"].includes(c.cmd)) {
      const next = c.cmd === "project.new" ? emptyProject() : c.cmd === "project.recover" ? this.project.storage?.recover() : this.project.storage?.load(String(c.value));
      if (!next) throw new Error("No recoverable project available");
      await this.changeProject(this.project.switchTarget(next), c, id, "switch"); return { msg: "Project opened" };
    }
    if (c.cmd === "song.start" || c.cmd === "song.stop") {
      if (c.cmd === "song.start" && !this.project.document.arrangement.length) throw new Error("Add scenes to the song chain first");
      await this.engine.ensureBooted(); const previous = this.runtime.song; this.runtime.song = c.cmd === "song.start";
      try { await this.restore(id); } catch (e) { this.runtime.song = previous; throw e; }
      return { msg: this.runtime.song ? "Song arrangement enabled" : "Song arrangement disabled" };
    }
    const p = this.project.document, t = p.tracks.find(t => "d" + t.slot === c.slot);
    if (c.cmd === "set" || t && this.managed(p) && ["mute", "unmute", "solo", "silence"].includes(c.cmd) || c.cmd === "unsolo" && this.managed(p)) {
      const edits: ProjectEdit[] = [];
      if (c.cmd === "unsolo" || c.cmd === "solo") edits.push(...p.tracks.map(t => ({ type: "mixer.set" as const, trackId: t.id, values: { solo: c.cmd === "solo" && t.slot === Number(c.slot!.slice(1)) } })));
      else {
        if (!t) throw new Error("No active layer " + c.slot);
        if (c.cmd === "silence") edits.push({ type: "clip.activate", trackId: t.id, clipId: null });
        else if (c.cmd === "mute" || c.cmd === "unmute") edits.push({ type: "mixer.set", trackId: t.id, values: { mute: c.cmd === "mute" } });
        else if (c.param === "gain" || c.param === "pan") {
          if (t.channel === null || !this.managed(p)) throw new Error("Independent mixer requires a managed track; raw Tidal source is not rewritten");
          edits.push({ type: "mixer.set", trackId: t.id, values: c.param === "gain" ? { level: Number(c.value) } : { balance: Number(c.value) * 2 - 1 } });
        } else {
          if (!t.activeClipId) throw new Error("No active clip");
          edits.push({ type: "parameter.set", clipId: t.activeClipId, parameter: c.param as Parameter, value: Number(c.value) });
        }
      }
      await this.changeProject(this.project.prepare(edits), c, id); return { msg: c.cmd + " " + (c.slot ?? "") };
    }
    const musical = ["eval", "hush", "silence", "tempo", "mute", "unmute", "solo", "unsolo", "load"].includes(c.cmd);
    const saved = { slots: { ...this.rig.slots }, tempoBpm: this.rig.tempoBpm, muted: new Set(this.rig.muted), solo: this.rig.solo };
    const result = await this.handle(c, id);
    if (musical) {
      try {
        const next = this.legacyDocument(p);
        if (c.cmd === "load") next.sources.push({ id: uid(), name: c.value + ".tidal", source: readFileSync(path.join(this.paths.sets, c.value + ".tidal"), "utf8") });
        if (this.engine.running && this.managed(p) && mixerCommand(next) !== mixerCommand(p)) await this.sc(mixerCommand(next), id, true);
        this.project.commit(next, c.cmd === "eval" ? "Tidal edit" : c.cmd, c.groupId);
        this.markApplied();
      } catch (e) { Object.assign(this.rig, saved); this.rig.synchronized = false; this.runtime.appliedRevision = null; throw e; }
    }
    return result;
  }
  private legacyDocument(p: ProjectDocument): ProjectDocument {
    p = clone(p);
    if (this.rig.tempoBpm) p.tempo.bpm = this.rig.tempoBpm;
    const oldSlots = projectSlots(p);
    for (const [slot, source] of Object.entries(this.rig.slots)) {
      let t = p.tracks.find(t => t.slot === Number(slot.slice(1)));
      if (!t) { t = { id: uid(), name: slot, slot: Number(slot.slice(1)), channel: null, activeClipId: null, mixer: { level: 1, balance: 0, mute: false, solo: false } }; p.tracks.push(t); }
      if (oldSlots[slot] !== source) {
        const c = { id: uid(), trackId: t.id, name: "Tidal", kind: "code" as const, source, managed: false, dependencyIds: [] };
        p.clips.push(c); t.activeClipId = c.id;
      }
    }
    const priorSolo = p.tracks.find(t => t.mixer.solo), soloChanged = this.rig.solo !== (priorSolo ? "d" + priorSolo.slot : null);
    for (const t of p.tracks) { const k = "d" + t.slot; if (!this.rig.slots[k]) t.activeClipId = null; t.mixer.mute = this.rig.muted.has(k); if (soloChanged) t.mixer.solo = this.rig.solo === k; }
    return p;
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
    if (this.managed()) {
      if (!r.stopped && !r.paused) await this.verifySamples(this.project.document, id);
      await this.tidal("hush", id); await this.tidal("unmuteAll >> unsoloAll", id);
      const p = this.project.document;
      await this.sc(mixerCommand(p), id, true);
      await this.tidal(`setcps (${p.tempo.bpm}/60/${p.tempo.beatsPerCycle})`, id);
      const anySolo = p.tracks.some(t => t.mixer.solo);
      for (const t of p.tracks.filter(t => t.channel === null && (t.mixer.mute || anySolo && !t.mixer.solo))) await this.tidal(`mute ${t.slot}`, id);
      if (!r.stopped && !r.paused) for (const [slot, body] of Object.entries(this.audioSlots(p))) await this.tidal(`${slot} $ ${body}`, id);
      r.synchronized = true; this.markApplied(); return;
    }
    await this.tidal("hush", id);
    if (r.tempoBpm) await this.tidal(`setcps (${r.tempoBpm}/60/${r.beatsPerCycle ?? 4})`, id);
    for (const k of Object.keys(r.slots)) await this.tidal(`${k} $ ${r.slots[k]}`, id);
    await this.tidal("unmuteAll >> unsoloAll", id);
    for (const k of r.muted) await this.tidal(`mute ${k.slice(1)}`, id);
    if (r.solo) await this.tidal(`solo ${r.solo.slice(1)}`, id);
    if (r.stopped || r.paused) await this.tidal("hush", id);
    r.synchronized = true;
  }

  private async startRecording(id: string): Promise<void> {
    if (this.recorderUncertain) throw new Error("Recorder cleanup is uncertain. Reset the audio engine before starting another take.");
    if (this.rig.recording) return;
    const entry = this.recordings.create(this.project.document.id, this.project.document.name);
    this.recordingId = entry.id;
    this.rig.recPath = this.recordings.file(entry.id).replace(/\\/g, "/");
    try {
      await this.engine.ensureBooted();
      if (this.engine.state !== "ready") throw new Error("Audio must be ready before recording");
      this.recordingGeneration = this.engine.generation;
      await this.sc(`SynthDef(\\diskrec, { |buf, bus| DiskOut.ar(buf, In.ar(bus,2)) }).add; ~recBuf = Buffer.alloc(s, 65536, 2); s.sync; ~recBuf.write("${scStr(this.rig.recPath)}", "wav", "int16", 0, 0, true); s.sync; ~recSynth = Synth.tail(RootNode(s), \\diskrec, [\\buf, ~recBuf.bufnum, \\bus, ~abxRecordBus.index]); s.sync;`, id, true);
      this.rig.recording = true; this.recordingGeneration = this.engine.generation;
      this.recordings.update(entry.id, { state: "recording" });
    } catch (e) {
      try { await this.sc("~recSynth.free; s.sync; ~recBuf.close; s.sync; ~recBuf.free; s.sync;", id, true); this.rig.recording = false; } catch { this.recorderUncertain = true; }
      this.recordings.fail(entry.id, String(e));
      throw e;
    }
  }
  private async finishRecording(id: string): Promise<void> {
    const target = this.recordingId!;
    try {
      this.recordings.update(target, { state: "finalizing" });
      if (this.recordingGeneration !== this.engine.generation) throw new Error("Recording engine generation changed");
      // Stop the writer before closing its buffer; both barriers precede validation.
      await this.sc("~recSynth.free; s.sync; ~recBuf.close; s.sync; ~recBuf.free; s.sync;", id, true);
      this.rig.recording = false;
      this.recorderUncertain = false;
      const audio = validateWav(this.rig.recPath);
      this.recordings.update(target, { state: "ready", audio, finishedAt: new Date().toISOString() });
    } catch (e) {
      this.recorderUncertain = this.rig.recording;
      this.recordings.fail(target, String(e));
      throw e;
    }
  }

  private async handle(c: Command, id: string): Promise<{ msg: string; output?: string; acknowledgement?: EvalResult["acknowledgement"] }> {
    const r = this.rig, slot = c.slot!, n = slot?.slice(1);
    if (c.cmd === "eval" && /^hush\s*;?\s*$/.test(String(c.value))) return this.handle({ cmd: "hush" }, id);
    if (c.cmd === "save") {
      const name = String(c.value).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
      const keys = Object.keys(r.slots).sort((a, b) => +a.slice(1) - +b.slice(1));
      mkdirSync(this.paths.sets, { recursive: true });
      writeFileSync(path.join(this.paths.sets, name + ".tidal"), [`setcps (${r.tempoBpm || 120}/60/${r.beatsPerCycle ?? 4})`, ...keys.map((k) => `${k} $ ${r.slots[k]}`)].join("\n") + "\n", "utf8");
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
      if (r.recording || this.recorderUncertain) {
        try { await this.finishRecording(id); }
        catch (e) { recordingFailure = "Recording finalization was not confirmed: " + r.recPath + ". " + String(e); }
      }
      if (c.cmd === "setdevice") writeFileSync(this.paths.device, String(c.value).trim(), "utf8");
      r.synchronized = false;
      await this.engine.reboot(); r.recording = false; this.recorderUncertain = false; await this.restore(id);
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
        if (this.managed()) { const stopped = r.stopped, paused = r.paused; r.stopped = false; r.paused = false; try { await this.restore(id); } catch (e) { r.stopped = stopped; r.paused = paused; throw e; } return { msg: "resumed" }; }
        if (r.stopped) { r.stopped = false; r.paused = false; try { await this.restore(id); } catch (e) { r.stopped = true; r.paused = true; throw e; } }
        else { r.paused = false; await this.restore(id); }
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
        await this.tidal(`setcps (${c.value}/60/${r.beatsPerCycle ?? 4})`, id); r.tempoBpm = Number(c.value);
        return { msg: "tempo " + c.value };
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
      default: throw new Error("Unsupported command " + c.cmd);
    }
  }
}
