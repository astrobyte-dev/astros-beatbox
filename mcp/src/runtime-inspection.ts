import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProcessIdentity } from "./owned-process.js";
import { inspectLinux } from "./linux-process.js";
const exec = promisify(execFile);
export interface ProcessRow extends ProcessIdentity { parentPid: number; name: string; path: string | null; startedAt: string }
export interface SocketRow { protocol: "TCP" | "UDP"; port: number; address: string; pid: number }
export interface Inspection { at: number; processes: ProcessRow[]; sockets: SocketRow[]; error: string | null }
export async function inspectPlatform(): Promise<Inspection> {
  return process.platform === "linux" ? inspectLinux() : inspectWindows();
}

export function parseNetstat(text: string): SocketRow[] {
  return text.split(/\r?\n/).flatMap(line => {
    const p = line.trim().split(/\s+/), protocol = p[0];
    if (protocol !== "UDP" && (protocol !== "TCP" || p[3] !== "LISTENING")) return [];
    const match = /^(.*):(\d+)$/.exec(p[1]);
    if (!match) return [];
    return [{ protocol: protocol as "TCP" | "UDP", address: match[1], port: +match[2], pid: +p.at(-1)! }];
  });
}

// Read-only observations never grant a kill capability. Cleanup continues to use
// P0a's native handles, with fresh identity checks at the instant of termination.
export function verifiedTree(rows: ProcessRow[], roots: ProcessIdentity[]): Set<number> {
  const owned = new Set<number>();
  for (const root of roots) if (rows.some(p => p.pid === root.pid && p.started === root.started)) owned.add(root.pid);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) {
      const parent = rows.find(p => p.pid === row.parentPid);
      if (!owned.has(row.pid) && parent && owned.has(parent.pid) && /^\d+$/.test(row.started) && BigInt(row.started) >= BigInt(parent.started)) { owned.add(row.pid); changed = true; }
    }
  }
  return owned;
}
export async function inspectWindows(): Promise<Inspection> {
  if (process.platform !== "win32") return { at: Date.now(), processes: [], sockets: [], error: "OS process and port inspection is available on Windows." };
  try {
    const [processes, ports] = await Promise.all([
      exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
$ErrorActionPreference='Stop'
$result=@(Get-CimInstance Win32_Process | ForEach-Object {
  try {
    $p=[Diagnostics.Process]::GetProcessById($_.ProcessId); $null=$p.Handle
    $start=$p.StartTime.ToUniversalTime()
    if ([Math]::Abs(($start - $_.CreationDate.ToUniversalTime()).TotalMilliseconds) -lt 1) {
      [pscustomobject]@{pid=$p.Id; parentPid=[int]$_.ParentProcessId; name=$_.Name; path=$_.ExecutablePath; started=$start.Ticks.ToString(); startedAt=$start.ToString('o')}
    }
    $p.Dispose()
  } catch { }
})
ConvertTo-Json -InputObject $result -Compress
`], { windowsHide: true, timeout: 12000, maxBuffer: 4 * 1024 * 1024 }),
      exec("netstat.exe", ["-ano"], { windowsHide: true, timeout: 12000, maxBuffer: 4 * 1024 * 1024 }),
    ]);
    return { at: Date.now(), processes: JSON.parse(processes.stdout), sockets: parseNetstat(ports.stdout), error: null };
  } catch (e) { return { at: Date.now(), processes: [], sockets: [], error: "Process/port inspection unavailable: " + (e instanceof Error ? e.message.split("\n")[0] : String(e)) }; }
}
export interface PortStatus extends SocketRow { purpose: string; owner: ProcessRow | null; owned: boolean; state: "owned" | "free" | "conflict" | "unknown"; appearsBeatbox: boolean }
export function portInventory(snapshot: Inspection, owned: Set<number>, required: { port: number; protocol: "TCP" | "UDP"; purpose: string }[]): PortStatus[] {
  const dependencies = [...required];
  for (const s of snapshot.sockets) if (owned.has(s.pid) && !dependencies.some(p => p.port === s.port && p.protocol === s.protocol)) dependencies.push({ ...s, purpose: "Runtime dependency (observed)" });
  return dependencies.flatMap(p => {
    const bindings = snapshot.sockets.filter(s => s.port === p.port && s.protocol === p.protocol);
    return (bindings.length ? bindings : [{ ...p, pid: 0, address: "127.0.0.1" }]).map(s => {
      const owner = snapshot.processes.find(row => row.pid === s.pid) ?? null;
      // Non-loopback bindings are displayed but cannot establish a local conflict.
      const local = ["0.0.0.0", "127.0.0.1", "[::]", "[::1]"].includes(s.address);
      return { ...s, purpose: p.purpose, owner, owned: owned.has(s.pid), state: snapshot.error ? "unknown" as const : !bindings.length ? "free" as const : owned.has(s.pid) ? "owned" as const : local ? "conflict" as const : "unknown" as const, appearsBeatbox: !!owner && /sclang|scsynth|ghci/i.test(owner.name) };
    });
  });
}

export class RuntimeInspection {
  snapshot: Inspection = { at: 0, processes: [], sockets: [], error: "Inspection pending" };
  private pending: Promise<Inspection> | null = null;
  async refresh(force = false): Promise<Inspection> {
    if (!force && Date.now() - this.snapshot.at < 3000) return this.snapshot;
    return this.pending ??= inspectPlatform().then(s => this.snapshot = s).finally(() => { this.pending = null; });
  }
}
