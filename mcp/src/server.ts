import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Engine } from "./engine.js";
import { Meter } from "./meter.js";
import { startDashboard } from "./dashboard.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { DASHBOARD_PORT, METER_UDP_PORT, DASHBOARD_HTML, SETS_DIR, RECORDINGS_DIR, AUDIO_DEVICE_FILE, DEFAULT_AUDIO_DEVICE } from "./config.js";
import { track, applyParam, scStr } from "./track.js";

// Single-instance guard: if a stale server still holds the dashboard port (e.g. a
// previous reconnect that didn't exit), kill it so this newest instance wins —
// avoids two engines fighting over the audio device + port.
function takePort(port: number): void {
  try {
    const out = execSync("netstat -ano -p TCP", { encoding: "utf8", windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 5 && /LISTENING/i.test(cols[3]) && cols[1].endsWith(`:${port}`)) {
        const pid = parseInt(cols[4], 10);
        if (pid && pid !== process.pid) { try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch { /* already gone */ } }
      }
    }
  } catch { /* netstat unavailable; startDashboard's EADDRINUSE handler still applies */ }
}

const engine = new Engine();
const meter = new Meter();

// Live rig state surfaced to the dashboard.
const rig: {
  slots: Record<string, string>;
  tempoBpm: number;
  muted: Set<string>;
  solo: string | null;
  paused: boolean;
  recording: boolean;
  recPath: string;
} = { slots: {}, tempoBpm: 0, muted: new Set(), solo: null, paused: false, recording: false, recPath: "" };

const server = new McpServer({ name: "tidal-livecoder", version: "0.2.0" });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

async function ready(): Promise<string | null> {
  try {
    await engine.ensureBooted();
    return null;
  } catch (e) {
    return `Engine not ready: ${String(e)}\n--- sclang tail ---\n${engine.sclang.tail()}\n--- tidal tail ---\n${engine.tidal.tail()}`;
  }
}

server.tool(
  "boot",
  `Boot (or confirm) the SuperDirt + TidalCycles engines. First boot ~30-40s. Dashboard: http://127.0.0.1:${DASHBOARD_PORT}`,
  async () => text((await ready()) ?? `Engines ready. d1-d16 available. Dashboard: http://127.0.0.1:${DASHBOARD_PORT}`),
);

server.tool(
  "eval_tidal",
  'Evaluate TidalCycles code. d1..d16 are pattern slots, e.g. d1 $ sound "bd*4" # gain 1.1. setcps N sets tempo (cps; bpm = cps*60*4). Multi-line/do-blocks OK.',
  { code: z.string().describe("TidalCycles code to evaluate") },
  async ({ code }) => {
    const err = await ready();
    if (err) return text(err);
    engine.tidal.eval(code);
    track(rig, code);
    await new Promise((r) => setTimeout(r, 350));
    const out = engine.tidal.tail(1200);
    const bad = /error:|not in scope|parse error|lexical error/i.test(out);
    return text((bad ? "Tidal reported an issue:\n" : "Evaluated.\n") + out);
  },
);

server.tool("hush", "Silence all Tidal pattern slots immediately.", async () => {
  const err = await ready();
  if (err) return text(err);
  engine.tidal.hush();
  rig.slots = {}; rig.muted.clear(); rig.solo = null; rig.paused = false;
  return text("hush - all patterns silenced.");
});

server.tool(
  "eval_sc",
  "Evaluate raw SuperCollider code in the SuperDirt interpreter (e.g. define custom SynthDefs for bass design, or inspect state).",
  { code: z.string().describe("SuperCollider code") },
  async ({ code }) => {
    const err = await ready();
    if (err) return text(err);
    engine.sclang.eval(code);
    await new Promise((r) => setTimeout(r, 350));
    return text("Sent to SuperCollider.\n" + engine.sclang.tail(1000));
  },
);

server.tool(
  "status",
  `Report engine state, tempo, active slots, and the dashboard URL (http://127.0.0.1:${DASHBOARD_PORT}).`,
  async () =>
    text(
      `state: ${engine.state}` +
        (engine.error ? `\nerror: ${engine.error}` : "") +
        `\ntempo: ${rig.tempoBpm || "?"} BPM` +
        `\nactive slots: ${Object.keys(rig.slots).join(", ") || "(none)"}` +
        `\ndashboard: http://127.0.0.1:${DASHBOARD_PORT}`,
    ),
);

