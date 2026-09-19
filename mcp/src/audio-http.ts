import type { IncomingMessage, ServerResponse } from "node:http";
import type { UserAudioLibrary } from "./user-audio.js";
import type { Capture } from "./capture.js";
import { AUDIO_LIMIT } from "./sampling.js";

export interface AudioResources { library: UserAudioLibrary; capture: Capture; sessionId: string; meter?: () => unknown }
export function audioHttp(req: IncomingMessage, res: ServerResponse, resources?: AudioResources): boolean {
  if (!req.url?.startsWith("/audio/")) return false;
  const url = new URL(req.url, "http://localhost");
  const reply = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  if (!resources) { reply(503, { error: "Audio library is preparing" }); return true; }
  const r = resources;
  if (req.method === "POST" && url.pathname === "/audio/import") {
    let sameOrigin = !req.headers.origin;
    try { if (req.headers.origin) sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* reject */ }
    if (!sameOrigin || req.headers["x-beatbox-session"] !== r.sessionId) { reply(403, { error: "Refresh Studio before importing" }); req.resume(); return true; }
    if (req.headers["content-type"] !== "audio/wav") { reply(415, { error: "Use a WAV upload" }); req.resume(); return true; }
    if (Number(req.headers["content-length"]) > AUDIO_LIMIT) { reply(413, { error: "Sound exceeds 256 MiB" }); req.resume(); return true; }
    if (r.library.progress.busy) { reply(409, { error: "An import is in progress" }); req.resume(); return true; }
    const name = url.searchParams.get("name") ?? "", relink = url.searchParams.get("relink");
    if (name.length > 255 || !/^[^/\\\x00-\x1f]+\.wav$/i.test(name) || name.startsWith(".") || relink && !/^audio_[a-f0-9]{64}$/.test(relink)) { reply(400, { error: "Invalid WAV name or relink identity" }); req.resume(); return true; }
    req.setTimeout(90000, () => req.destroy(new Error("Upload timed out")));
    void r.library.importStream(req, url.searchParams.get("name") ?? "", "user", url.searchParams.get("relink") ?? undefined).then(result => reply(200, result)).catch(e => { if (!res.destroyed) reply(400, { error: String(e) }); });
    return true;
  }
  try {
    if (req.method !== "GET") throw new Error("Unsupported audio request");
    if (url.pathname === "/audio/library") reply(200, { entries: r.library.list(), warning: r.library.warning, progress: r.library.progress });
    else if (url.pathname === "/audio/input-meter") reply(200, r.meter?.() ?? { available: false });
    else {
      const m = /^\/audio\/(sound|capture)\/([a-zA-Z0-9_-]+)\/wave$/.exec(url.pathname);
      if (!m) throw new Error("Unknown audio resource");
      reply(200, m[1] === "sound" ? r.library.waveform(m[2]) : r.capture.waveform(m[2]));
    }
  } catch (e) { reply(404, { error: String(e) }); }
  return true;
}
