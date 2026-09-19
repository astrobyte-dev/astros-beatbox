import { parentPort, workerData } from "node:worker_threads";
import { openSync, closeSync, readSync, fstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { AUDIO_LIMIT } from "./sampling.js";

// A bounded streaming decoder on a worker: no samples or file-sized arrays enter React
// or the runtime command loop. PCM16 is the deliberately validated import surface.
export function analyzeAudio(file: string) {
  const fd = openSync(file, "r");
  try {
    const bytes = fstatSync(fd).size;
    if (bytes > AUDIO_LIMIT) throw new Error("WAV exceeds the 256 MiB limit");
    const read = (n: number, at: number) => { const b = Buffer.alloc(n); if (readSync(fd, b, 0, n, at) !== n) throw new Error("Truncated WAV"); return b; };
    const h = read(12, 0);
    if (h.toString("ascii", 0, 4) !== "RIFF" || h.toString("ascii", 8, 12) !== "WAVE" || h.readUInt32LE(4) + 8 !== bytes) throw new Error("WAV is malformed or not finalized");
    let channels = 0, sampleRate = 0, align = 0, data = 0, length = 0, offset = 12;
    for (; offset + 8 <= bytes;) {
      const c = read(8, offset), n = c.readUInt32LE(4), tag = c.toString("ascii", 0, 4);
      if (offset + 8 + n + n % 2 > bytes) throw new Error("Invalid WAV chunk");
      if (tag === "fmt ") {
        if (channels || n < 16) throw new Error("Invalid WAV format");
        const f = read(16, offset + 8); channels = f.readUInt16LE(2); sampleRate = f.readUInt32LE(4); align = f.readUInt16LE(12);
        if (f.readUInt16LE(0) !== 1 || f.readUInt16LE(14) !== 16 || ![1, 2].includes(channels) || align !== channels * 2 || sampleRate < 8000 || sampleRate > 192000 || f.readUInt32LE(8) !== sampleRate * align) throw new Error("Use mono or stereo PCM16 WAV (8–192 kHz)");
      }
      if (tag === "data") { if (data) throw new Error("Multiple audio chunks are unsupported"); data = offset + 8; length = n; }
      offset += 8 + n + n % 2;
    }
    if (offset !== bytes || !channels || !data || !length || length % align) throw new Error("WAV has no complete audio frames");
    const frames = length / align, duration = frames / sampleRate;
    if (duration > 900) throw new Error("Use sounds up to 15 minutes long");
    const peaks = Array<number>(512).fill(0), hash = createHash("sha256");
    for (let at = 0; at < bytes; at += 65536) hash.update(read(Math.min(65536, bytes - at), at));
    for (let at = 0; at < length; at += 65536) {
      const b = read(Math.min(65536, length - at), data + at);
      for (let i = 0; i < b.length; i += 2) { const bin = Math.min(511, Math.floor(((at + i) / align) / frames * 512)); peaks[bin] = Math.max(peaks[bin], Math.abs(b.readInt16LE(i)) / 32768); }
    }
    return { bytes, channels: channels as 1 | 2, sampleRate, frames, duration, sha256: hash.digest("hex"), peaks };
  } finally { closeSync(fd); }
}
if (parentPort) { try { parentPort.postMessage({ ok: true, audio: analyzeAudio(workerData.file) }); } catch (e) { parentPort.postMessage({ ok: false, error: String(e) }); } }
