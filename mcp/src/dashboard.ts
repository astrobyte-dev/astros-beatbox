import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { SETS_DIR, DIRT_SAMPLES_DIR } from "./config.js";

type CmdBody = { cmd: string; slot?: string; param?: string; value?: number | string };
type CmdHandler = (body: CmdBody) => Promise<string> | string;

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
    if (req.method === "POST" && req.url && req.url.startsWith("/cmd")) {
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
        try { const h = new URL(origin).hostname; ok = h === "127.0.0.1" || h === "localhost"; } catch { ok = false; }
        if (!ok) { res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "forbidden origin" })); return; }
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}") as CmdBody;
          const msg = await onCmd(parsed);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, msg }));
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
