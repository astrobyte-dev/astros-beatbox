import { z } from "zod";
import { editSchema, type ProjectEdit, type ProjectDocument } from "./project.js";

const meta = {
  operationId: z.string().min(1).max(100).optional(),
  sessionId: z.string().min(1).max(100).optional(),
  issuedAt: z.number().finite().optional(),
  projectId: z.string().min(1).max(100).optional(),
  revision: z.number().int().nonnegative().safe().optional(),
  groupId: z.string().min(1).max(100).optional(),
};
const slot = z.string().regex(/^d(?:[1-9]|1[0-6])$/);
const code = z.string().trim().min(1).max(65536);
const bare = (cmd: string) => z.object({ ...meta, cmd: z.literal(cmd) }).strict();
const layer = (cmd: string) => z.object({ ...meta, cmd: z.literal(cmd), slot }).strict();
export const commandSchema = z.union([
  bare("boot"),
  z.object({ ...meta, cmd: z.literal("project.edit"), projectId: z.string(), revision: z.number().int().nonnegative(), edits: z.array(editSchema).min(1).max(512), label: z.string().min(1).max(120) }).strict(),
  ...["project.undo", "project.redo", "project.new", "project.recover", "song.start", "song.stop"].map(cmd => z.object({ ...meta, cmd: z.literal(cmd), projectId: z.string(), revision: z.number().int().nonnegative() }).strict()),
  ...["project.save", "project.load"].map(cmd => z.object({ ...meta, cmd: z.literal(cmd), projectId: z.string(), revision: z.number().int().nonnegative(), value: z.string().regex(/^[a-z0-9_-]{1,80}$/i) }).strict()),
  bare("stop"),
  ...["pause", "resume", "unsolo", "record", "reset", "hush"].map(bare),
  ...["mute", "unmute", "solo", "silence"].map(layer),
  z.object({ ...meta, cmd: z.literal("tempo"), value: z.number().finite().positive().max(1000) }).strict(),
  z.object({ ...meta, cmd: z.literal("eval"), value: code }).strict(),
  z.object({ ...meta, cmd: z.literal("eval_sc"), value: code }).strict(),
  z.object({ ...meta, cmd: z.literal("set"), slot, param: z.enum(["gain", "cutoff", "shape", "room", "pan", "delay"]), value: z.number().finite() }).strict(),
  z.object({ ...meta, cmd: z.literal("save"), value: z.string().trim().min(1).max(120) }).strict(),
  z.object({ ...meta, cmd: z.literal("load"), value: z.string().regex(/^[a-z0-9_-]{1,40}$/i) }).strict(),
  z.object({ ...meta, cmd: z.literal("setdevice"), value: z.string().max(512).refine((s) => !/[\r\n\0]/.test(s)) }).strict(),
]);
// A compact wire type; runtime validation above narrows each command's fields.
export interface Command { cmd: string; slot?: string; param?: string; value?: string | number; operationId?: string; sessionId?: string; issuedAt?: number; projectId?: string; revision?: number; groupId?: string; edits?: ProjectEdit[]; label?: string }
export type CommandResult = {
  operationId: string; sessionId: string; generation: number;
  projectId?: string; revision?: number; project?: ProjectDocument; history?: { undo: number; redo: number };
} & ({ ok: true; msg: string; output?: string; acknowledgement?: "action" | "completion" } | { ok: false; error: string; code: string });

export function validateCommand(input: unknown): Command {
  const result = commandSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid command, fields, or values.");
  const c = result.data as Command;
  if (c.operationId && (!c.sessionId || c.issuedAt === undefined)) throw new Error("Retriable requests require sessionId and issuedAt.");
  if ((c.projectId === undefined) !== (c.revision === undefined)) throw new Error("Project identity and revision are required together.");
  if (c.cmd === "set") {
    const ranges: Record<string, [number, number]> = { gain: [0, 2], cutoff: [0, 24000], shape: [0, 1], room: [0, 1], pan: [0, 1], delay: [0, 1] };
    const [lo, hi] = ranges[c.param!];
    if (Number(c.value) < lo || Number(c.value) > hi) throw new Error(`Value outside ${c.param} range ${lo}..${hi}.`);
  }
  return c;
}

// Adapters require explicit optimistic concurrency for every external operation
// that can target music. Runtime-only Stop/record/reset keep the P0a wire contract.
export function requiresProjectRevision(cmd: string): boolean {
  return ["eval", "eval_sc", "hush", "silence", "tempo", "set", "mute", "unmute", "solo", "unsolo", "load", "save", "resume"].includes(cmd) || cmd.startsWith("project.") || cmd.startsWith("song.");
}