// Dashboard control commands. body = { cmd, slot?, param?, value? }; slot like "d3".
type CmdBody = { cmd: string; slot?: string; param?: string; value?: number | string };
async function handleCmd(body: CmdBody): Promise<string> {
  const { cmd: c, slot, param } = body;
  const n = slot ? parseInt(slot.replace(/\D/g, ""), 10) : null;
  // The dashboard can boot the engine on demand: nearly every command needs a
  // live engine, so boot here instead of bailing with "engine not ready".
  // (save = writes files from in-memory state; reset = reboots regardless.)
  if (c !== "save" && c !== "reset" && c !== "setdevice") {
    try { await engine.ensureBooted(); }
    catch (e) { return "engine failed to boot: " + String(e); }
  }
  switch (c) {
    case "boot":
      return "engine ready";
    case "setdevice": {
      // switch audio output: persist the choice, reboot SC (required to change
      // device), then replay the current slots so the beat resumes on the new device.
      const name = String(body.value ?? "").trim();
      try { writeFileSync(AUDIO_DEVICE_FILE, name, "utf8"); }
      catch (e) { return "couldn't save device: " + String(e); }
      engine.currentDevice = name === "SYSTEM" ? "System default" : (name || DEFAULT_AUDIO_DEVICE);
      const saved: Record<string, string> = { ...rig.slots };
      const bpm = rig.tempoBpm;
      (async () => {
        await engine.reboot();
        if (bpm) engine.tidal.eval(`setcps (${bpm}/60/4)`);
        for (const k of Object.keys(saved)) engine.tidal.eval(`${k} $ ${saved[k]}`);
      })().catch(() => { /* surfaced via status */ });
      return "switching audio → " + (name === "SYSTEM" || !name ? "system default" : name) + " (reboot ~30s; your beat resumes)";
    }
    case "stop":
      engine.tidal.hush();
      rig.slots = {}; rig.muted.clear(); rig.solo = null; rig.paused = false;
      return "stopped";
    case "pause": {
      const nums = Object.keys(rig.slots).map((k) => parseInt(k.slice(1), 10));
      if (nums.length) engine.tidal.eval(`mapM_ mute [${nums.join(",")}]`);
      rig.paused = true;
      return "paused";
    }
    case "resume":
      engine.tidal.eval("unmuteAll");
      rig.paused = false; rig.muted.clear();
      return "resumed";
    case "mute":
      if (n) { engine.tidal.eval(`mute ${n}`); rig.muted.add(slot!); }
      return "muted " + slot;
    case "unmute":
      if (n) { engine.tidal.eval(`unmute ${n}`); rig.muted.delete(slot!); }
      return "unmuted " + slot;
    case "solo":
      if (n) { engine.tidal.eval(`solo ${n}`); rig.solo = slot!; }
      return "solo " + slot;
    case "unsolo":
      engine.tidal.eval("unsoloAll");
      rig.solo = null;
      return "unsolo";
    case "silence":
      if (n) {
        engine.tidal.eval(`d${n} silence`);
        delete rig.slots[slot!]; rig.muted.delete(slot!);
        if (rig.solo === slot) rig.solo = null;
      }
      return "silenced " + slot;
    case "tempo": {
      const bpm = Number(body.value);
      if (bpm > 0) { engine.tidal.eval(`setcps (${bpm / 240})`); rig.tempoBpm = Math.round(bpm); }
      return "tempo " + bpm;
    }
    case "eval": {
      // free-typed Tidal from the dashboard console
      const code = String(body.value ?? "").trim();
      if (!code) return "(empty)";
      if (/^hush\b/i.test(code)) {
        engine.tidal.hush();
        rig.slots = {}; rig.muted.clear(); rig.solo = null; rig.paused = false;
        return "hush - silenced.";
      }
      engine.tidal.eval(code);
      track(rig, code);
      await new Promise((r) => setTimeout(r, 320));
      const out = engine.tidal.tail(900);
      const bad = /error:|not in scope|parse error|lexical error/i.test(out);
      return bad ? "error: " + out.replace(/\s+/g, " ").slice(-280) : "ok";
    }
    case "set": {
      // live knob: replace/add `# param value` in the slot's code and re-eval it
      if (!slot || !param || !n) return "bad set";
      const code = rig.slots[slot];
      if (!code) return "no slot " + slot;
      const num = Number(body.value);
      rig.slots[slot] = applyParam(code, param, num);
      engine.tidal.eval(`d${n} $ ${rig.slots[slot]}`);
      return `set ${slot} ${param}=${num}`;
    }
    case "save": {
      const name = (String(body.value ?? "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40)) || "set";
      const ordered = Object.keys(rig.slots).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
      const lines = [`setcps (${rig.tempoBpm || 120}/60/4)`, ...ordered.map((k) => `${k} $ ${rig.slots[k]}`)];
      try { mkdirSync(SETS_DIR, { recursive: true }); writeFileSync(path.join(SETS_DIR, `${name}.tidal`), lines.join("\n") + "\n", "utf8"); }
      catch (e) { return "save failed: " + String(e); }
      return "saved set: " + name;
    }
    case "load": {
      const name = String(body.value ?? "").replace(/[^a-z0-9_-]/gi, "_");
      const file = path.join(SETS_DIR, `${name}.tidal`);
      if (!existsSync(file)) return "no set named " + name;
      engine.tidal.hush();
      rig.slots = {}; rig.muted.clear(); rig.solo = null; rig.paused = false;
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("--")) continue;
        engine.tidal.eval(t);
        track(rig, t);
      }
      return "loaded set: " + name;
    }
    case "record": {
      if (!rig.recording) {
        const fname = "jam-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".wav";
        rig.recPath = path.join(RECORDINGS_DIR, fname).replace(/\\/g, "/");
        try { mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch { /* ignore */ }
        engine.sclang.eval(
          `( Routine({ SynthDef(\\diskrec, { |buf| DiskOut.ar(buf, In.ar(0,2)) }).add; ~recBuf = Buffer.alloc(s, 65536, 2); s.sync; ~recBuf.write("${scStr(rig.recPath)}", "wav", "int16", 0, 0, true); s.sync; ~recSynth = Synth.tail(RootNode(s), \\diskrec, [\\buf, ~recBuf.bufnum]); }).play(SystemClock); )`,
        );
        rig.recording = true;
        return "recording → " + fname;
      }
      engine.sclang.eval(`( ~recSynth.free; ~recBuf.close; ~recBuf.free; )`);
      rig.recording = false;
      return "saved recording: " + rig.recPath;
    }
    case "reset": {
      rig.slots = {}; rig.muted.clear(); rig.solo = null; rig.paused = false;
      rig.recording = false;
      engine.reboot().catch(() => { /* surfaced via status */ });
      return "rebooting engine…";
    }
    default:
      return "unknown cmd: " + c;
  }
}

// --- dashboard + meter (independent of the MCP stdio transport) ---
takePort(DASHBOARD_PORT); // newest instance wins: clear any stale server on the port
meter.start(METER_UDP_PORT);
startDashboard(
  DASHBOARD_PORT,
  DASHBOARD_HTML,
  () => {
    // map each active slot dN to its default orbit (N-1) and surface last-hit time
    const hits: Record<string, number> = {};
    for (const k of Object.keys(rig.slots)) {
      const t = meter.hits[parseInt(k.slice(1), 10) - 1];
      if (t) hits[k] = t;
    }
    return {
      status: engine.state,
      tempoBpm: rig.tempoBpm,
      meterL: meter.l,
      meterR: meter.r,
      meterAge: meter.lastUpdate,
      slots: rig.slots,
      muted: [...rig.muted],
      solo: rig.solo,
      paused: rig.paused,
      hits,
      spectrum: meter.spectrum,
      recording: rig.recording,
      devices: engine.devices,
      device: engine.currentDevice,
    };
  },
  handleCmd,
);

// Clean up engines (incl. detached scsynth) when the MCP server is stopped.
let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  try { meter.stop(); } catch { /* ignore */ }
  try { engine.stop(); } catch { /* ignore */ }
}
process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
process.on("exit", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);

// Lazy boot: engines start on the first tool call. Call `boot` to pre-warm.
