import { z } from "zod";

export const AUDIO_LIMIT = 256 * 1024 * 1024;
export const LIBRARY_LIMIT = 4096;
export const samplePlaybackSchema = z.object({
  start: z.number().finite().min(0).max(0.9999), end: z.number().finite().min(0.0001).max(1),
  reverse: z.boolean(), pitch: z.number().finite().min(-24).max(24),
  attack: z.number().finite().min(0.001).max(2), release: z.number().finite().min(0.001).max(5),
  mode: z.enum(["one-shot", "loop"]), beats: z.number().int().min(1).max(64),
}).strict().refine(v => v.end - v.start >= 0.0001, "End must follow start");
export type SamplePlayback = z.infer<typeof samplePlaybackSchema>;
export const defaultPlayback = (): SamplePlayback => ({ start: 0, end: 1, reverse: false, pitch: 0, attack: 0.003, release: 0.02, mode: "one-shot", beats: 4 });
export const sliceSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: z.string().max(80), start: z.number().finite().min(0).max(1), end: z.number().finite().min(0).max(1) }).strict().refine(s => s.end - s.start >= 0.0001, "Slice must have a positive region");
export const audioMetadataSchema = z.object({
  originalName: z.string().min(1).max(255), duration: z.number().finite().positive().max(900),
  channels: z.union([z.literal(1), z.literal(2)]), sampleRate: z.number().int().min(8000).max(192000),
  frames: z.number().int().positive(), bytes: z.number().int().positive().max(AUDIO_LIMIT),
  createdAt: z.string().datetime(),
}).strict();
export const libraryDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120), favorite: z.boolean(),
  tags: z.array(z.string().trim().min(1).max(40)).max(16), collection: z.string().trim().max(80),
  classification: z.enum(["one-shot", "loop"]), bpm: z.number().finite().min(20).max(400).nullable(),
}).strict();
export type LibraryDetails = z.infer<typeof libraryDetailsSchema>;
