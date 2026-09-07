import { clone, type ProjectDocument } from "./project.js";

export type Boundary = "immediate" | "cycle";
export interface PerformanceState {
  mode: "manual" | "scene" | "arrangement";
  sceneId: string | null;
  queuedSceneId: string | null;
  startCycle: number | null;
  cycle: number | null;
  entryId: string | null;
  repeat: number | null;
  ended: boolean;
  clock: "waiting" | "observed" | "unavailable";
}
export const emptyPerformance = (): PerformanceState => ({ mode: "manual", sceneId: null, queuedSceneId: null, startCycle: null, cycle: null, entryId: null, repeat: null, ended: false, clock: "waiting" });
export function nextBoundary(now: number, boundary: Boundary): number {
  if (!Number.isFinite(now)) throw new Error("Musical clock is unavailable");
  return boundary === "cycle" ? Math.floor(now) + 1 : now;
}
export function sceneProjection(p: ProjectDocument, sceneId: string): ProjectDocument {
  const next = clone(p), scene = next.scenes.find(s => s.id === sceneId);
  if (!scene) throw new Error("Unknown scene");
  for (const track of next.tracks) track.activeClipId = scene.clips[track.id] ?? null;
  return next;
}
// Pure observation only. Arrangement advancement is compiled into Tidal, including
// silence and finite endings. No observer, HTTP client or Node timer sends launches.
export function arrangementPosition(p: ProjectDocument, start: number, cycle: number) {
  const total = p.arrangement.reduce((n, e) => n + e.cycles, 0);
  if (!total || cycle < start) return { sceneId: null, entryId: null, repeat: null, ended: false };
  if (p.arrangementLoop === false && cycle - start >= total) return { sceneId: null, entryId: null, repeat: null, ended: true };
  let offset = (cycle - start) % total;
  for (const e of p.arrangement) {
    if (offset < e.cycles) return { sceneId: e.sceneId, entryId: e.id, repeat: Math.floor(offset) + 1, ended: false };
    offset -= e.cycles;
  }
  throw new Error("Invalid arrangement position");
}
export function preparedBatch(slots: Record<string, string>, boundary: Boundary, arrangement?: { cycles: number; loop: boolean; origin?: number }): string {
  // Every owned d-slot is replaced together. Routes and opaque source stay in the
  // compiler's expression. Haskell reads the clock only after preparation succeeds.
  const rows = Array.from({ length: 16 }, (_, i) => {
    let body = slots["d" + (i + 1)] ?? "silence";
    if (arrangement) {
      const start = arrangement.origin === undefined ? "abxStart" : `(${arrangement.origin})`;
      body = `rotR ${start} (${body})`;
      if (!arrangement.loop) body = `filterWhen (< (${start} + ${arrangement.cycles})) (${body})`;
    }
    return `("${i + 1}", (${body}\n))`;
  });
  return `do\n  abxInstall ${boundary === "cycle" ? "True" : "False"} (\\abxStart -> [${rows.join(",\n    ")}])`;
}
export function preparedCode(source: string): string {
  return `do\n  abxPrepare (${source}\n)`;
}
export function parseCycle(output: string, marker: "ABX_SCHEDULED" | "ABX_CLOCK"): number {
  const match = output.match(new RegExp("(?:^|\\n)" + marker + " ([0-9.eE+\\-]+)(?:\\r?\\n|$)"));
  const value = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(value)) throw new Error("Tidal did not confirm its musical clock");
  return value;
}
