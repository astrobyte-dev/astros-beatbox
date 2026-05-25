import dgram from "node:dgram";

// Receives plain-text level lines forwarded by the SuperDirt meter synth
// ("MTR <l> <r>") over UDP, so the dashboard can show a live master meter
// without flooding sclang's stdout.
export class Meter {
  l = 0;
  r = 0;
  lastUpdate = 0;
  hits: Record<number, number> = {}; // orbit -> timestamp of last event
  spectrum: number[] = []; // master output split into frequency bands
  // orbit -> latest per-channel rms/peak + downsampled waveform (+ times) for the
  // live per-card scope. `wave` is ~32 samples in roughly -1..1 (Strategy B).
  scopes: Record<number, { rms: number; peak: number; t: number; wave?: number[]; waveT?: number }> = {};
  // audio clock from Tidal's /dirt/play (for phase-locking the dashboard playhead):
  cycle = 0;     // latest cycle position (fractional = sub-cycle phase)
  cps = 0;       // cycles/sec at that moment (so the browser stops hardcoding tempo)
  lead = 0;      // seconds until this event is actually heard (Tidal scheduling latency)
  cycleAt = 0;   // Date.now() when received (browser subtracts age to anchor precisely)
  private sock = dgram.createSocket("udp4");

  start(port: number): void {
    this.sock.on("message", (buf) => {
      const parts = buf.toString("utf8").trim().split(/\s+/);
      if (parts[0] === "MTR") {
        this.l = Math.min(1, Math.max(0, parseFloat(parts[1]) || 0));
        this.r = Math.min(1, Math.max(0, parseFloat(parts[2]) || 0));
        this.lastUpdate = Date.now();
      } else if (parts[0] === "HIT") {
        const o = parseInt(parts[1], 10);
        if (!Number.isNaN(o)) this.hits[o] = Date.now();
      } else if (parts[0] === "SPEC") {
        this.spectrum = parts.slice(1).map((x) => Math.min(1, Math.max(0, parseFloat(x) || 0)));
      } else if (parts[0] === "RMS") {
        const o = parseInt(parts[1], 10);
        if (!Number.isNaN(o)) {
          const clamp = (v: number) => Math.min(1, Math.max(0, v || 0));
          const e = this.scopes[o] ?? { rms: 0, peak: 0, t: 0 };
          e.rms = clamp(parseFloat(parts[2]));
          e.peak = clamp(parseFloat(parts[3]));
          e.t = Date.now();
          this.scopes[o] = e;
        }
      } else if (parts[0] === "WAVE") {
        const o = parseInt(parts[1], 10);
        if (!Number.isNaN(o)) {
          const e = this.scopes[o] ?? { rms: 0, peak: 0, t: 0 };
          e.wave = parts.slice(2).map((x) => parseFloat(x) || 0);
          e.waveT = Date.now();
          this.scopes[o] = e;
        }
      } else if (parts[0] === "CLK") {
        this.cycle = parseFloat(parts[1]) || 0;
        this.cps = parseFloat(parts[2]) || 0;
        this.lead = parseFloat(parts[3]) || 0;
        this.cycleAt = Date.now();
      }
    });
    this.sock.on("error", () => { /* ignore */ });
    this.sock.bind(port, "127.0.0.1");
    this.sock.unref(); // don't keep the event loop alive on shutdown
  }

  stop(): void {
    try { this.sock.close(); } catch { /* ignore */ }
  }
}
