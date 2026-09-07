import { INSTALL_SAMPLE_ENVELOPE } from "./sampling-engine.js";
import { INSTALL_FX_AUTOMATION } from "./fx-automation.js";
import { SOUND_LAB_SYNTHS } from "./sound-lab-engine.js";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import type { DriverFault } from "./proc.js";
import { existsSync, readFileSync } from "node:fs";
import { Sclang } from "./sclang.js";
import { Tidal } from "./tidal.js";
import { CHANNEL_SYNTH } from "./project-compiler.js";
import { PREVIEW_SYNTHS } from "./preview.js";
import path from "node:path";
import { soundLibrary, fingerprint, resolveSample, type Asset } from "./sound-library.js";
import { DIRT_SAMPLES_DIR, AUDIO_CAPABILITIES } from "./config.js";
import { METER_UDP_PORT, AUDIO_DEVICE_FILE, DEFAULT_AUDIO_DEVICE, SCOPE_ENABLED, SCOPE_RMS_HZ, SCOPE_WAVE_N, SCOPE_WAVE_MS } from "./config.js";

// Never take over another server. Only probe availability; do not identify or kill
// the process using a port. Startup races fail normally without destructive cleanup.
export async function assertAudioPortsFree(): Promise<void> {
  for (const port of [57110, 57120]) {
    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      socket.once("error", (e) => { socket.close(); reject(new Error("Audio port " + port + " is unavailable; close the other rig explicitly. " + e.message)); });
      socket.bind(port, "127.0.0.1", () => socket.close(() => resolve()));
    });
  }
}

// Owns the long-lived SuperDirt + Tidal pair and boots them once (warm), so
// every tool call after the first is sub-second.
export class Engine extends EventEmitter {
  sclang = new Sclang();
  tidal = new Tidal();
  state: "idle" | "booting" | "ready" | "degraded" | "error" = "idle";
  error: string | null = null;
  inputDevices: string[] = [];
  inputConfiguration = { enabled: false, device: "", channel: 0 };
  devices: string[] = [];        // available audio output devices (WASAPI)
  readonly audioCapabilities = AUDIO_CAPABILITIES;
  currentDevice = "";            // device the engine is (re)booting with
  private bootPromise: Promise<void> | null = null;
  generation = 0;
  faultVersion = 0;
  lastFault: (DriverFault & { generation: number; at: number; interpreter: string }) | null = null;
  private fatal = false;
  private loadedSamples = new Map<string, { hash: string; index: number }>();

  assertSampleLoaded(asset: Asset): void {
    if (!asset.source) return;
    const loaded = this.loadedSamples.get(asset.source.file);
    if (!loaded || loaded.hash !== asset.source.sha256 || loaded.index !== resolveSample(asset, DIRT_SAMPLES_DIR).index) throw new Error("The sound library changed after audio preparation. Reset audio before using this sound.");
  }

  audioInfo: { sampleRate: number; outputs: number; orbits: number } | null = null;
  constructor(private checkPorts = assertAudioPortsFree) { super(); this.observe(); }

  private observe(): void {
    const generation = this.generation;
    for (const [source, driver] of [["supercollider", this.sclang], ["tidal", this.tidal]] as const) {
      driver.on("log", entry => { if (generation === this.generation) this.emit("log", { source, generation, ...entry }); });
    }
    for (const driver of [this.sclang, this.tidal]) driver.on("fault", (fault: DriverFault) => {
      if (generation !== this.generation) return;
      this.error = fault.message; this.faultVersion++;
      this.lastFault = { ...fault, generation, at: Date.now(), interpreter: driver === this.tidal ? "tidal" : "sclang" };
      if (fault.kind !== "interpreter") { this.fatal = true; this.state = "error"; }
      else if (this.state !== "booting" && !this.fatal) this.state = "degraded";
    });
  }

  assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new Error("Engine generation changed; operation outcome is stale.");
  }

  get running(): boolean { return this.sclang.running && this.tidal.running && !this.fatal; }

  // What output device is configured right now (file overrides the default).
  private readDeviceFile(): string {
    try {
      if (existsSync(AUDIO_DEVICE_FILE)) {
        const d = readFileSync(AUDIO_DEVICE_FILE, "utf8").trim();
        if (d === "SYSTEM") return "System default";
        if (d) return d;
      }
    } catch { /* fall through */ }
    return DEFAULT_AUDIO_DEVICE;
  }

  ensureBooted(): Promise<void> {
    if (this.fatal) return Promise.reject(new Error(this.error || "Engine unavailable; Reset to recover."));
    if (!this.bootPromise) {
      const generation = this.generation, sc = this.sclang, td = this.tidal;
      const check = () => this.assertGeneration(generation);
      this.state = "booting"; this.error = null;
      this.currentDevice = this.readDeviceFile();
      this.bootPromise = (async () => {
        await this.checkPorts(); check();
        this.loadedSamples = new Map(soundLibrary(DIRT_SAMPLES_DIR).map(s => [s.key, { hash: fingerprint(path.join(DIRT_SAMPLES_DIR, s.key)), index: s.index }]));
        sc.start(); await sc.bootSuperDirt(120000, this.inputConfiguration); check();
        td.start(); await td.waitConnected(); check();
        // GHCi can continue to a later prompt after a boot-file error. Force the
        // actual stream binding before declaring the interpreter usable.
        await td.eval("do { _ <- Control.Exception.evaluate tidal; pure () }", "boot-tidal"); check();
        await td.eval("setcps (120/60/4)", "boot-tempo"); check();
        await this.installChannels(); check();
        await sc.evalRoutine(INSTALL_SAMPLE_ENVELOPE, "install-sample-envelope"); check();
        await this.installMaster(); check();
        await this.installScope(); check();
        await this.queryDevices(); check();
        const info = await sc.eval('( "ABX_AUDIO" ++ "INFO " ++ s.sampleRate ++ " " ++ s.options.numOutputBusChannels ++ " " ++ ~dirt.orbits.size ).postln;', "audio-info"); check();
        const match = /ABX_AUDIOINFO ([0-9.]+) (\d+) (\d+)/.exec(info.output);
        this.audioInfo = match ? { sampleRate: +match[1], outputs: +match[2], orbits: +match[3] } : null;
        // Detect changes during boot as well as later replacement. Loaded buffer
        // ordering belongs to this engine generation, not a fresh UI directory scan.
        for (const sound of soundLibrary(DIRT_SAMPLES_DIR)) {
          const loaded = this.loadedSamples.get(sound.key);
          if (loaded && loaded.hash !== fingerprint(path.join(DIRT_SAMPLES_DIR, sound.key))) this.loadedSamples.delete(sound.key);
        }
        if (this.fatal) throw new Error(this.error || "Engine failed during boot");
        this.state = this.error ? "degraded" : "ready";
      })().catch((e) => {
        if (generation === this.generation) {
          this.state = "error"; this.fatal = true; this.error = String(e); this.faultVersion++;
        }
        throw e;
      });
    }
    return this.bootPromise;
  }

  // Master safety limiter + a master level meter that forwards L/R to the
  // dashboard over UDP. Both sit at the root tail (after all SuperDirt orbits).
  private async installChannels(): Promise<void> {
    await this.sclang.evalRoutine(CHANNEL_SYNTH + SOUND_LAB_SYNTHS + ` s.sync; ~abxFX = Dictionary.new; ~abxBuses = Array.fill(12, { Bus.audio(s, 2) }); ~dirt.orbits.do { |o, i| o.outBus = ~abxBuses[i].index }; s.sync; ~abxChannels = ~abxBuses.collect { |b| Synth.tail(RootNode(s), \\abxChannel, [\\inBus, b.index]) }; s.sync;` + INSTALL_FX_AUTOMATION, "install-channels", 15000);
  }

  private async installMaster(): Promise<void> {
    const code =
      PREVIEW_SYNTHS +
      `SynthDef(\\abxRecordTap, { |bus| ReplaceOut.ar(bus, In.ar(0, 2)) }).add; ` +
      `SynthDef(\\masterLimiter, { ReplaceOut.ar(0, Limiter.ar(In.ar(0,2), 0.97, 0.002)) }).add; ` +
      // Measure the audio envelope before sampling for telemetry. Control-rate
      // amplitude aliases held tones and can report a phase-dependent near-zero.
      `SynthDef(\\masterMeter, { SendReply.kr(Impulse.kr(15), '/meter', Amplitude.ar(In.ar(0,2))) }).add; ` +
      `SynthDef(\\masterSpec, { var sig = In.ar(0,2).sum; var amps = [60,120,200,350,600,1000,1700,2800,4500,7000,11000,16000].collect { |f| Amplitude.kr(BPF.ar(sig, f, 0.5)) }; SendReply.kr(Impulse.kr(20), '/spec', amps); }).add; ` +
      `s.sync; ` +
      `Synth.tail(RootNode(s), \\masterLimiter); ` +
      `Synth.tail(RootNode(s), \\masterMeter); ` +
      `Synth.tail(RootNode(s), \\masterSpec); ` +
      `~abxRecordBus = Bus.audio(s, 2); ~abxRecordTap = Synth.tail(RootNode(s), \\abxRecordTap, [\\bus, ~abxRecordBus.index]); ~abxPreviewGroup = Group.tail(RootNode(s)); ` +
      `OSCdef(\\meterfwd, {|msg| NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("MTR " ++ msg[3].round(0.001) ++ " " ++ msg[4].round(0.001)) }, '/meter'); ` +
      `OSCdef(\\specfwd, {|msg| NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("SPEC " ++ msg[3..].collect({|x| x.round(0.001)}).join(" ")) }, '/spec'); ` +
      // tap every Tidal event: forward its orbit (HIT, for slot flashing) AND the audio
      // clock (CLK <cycle> <cps>) so the dashboard can phase-lock its playhead to the real
      // beat instead of a free-running browser timer. cycle is fractional (sub-cycle phase).
      // `time` is the scheduled AUDIO onset; the OSCdef fires ~latency earlier, so
      // lead = time - now is how long until this event is actually heard (~0.25s).
      // Forwarding it lets the browser delay the playhead to match the sound exactly.
      `~abxEventCount = 0; OSCdef(\\hittap, {|msg, time| var control = false, orb = 0, cyc = -1, cpv = -1, lead = (time - SystemClock.seconds).max(0); msg.do { |it, ix| if(it.asString == "s") { control = msg[ix+1].asString == "abx_fxcontrol" }; if(it.asString == "orbit") { orb = msg[ix+1] }; if(it.asString == "cycle") { cyc = msg[ix+1] }; if(it.asString == "cps") { cpv = msg[ix+1] } }; if(control.not) { ~abxEventCount = ~abxEventCount + 1; NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("HIT " ++ orb) }; if(cyc >= 0) { NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("CLK " ++ cyc.round(0.0001) ++ " " ++ cpv.round(0.0001) ++ " " ++ lead.round(0.0001)) } }, '/dirt/play'); ` +
      `s.sync;`;
    await this.sclang.evalRoutine(code, "install-master", 15000);
  }

  // Per-channel live "synth board" scope. Two signals per orbit, forwarded to the
  // dashboard over UDP (same path as the master meter), additive + best-effort:
  //   * LEVEL: SuperDirt's built-in per-orbit RMS (startSendRMS) -> "RMS <orbit> <rms> <peak>"
  //     SendPeakRMS '/rms' reply = [path, nodeID, orbitIndex, peakL, rmsL, peakR, rmsR].
  //   * WAVEFORM: a tiny \abxScope synth per orbit decimates that orbit's (dry+fx)
  //     signal to 32 samples via Phasor/BufWr/BufRd and SendReply's '/abx/wave'
  //     -> "WAVE <orbit> s0..s31". It only READS buses (no Out.ar), so it can't alter
  //     audio. CRITICAL placement: it must sit *after* the orbit's dirt_rms node and
  //     before the monitor (addAction 3 = addAfter rms node) — read at the orbit group
  //     tail the per-orbit bus is already cleared (verified live). startSendRMS rebuilds
  //     the orbit node trees, so wait for that to settle before placing the synths.
  private async installScope(): Promise<void> {
    if (!SCOPE_ENABLED) return;
    const hz = SCOPE_RMS_HZ, P = METER_UDP_PORT, N = SCOPE_WAVE_N;
    const waveRate = Math.round((N * 1000) / SCOPE_WAVE_MS); // decimation rate (samples/sec)
    const code =
      ` ` +
      `SynthDef(\\abxScope, { |dryBus, fxBus, orbit = 0| ` +
        `var sig = (In.ar(dryBus, 2) + In.ar(fxBus, 2)).sum * 0.5; ` +
        `var buf = LocalBuf(${N}).clear; ` +
        `var wph = Phasor.ar(0, ${waveRate} / SampleRate.ir, 0, ${N}); ` +
        `var rd; ` +
        `BufWr.ar(sig, buf, wph, 1); ` +
        `rd = BufRd.kr(1, buf, (0..${N - 1}), 1, 1); ` +
        `SendReply.kr(Impulse.kr(${hz}), '/abx/wave', rd, orbit); ` +
      `}).add; ` +
      `~dirt.startSendRMS(${hz}, 3); ` +
      `s.sync; 1.0.wait; ` +
      `OSCdef(\\rmsfwd, {|msg| var orbit = msg[2], rms = ((msg[4] + msg[6]) * 0.5), peak = max(msg[3], msg[5]); NetAddr("127.0.0.1", ${P}).sendRaw("RMS " ++ orbit ++ " " ++ rms.round(0.001) ++ " " ++ peak.round(0.001)) }, '/rms'); ` +
      `OSCdef(\\wavefwd, {|msg| NetAddr("127.0.0.1", ${P}).sendRaw("WAVE " ++ msg[2] ++ " " ++ msg[3..].collect({|x| x.round(0.001)}).join(" ")) }, '/abx/wave'); ` +
      `~dirt.orbits.do { |o, i| var rs = o.getGlobalEffect('dirt_rms').synth; if(rs.notNil) { s.sendMsg("/s_new", "abxScope", -1, 3, rs.nodeID, "dryBus", o.dryBus.index, "fxBus", o.globalEffectBus.index, "orbit", i) } }; ` +
      `s.sync;`;
    try { await this.sclang.evalRoutine(code, "install-scope", 15000); }
    catch (e) { this.error = "Scope unavailable: " + String(e); this.faultVersion++; }
  }

  // Enumerate audio output devices so the dashboard can offer a picker. Markers are
  // echo-proof (assembled at runtime: "AUDIO" ++ "DEV<<" never appears verbatim in
  // the echoed stdin, so the regex only matches the actual postln output).
  private async queryDevices(): Promise<void> {
    if (!AUDIO_CAPABILITIES.deviceSelection) { this.devices = []; return; }
    try {
      const result = await this.sclang.eval(
        `ServerOptions.inDevices.do { |d| ("INPUT" ++ "DEV<<" ++ d ++ ">>").postln }; ServerOptions.devices.do { |d| ("AUDIO" ++ "DEV<<" ++ d ++ ">>").postln }; ("AUDIO" ++ "DEVDONE").postln;`,
      );
      const tail = result.output;
      this.inputDevices = [...tail.matchAll(/INPUTDEV<<(.+?)>>/g)].map(m => m[1]);
      const set = new Set<string>();
      const re = /AUDIODEV<<(.+?)>>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(tail))) { const d = m[1].trim(); if (d) set.add(d); }
      const all = [...set];
      const wasapi = all.filter((d) => /WASAPI/i.test(d));
      this.devices = wasapi.length ? wasapi : all;
    } catch (e) { this.error = "Device enumeration failed: " + String(e); this.faultVersion++; }
  }

  stop(): void {
    this.audioInfo = null;
    this.generation++;
    this.fatal = true;
    this.error = "Engine stopped; Reset to start a new generation.";
    const failures: string[] = [];
    for (const driver of [this.tidal, this.sclang]) {
      try { driver.stop(); } catch (e) { failures.push(String(e)); }
    }
    this.state = "idle";
    if (failures.length) {
      this.state = "error"; this.error = "Owned-process cleanup failed: " + failures.join("; ");
      throw new Error(this.error);
    }
  }

  async configureInput(configuration: { enabled: boolean; device: string; channel: number }): Promise<void> {
    if (configuration.device && (!this.audioCapabilities.deviceSelection || !this.inputDevices.includes(configuration.device))) throw new Error("Input device is unavailable; refresh devices or use the backend default");
    this.inputConfiguration = { ...configuration };
    await this.reboot();
  }

  async reboot(): Promise<void> {
    this.stop();
    this.bootPromise = null; this.fatal = false; this.error = null; this.lastFault = null;
    this.sclang = new Sclang(); this.tidal = new Tidal(); this.observe();
    await this.ensureBooted();
  }
}
