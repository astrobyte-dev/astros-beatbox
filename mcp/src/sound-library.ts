import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectDocument } from "./project.js";

export type Asset = ProjectDocument["assets"][number];
export interface LibrarySound { key: string; label: string; bank: string; file: string; index: number; library: string }
// Match installed DirtSoundLibrary's supported extensions and lexicographic order.
export function sampleFiles(directory: string, bank: string): string[] {
  if (!/^[a-zA-Z0-9_-]+$/.test(bank)) return [];
  try { return readdirSync(path.join(directory, bank), { withFileTypes: true }).filter(f => f.isFile() && /\.(wav|aif|aiff|aifc)$/i.test(f.name)).map(f => f.name).sort(); } catch { return []; }
}
const names: Record<string, string> = { bd: "Bass drum", sd: "Snare", hh: "Hi-hat", oh: "Open hi-hat", cp: "Clap", 808: "808", 909: "909" };
export function soundLibrary(directory?: string): LibrarySound[] {
  if (!directory) return [];
  try {
    return readdirSync(directory, { withFileTypes: true }).filter(d => d.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(d.name)).sort((a,b) => a.name.localeCompare(b.name)).flatMap(d => sampleFiles(directory, d.name).map((file, index) => ({ key: `${d.name}/${file}`, label: `${names[d.name] ?? d.name.replace(/[_-]/g, " ")} ${index + 1}`, bank: d.name, file, index, library: "Dirt-Samples" })));
  } catch { return []; }
}
const hashes = new Map<string, { stamp: string; hash: string }>();
export function fingerprint(file: string): string {
  const s = statSync(file), stamp = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  if (hashes.get(file)?.stamp === stamp) return hashes.get(file)!.hash;
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (hashes.size > 8192) hashes.clear();
  hashes.set(file, { stamp, hash }); return hash;
}
export function libraryAsset(directory: string | undefined, key: string, id: string): Asset {
  const sound = soundLibrary(directory).find(s => s.key === key);
  if (!sound || !directory) throw new Error("This sound is missing from the library. Refresh sounds.");
  return { id, kind: "sample", name: sound.bank, reference: sound.bank, index: sound.index,
    source: { library: "Dirt-Samples", origin: "bundled", file: sound.key, sha256: fingerprint(path.join(directory, sound.key)) } };
}
export function resolveSample(a: Asset, directory?: string): { status: "available" | "missing" | "unverified"; index: number } {
  if (!directory) return { status: "unverified", index: a.index };
  const files = sampleFiles(directory, a.reference);
  if (!a.source) return { status: a.index < files.length ? "available" : "missing", index: a.index };
  const source = a.source;
  const index = files.findIndex(f => `${a.reference}/${f}` === source.file);
  try {
    if (source.library !== "Dirt-Samples" || index < 0 || fingerprint(path.join(directory, source.file)) !== source.sha256) return { status: "missing", index: a.index };
    return { status: "available", index };
  } catch { return { status: "missing", index: a.index }; }
}
