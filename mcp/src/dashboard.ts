import http from "node:http";
import { readFileSync, readdirSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { SETS_DIR, DIRT_SAMPLES_DIR, PROJECTS_DIR } from "./config.js";
import type { CommandResult } from "./commands.js";
import type { RecordingCatalog } from "./recordings.js";

type CmdHandler = (body: unknown) => Promise<CommandResult>;

// Local dashboard: serves the HTML (read fresh per request so UI edits don't need
// an MCP reload), exposes /state (JSON) and /cmd (POST control commands).
// Cap concurrent SSE /clock connections to prevent unbounded timer accumulation.
const SSE_MAX = 8;
let sseCount = 0;

// Security headers applied to every response (including 403s).
const SEC_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  // Scripts are all src-loaded (no inline scripts); styles use 'unsafe-inline' for the <style> block.
  "content-security-policy":
    "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
};

export function startDashboard(
  port: number,
  htmlPath: string,
  getState: () => unknown,
  getClock: () => unknown,
  onCmd: CmdHandler,
  resources?: { sounds?: () => unknown; recordings?: RecordingCatalog; identity?: () => unknown; shutdown?: (session: string) => Promise<string> },
): http.Server {
  const server = http.createServer((req, res) => {
    // Apply security headers to every response.
    for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);

    // Loopback-only guard: block DNS-rebinding / cross-site access to this local rig
    // (which can run arbitrary code via /cmd). Fail closed: absent Host is also rejected.
    const hostName = (req.headers.host || "").split(":")[0];
    if (!hostName || (hostName !== "127.0.0.1" && hostName !== "localhost")) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }
    // Vite's production bundle shares this service and the existing guarded API.
    // Only flat, generated asset names are accepted; never resolve request paths.
    const urlPath = (req.url || '/').split('?')[0];
    if (req.method === "GET" && urlPath === "/runtime") {
      res.writeHead(resources?.identity ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(resources?.identity?.() ?? null)); return;
    }
    if (req.method === "GET" && urlPath === "/sounds") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(resources?.sounds?.() ?? [])); return;
    }
    if (req.method === "GET" && urlPath === "/recordings") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ entries: resources?.recordings?.list() ?? [], warning: resources?.recordings?.warning ?? null })); return;
    }
    if (urlPath.startsWith("/recordings/")) {
      const match = /^\/recordings\/([a-f0-9-]{36})\.wav$/.exec(urlPath);
      try {
        if (!match || !resources?.recordings || !["GET", "HEAD"].includes(req.method ?? "")) throw new Error("Recording not found");
        const file = resources.recordings.retrieve(match[1]), size = statSync(file).size;
        let start = 0, end = size - 1;
        if (req.headers.range) {
          const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          if (!range || +range[1] >= size || range[2] && +range[2] < +range[1]) { res.writeHead(416, { "content-range": `bytes */${size}` }); res.end(); return; }
          start = +range[1]; if (range[2]) end = Math.min(+range[2], end);
        }
        res.writeHead(req.headers.range ? 206 : 200, { "content-type": "audio/wav", "content-length": end - start + 1, "accept-ranges": "bytes", "cache-control": "no-store", ...(req.headers.range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}), ...(req.url?.includes("download=1") ? { "content-disposition": `attachment; filename="jam-${match[1]}.wav"` } : {}) });
        if (req.method === "HEAD") res.end();
        else { const stream = createReadStream(file, { start, end }); stream.on("error", () => res.destroy()); res.on("close", () => stream.destroy()); stream.pipe(res); }
      } catch (e) { res.writeHead(404, { "content-type": "text/plain" }); res.end(e instanceof Error ? e.message : "Recording unavailable"); }
      return;
    }
    if (urlPath === '/studio' || urlPath.startsWith('/studio/')) {
      const asset = /^\/studio\/assets\/([a-zA-Z0-9_-]+\.(?:js|css|woff2?|svg))$/.exec(urlPath);
      const index = urlPath === '/studio' || urlPath === '/studio/';
      if (!index && !asset) { res.writeHead(404); res.end('Studio file not found'); return; }
      try {
        const root = path.join(path.dirname(htmlPath), 'studio-dist');
        const data = readFileSync(index ? path.join(root, 'index.html') : path.join(root, 'assets', asset![1]));
        const types: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'content-type': index ? 'text/html; charset=utf-8' : types[path.extname(asset![1])], 'cache-control': index ? 'no-store' : 'public, max-age=31536000, immutable' });
        res.end(data);
      } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Studio build unavailable. Run npm run build in mcp.'); }
      return;
    }
    // Serve dashboard.js and any dashboard-*.js module (dsp/scope/curves/seq/cheats), read
    // fresh per request so UI edits don't need an MCP reload. The name is matched strictly
    // (lowercase alnum + dash, ending .js, no slashes/dots), so it cannot read arbitrary files.
    const jsMatch = req.url ? /^\/(dashboard(?:-[a-z0-9-]+)?\.js)(?:\?|$)/i.exec(req.url) : null;
    if (jsMatch) {
      try {
        const jsPath = htmlPath.replace(/dashboard\.html$/i, jsMatch[1]);
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(readFileSync(jsPath, "utf8"));
      } catch {
        res.writeHead(404, { "content-type": "application/javascript" });
        res.end("// module not found");
      }
      return;
    }
    if (req.url && req.url.startsWith("/state")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(getState()));
      return;
    }
    if (req.url && req.url.startsWith("/sets")) {
      let sets: string[] = [];
      try { sets = readdirSync(SETS_DIR).filter((f) => f.endsWith(".tidal")).map((f) => f.replace(/\.tidal$/, "")); } catch { /* none */ }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(sets.sort()));
      return;
    }
    if (req.url === "/projects") {
      let files: string[] = [];
      try { files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".abx.json")).map(f => f.slice(0, -9)).sort(); } catch { /* no saved projects */ }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(files)); return;
    }
    if (req.url && req.url.startsWith("/samples")) {
      let samples: string[] = [];
      try { samples = readdirSync(DIRT_SAMPLES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name); } catch { /* none */ }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(samples.sort()));
      return;
    }
    if (req.url && req.url.startsWith("/clock")) {
      // Real-time audio-clock stream (SSE) for phase-locking the dashboard playhead.
      // One-way server->browser; rides the existing http server (no new dependency/port).
      // Pushed at 30Hz; payload carries `age` (ms since the cycle was received) so the
      // browser can anchor precisely without inheriting push-quantization lag.
      if (sseCount >= SSE_MAX) {
        res.writeHead(429, { "content-type": "text/plain" });
        res.end("too many connections");
        return;
      }
      sseCount++;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const send = () => { try { res.write(`data: ${JSON.stringify(getClock())}\n\n`); } catch { /* connection closed */ } };
      send();
      const tick = setInterval(send, 1000 / 30);
      req.on("close", () => { clearInterval(tick); sseCount--; });
      return;
    }
    if (req.method === "POST" && (urlPath === "/cmd" || urlPath === "/runtime/stop")) {
      // Enforce JSON body: reject non-JSON content types to prevent misuse.
      const ct = (req.headers["content-type"] ?? "").split(";")[0].trim();
      if (ct && ct !== "application/json") {
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "content-type must be application/json" }));
        return;
      }
      // CSRF guard: /cmd runs arbitrary Tidal/SC code, so reject any cross-origin POST.
      // (Same-origin dashboard requests send our own Origin or none; attacker tabs send theirs.)
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
        if (!ok) { res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "forbidden origin" })); return; }
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 4 * 1024 * 1024) req.destroy(); });
      req.on("end", async () => {
        try {
          if (urlPath === "/runtime/stop") {
            if (!resources?.shutdown) throw new Error("Runtime control unavailable");
            const message = await resources.shutdown(JSON.parse(body).sessionId); res.writeHead(200); res.end(message); return;
          }
          const result = await onCmd(JSON.parse(body || "{}"));
          const status = result.ok ? 200 : result.code === "VALIDATION" ? 400 : ["STALE_SESSION", "STALE_PROJECT", "EXPIRED", "ID_CONFLICT"].includes(result.code) ? 409 : result.code === "BUSY" ? 503 : 500;
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }
    // default: the dashboard page
    try {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(htmlPath, "utf8"));
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("dashboard.html not found");
    }
  });
  server.on("error", (e) => { process.stderr.write(`dashboard server error: ${e}\n`); });
  server.listen(port, "127.0.0.1");
  return server;
}
