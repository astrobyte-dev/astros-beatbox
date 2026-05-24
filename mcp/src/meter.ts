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
      }
    });
    this.sock.on("error", () => { /* ignore */ });
    this.sock.bind(port, "127.0.0.1");
  }

  stop(): void {
    try { this.sock.close(); } catch { /* ignore */ }
  }
}
