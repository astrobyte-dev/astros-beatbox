import { z } from "zod";

const context = z.object({
  at: z.number(), generation: z.number(), engineState: z.string(), projectId: z.string(), revision: z.number(),
  appliedRevision: z.number().nullable(), appliedGeneration: z.number().nullable(), appliedProjectId: z.string().nullable(),
  synchronized: z.boolean(), stopped: z.boolean(), paused: z.boolean(), song: z.boolean(), preview: z.string(), bpm: z.number(), beatsPerCycle: z.number(),
  mixer: z.array(z.object({ slot: z.number(), channel: z.number().nullable(), active: z.boolean(), level: z.number(), balance: z.number(), mute: z.boolean(), solo: z.boolean() })),
});
export const recordingDiagnosticsSchema = z.object({
  sessionId: z.string(), operationId: z.string(), start: context, finish: context.optional(), startedAt: z.number().optional(),
  route: z.object({ bus: z.number(), tap: z.number(), previewGroup: z.number(), recorder: z.number(), events: z.number().optional() }).optional(),
  // Cumulative audio-rate peak at the exact DiskOut input, independent of WAV parsing.
  input: z.object({ peak: z.number().nonnegative(), seconds: z.number().nonnegative(), events: z.number().optional() }).optional(),
  probe: z.enum(["pending", "captured", "unavailable"]),
  commands: z.array(z.object({ at: z.number(), command: z.string(), generation: z.number(), revision: z.number(), phase: z.enum(["begin", "complete", "failed"]) })).max(32),
});
export type RecordingDiagnostics = z.infer<typeof recordingDiagnosticsSchema>;

export function captureRoute(output: string, takeId: string) {
  const line = output.split(/\r?\n/).find(l => l.startsWith(`ABX_ROUTE ${takeId} `));
  const m = /^ABX_ROUTE (\d+) (\d+) (\d+) (\d+)(?: (\d+))?\s*$/.exec(line?.replace(`ABX_ROUTE ${takeId} `, "ABX_ROUTE ") ?? "");
  return m ? { bus: +m[1], tap: +m[2], previewGroup: +m[3], recorder: +m[4], ...(m[5] ? { events: +m[5] } : {}) } : undefined;
}
export function captureInput(output: string, takeId: string) {
  const line = output.split(/\r?\n/).find(l => l.startsWith(`ABX_CAPTURE ${takeId} `));
  const m = /^ABX_CAPTURE ([\d.eE+-]+) ([\d.eE+-]+)(?: (\d+))?\s*$/.exec(line?.replace(`ABX_CAPTURE ${takeId} `, "ABX_CAPTURE ") ?? "");
  return m && [+m[1], +m[2]].every(n => Number.isFinite(n) && n >= 0) ? { peak: +m[1], seconds: +m[2], ...(m[3] ? { events: +m[3] } : {}) } : undefined;
}
export function recordingWarning(peak: number, diagnostics?: RecordingDiagnostics): string | undefined {
  if (peak !== 0) return;
  if ((diagnostics?.input?.peak ?? 0) > 1 / 32768) return "This WAV contains silence although audio reached the recorder. Keep this take for investigation; its diagnostic sidecar is saved.";
  const c = diagnostics?.start;
  if (c && !c.stopped && !c.paused && c.mixer.some(t => t.active && t.level > 0 && !t.mute && (!c.mixer.some(t => t.solo) || t.solo)))
    return "No audio was captured while playback was active. If you expected music, check this take. The silent WAV is kept.";
  return "This take contains silence. The WAV is kept and can be played or downloaded.";
}

// Diagnostic controls never write audio or move/free project/Preview nodes.
// Freeze the cumulative probe by stopping the writer first; read it only after
// finalization. A timed-out bus stays reserved until its own reply (or reset),
// so delayed replies cannot read a newer take through a reused control bus.
// A missing diagnostic reply must not prevent saving a valid take.
export const finishRecorder = (takeId: string) => `~recSynth.free; s.sync; ~recBuf.close; s.sync; ~recBuf.free; s.sync; if(~recStats.notNil) { var done = Condition.new, stats = ~recStats; stats.getn(2, { |v| ("\\n" ++ "ABX_CAP" ++ "TURE ${takeId} " ++ v[0] ++ " " ++ v[1] ++ " " ++ (~abxEventCount ? 0)).postln; stats.free; done.test = true; done.signal }); SystemClock.sched(1, { done.test = true; done.signal; nil }); done.wait; ~recStats = nil; };`;
