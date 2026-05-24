import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { SETS_DIR, DIRT_SAMPLES_DIR } from "./config.js";

type CmdBody = { cmd: string; slot?: string; param?: string; value?: number | string };
type CmdHandler = (body: CmdBody) => Promise<string> | string;

// Local dashboard: serves the HTML (read fresh per request so UI edits don't need
// an MCP reload), exposes /state (JSON) and /cmd (POST control commands).
export function startDashboard(
  port: number,
  htmlPath: string,
  getState: () => unknown,
  onCmd: CmdHandler,
): http.Server {
  const server = http.createServer((req, res) => {
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
    if (req.method === "POST" && req.url && req.url.startsWith("/cmd")) {
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
  server.on("error", () => { /* port busy etc. */ });
  server.listen(port, "127.0.0.1");
  return server;
}
