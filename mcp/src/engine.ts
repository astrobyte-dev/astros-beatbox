import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Sclang } from "./sclang.js";
import { Tidal } from "./tidal.js";
import { METER_UDP_PORT, AUDIO_DEVICE_FILE, DEFAULT_AUDIO_DEVICE, SCOPE_ENABLED, SCOPE_RMS_HZ, SCOPE_WAVE_N, SCOPE_WAVE_MS } from "./config.js";

// Clear orphaned rig processes (from a previous instance that was hard-killed on
// reload, leaving an scsynth/sclang holding port 57120). Blanket kill by image
// name. IMPORTANT: only call this at *boot* (inside ensureBooted), which only the
// instance you're actually playing through runs. Calling it on shutdown let
// transient instances (health checks) nuke the live engine.
function clearOrphans(): void {
  try {
    execSync("taskkill /F /IM scsynth.exe /IM sclang.exe /IM ghci.exe /IM ghc.exe", { stdio: "ignore" });
  } catch {
    /* nothing to kill */
  }
}

// Kill a single process tree by PID (/T includes children, e.g. sclang's scsynth).
function killTree(pid?: number): void {
  if (!pid) return;
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

// Owns the long-lived SuperDirt + Tidal pair and boots them once (warm), so
// every tool call after the first is sub-second.
export class Engine {
  sclang = new Sclang();
  tidal = new Tidal();
  state: "idle" | "booting" | "ready" | "error" = "idle";
  error: string | null = null;
  devices: string[] = [];        // available audio output devices (WASAPI)
  currentDevice = "";            // device the engine is (re)booting with
  private bootPromise: Promise<void> | null = null;

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
    if (!this.bootPromise) {
      this.state = "booting";
      this.currentDevice = this.readDeviceFile();
      this.bootPromise = (async () => {
        clearOrphans();
        await new Promise((r) => setTimeout(r, 800));
        this.sclang.start();
        await this.sclang.bootSuperDirt();    // scsynth + SuperDirt on :57120
        this.tidal.start();                   // ghci connects to SuperDirt
        await this.tidal.waitConnected();
        await this.installMaster();           // limiter + meter (best-effort)
        await this.installScope();            // per-channel live scope (best-effort)
        await this.queryDevices();            // list output devices for the dashboard
        this.state = "ready";
      })().catch((e) => {
        this.state = "error";
        this.error = String(e);
        throw e;
      });
    }
    return this.bootPromise;
  }

  // Master safety limiter + a master level meter that forwards L/R to the
  // dashboard over UDP. Both sit at the root tail (after all SuperDirt orbits).
  private async installMaster(): Promise<void> {
    const code =
      `( Routine({ ` +
      `SynthDef(\\masterLimiter, { ReplaceOut.ar(0, Limiter.ar(In.ar(0,2), 0.97, 0.002)) }).add; ` +
      `SynthDef(\\masterMeter, { SendReply.kr(Impulse.kr(15), '/meter', Amplitude.kr(In.ar(0,2))) }).add; ` +
      `SynthDef(\\masterSpec, { var sig = In.ar(0,2).sum; var amps = [60,120,200,350,600,1000,1700,2800,4500,7000,11000,16000].collect { |f| Amplitude.kr(BPF.ar(sig, f, 0.5)) }; SendReply.kr(Impulse.kr(20), '/spec', amps); }).add; ` +
      `s.sync; ` +
      `Synth.tail(RootNode(s), \\masterLimiter); ` +
      `Synth.tail(RootNode(s), \\masterMeter); ` +
      `Synth.tail(RootNode(s), \\masterSpec); ` +
      `OSCdef(\\meterfwd, {|msg| NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("MTR " ++ msg[3].round(0.001) ++ " " ++ msg[4].round(0.001)) }, '/meter'); ` +
      `OSCdef(\\specfwd, {|msg| NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("SPEC " ++ msg[3..].collect({|x| x.round(0.001)}).join(" ")) }, '/spec'); ` +
      // tap every Tidal event: forward its orbit (HIT, for slot flashing) AND the audio
      // clock (CLK <cycle> <cps>) so the dashboard can phase-lock its playhead to the real
      // beat instead of a free-running browser timer. cycle is fractional (sub-cycle phase).
      // `time` is the scheduled AUDIO onset; the OSCdef fires ~latency earlier, so
      // lead = time - now is how long until this event is actually heard (~0.25s).
      // Forwarding it lets the browser delay the playhead to match the sound exactly.
      `OSCdef(\\hittap, {|msg, time| var orb = 0, cyc = -1, cpv = -1, lead = (time - SystemClock.seconds).max(0); msg.do { |it, ix| if(it.asString == "orbit") { orb = msg[ix+1] }; if(it.asString == "cycle") { cyc = msg[ix+1] }; if(it.asString == "cps") { cpv = msg[ix+1] } }; NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("HIT " ++ orb); if(cyc >= 0) { NetAddr("127.0.0.1", ${METER_UDP_PORT}).sendRaw("CLK " ++ cyc.round(0.0001) ++ " " ++ cpv.round(0.0001) ++ " " ++ lead.round(0.0001)) } }, '/dirt/play'); ` +
      `("MTR" ++ "INIT").postln; ` +
      `}).play(SystemClock); )`;
    this.sclang.eval(code);
    await this.sclang.waitFor("MTRINIT", 8000).catch(() => { /* meter is best-effort */ });
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
      `( Routine({ ` +
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
      `("SCOPE" ++ "INIT").postln; ` +
      `}).play(SystemClock); )`;
    this.sclang.eval(code);
    await this.sclang.waitFor("SCOPEINIT", 9000).catch(() => { /* scope is best-effort */ });
  }

  // Enumerate audio output devices so the dashboard can offer a picker. Markers are
  // echo-proof (assembled at runtime: "AUDIO" ++ "DEV<<" never appears verbatim in
  // the echoed stdin, so the regex only matches the actual postln output).
  private async queryDevices(): Promise<void> {
    try {
      this.sclang.eval(
        `ServerOptions.devices.do { |d| ("AUDIO" ++ "DEV<<" ++ d ++ ">>").postln }; ("AUDIO" ++ "DEVDONE").postln;`,
      );
      await this.sclang.waitFor("AUDIODEVDONE", 6000);
      const tail = this.sclang.tail(16000);
      const set = new Set<string>();
      const re = /AUDIODEV<<(.+?)>>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(tail))) { const d = m[1].trim(); if (d) set.add(d); }
      const all = [...set];
      const wasapi = all.filter((d) => /WASAPI/i.test(d));
      this.devices = wasapi.length ? wasapi : all;
    } catch { /* leave devices as-is; dashboard just won't show a list */ }
  }

  stop(): void {
    // Kill ONLY our own process trees (sclang's /T tree includes its scsynth).
    // Never blanket-kill here, or transient instances would nuke a live engine.
    killTree(this.tidal.pid);
    killTree(this.sclang.pid);
    try { this.tidal.stop(); } catch { /* ignore */ }
    try { this.sclang.stop(); } catch { /* ignore */ }
  }

  // Hard reset: tear the engine down and bring it back fresh (clears any hanging
  // synth / wedged state). ~30-40s. Recreates the driver instances since the old
  // child processes are dead.
  async reboot(): Promise<void> {
    this.stop();
    clearOrphans();
    this.bootPromise = null;
    this.state = "idle";
    this.sclang = new Sclang();
    this.tidal = new Tidal();
    await new Promise((r) => setTimeout(r, 1000));
    await this.ensureBooted();
  }
}
