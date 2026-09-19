import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import type { ProcessIdentity } from "./owned-process.js";
import type { Inspection, ProcessRow, SocketRow } from "./runtime-inspection.js";

export interface LinuxStat extends ProcessIdentity { parentPid: number; group: number; session: number; name: string; state: string }
export function parseProcStat(text: string): LinuxStat {
  const end = text.lastIndexOf(")"), begin = text.indexOf("(");
  const fields = text.slice(end + 2).trim().split(/\s+/);
  const pid = Number(text.slice(0, begin).trim());
  if (begin < 1 || end < begin || !Number.isSafeInteger(pid) || pid <= 0 || fields.length < 20 || !/^\d+$/.test(fields[19])) throw new Error("Invalid /proc stat");
  const numbers = fields.slice(1, 4).map(Number);
  if (numbers.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid /proc ancestry");
  return { pid, name: text.slice(begin + 1, end), state: fields[0], parentPid: numbers[0], group: numbers[1], session: numbers[2], started: fields[19] };
}
export function readLinuxIdentity(pid: number): LinuxStat { return parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8")); }
export function linuxProcesses(): LinuxStat[] {
  return readdirSync("/proc").filter(p => /^\d+$/.test(p)).flatMap(p => {
    try { return [readLinuxIdentity(+p)]; } catch (e) {
      if (["ENOENT", "ESRCH"].includes((e as NodeJS.ErrnoException).code ?? "")) return [];
      throw e;
    }
  });
}
function address(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  for (let i = 0; i < bytes.length; i += 4) bytes.subarray(i, i + 4).reverse();
  if (bytes.length === 4) return [...bytes].join(".");
  const groups = Array.from({ length: 8 }, (_, i) => bytes.readUInt16BE(i * 2).toString(16));
  if (groups.every(g => g === "0")) return "[::]";
  if (groups.slice(0, 7).every(g => g === "0") && groups[7] === "1") return "[::1]";
  if (groups.slice(0, 5).every(g => g === "0") && groups[5] === "ffff") return [...bytes.subarray(12)].join(".");
  return "[" + groups.join(":") + "]";
}
export function parseProcSockets(text: string, protocol: "TCP" | "UDP"): (SocketRow & { inode: string })[] {
  return text.trim().split("\n").slice(1).flatMap(line => {
    const f = line.trim().split(/\s+/), local = f[1]?.split(":");
    if (!local || local.length !== 2 || !/^(?:[a-f\d]{8}|[a-f\d]{32})$/i.test(local[0]) || !/^[a-f\d]{4}$/i.test(local[1]) || !/^\d+$/.test(f[9] ?? "")) return [];
    if (protocol === "TCP" && f[3] !== "0A") return [];
    const port = parseInt(local[1], 16);
    return port ? [{ protocol, port, address: address(local[0]), pid: 0, inode: f[9] }] : [];
  });
}
export function inspectLinux(): Inspection {
  try {
    const rows = linuxProcesses(), owners = new Map<string, number[]>();
    const processes: ProcessRow[] = rows.map(p => {
      let exe: string | null = null;
      try { exe = readlinkSync(`/proc/${p.pid}/exe`); } catch { /* Permission/exit: unknown path. */ }
      try {
        for (const fd of readdirSync(`/proc/${p.pid}/fd`)) {
          try { const inode = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${p.pid}/fd/${fd}`))?.[1]; if (inode) owners.set(inode, [...new Set([...(owners.get(inode) ?? []), p.pid])]); } catch { /* Descriptor closed. */ }
        }
        // Discard descriptor ownership if the process changed during inspection.
      } catch { /* Restricted descriptors do not mean a socket is free. */ }
      let unchanged = false;
      try { unchanged = readLinuxIdentity(p.pid).started === p.started; } catch { /* Exited. */ }
      if (!unchanged) for (const [inode, pids] of owners) owners.set(inode, pids.filter(pid => pid !== p.pid));
      return { ...p, path: exe, startedAt: "" }; // Kernel ticks are identity, not a fabricated wall-clock date.
    });
    const sockets = (["tcp", "tcp6", "udp", "udp6"] as const).flatMap(name => {
      let content: string;
      try { content = readFileSync(`/proc/net/${name}`, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" && name.endsWith("6")) return []; throw e; }
      return parseProcSockets(content, name.startsWith("tcp") ? "TCP" : "UDP").flatMap(s => (owners.get(s.inode)?.length ? owners.get(s.inode)! : [0]).map(pid => ({ ...s, pid })));
    });
    return { at: Date.now(), processes, sockets, error: null };
  } catch (e) { return { at: Date.now(), processes: [], sockets: [], error: "Linux inspection unavailable: " + String(e) }; }
}
