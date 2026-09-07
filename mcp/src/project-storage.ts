import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { validateProject, type ProjectDocument } from "./project.js";

export type WriteStage = "written" | "synced" | "renaming";
export function atomicWrite(file: string, data: string, fault?: (stage: WriteStage) => void): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "wx"); writeFileSync(fd, data, "utf8"); fault?.("written");
    fsyncSync(fd); fault?.("synced"); closeSync(fd); fd = undefined;
    fault?.("renaming"); renameSync(tmp, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}
const hash = (p: ProjectDocument) => createHash("sha256").update(JSON.stringify(p)).digest("hex");
export function encodeProject(p: ProjectDocument, sequence = 0): string {
  p = validateProject(p);
  return JSON.stringify({ format: "astros-beatbox-project", version: 1, sequence, sha256: hash(p), document: p }, null, 2) + "\n";
}
export function decodeProject(text: string): { document: ProjectDocument; sequence: number } {
  if (text.length > 8 * 1024 * 1024) throw new Error("Project file too large");
  const v = JSON.parse(text);
  if (v.format !== "astros-beatbox-project" || v.version !== 1 || !Number.isSafeInteger(v.sequence) || v.sequence < 0) throw new Error("Unsupported project format/version");
  const document = validateProject(v.document);
  if (v.sha256 !== hash(document)) throw new Error("Project checksum mismatch");
  return { document, sequence: v.sequence };
}
function read(file: string): ReturnType<typeof decodeProject> {
  if (statSync(file).size > 8 * 1024 * 1024) throw new Error("Project file too large");
  return decodeProject(readFileSync(file, "utf8"));
}
export class ProjectStorage {
  sequence = 0;
  recoveryWarning: string | null = null;
  constructor(readonly directory: string, readonly recoveryDirectory: string, private fault?: (stage: WriteStage) => void) {}
  private file(name: string) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(name)) throw new Error("Project name must use letters, numbers, underscore or hyphen");
    const collision = this.list().find(existing => existing.toLowerCase() === name.toLowerCase() && existing !== name);
    if (collision) throw new Error(`Use the existing project spelling '${collision}' to keep filenames portable across Windows and Linux`);
    return path.join(this.directory, name + ".abx.json");
  }
  list(): string[] { return existsSync(this.directory) ? readdirSync(this.directory).filter(f => f.endsWith(".abx.json")).map(f => f.slice(0, -9)).sort() : []; }
  save(name: string, p: ProjectDocument): void { atomicWrite(this.file(name), encodeProject(p), this.fault); }
  load(name: string): ProjectDocument { return read(this.file(name)).document; }
  // Two alternating checksummed checkpoints: no arbitrary execution log. A failed
  // write never replaces the previous acknowledged checkpoint. Orphan temps are ignored.
  checkpoint(p: ProjectDocument): void {
    const next = this.sequence + 1;
    atomicWrite(path.join(this.recoveryDirectory, `checkpoint-${next % 2}.json`), encodeProject(p, next), this.fault);
    this.sequence = next;
  }
  recover(): ProjectDocument | null {
    const candidates: ReturnType<typeof decodeProject>[] = [];
    for (const i of [0, 1]) {
      const file = path.join(this.recoveryDirectory, `checkpoint-${i}.json`);
      if (existsSync(file)) try { candidates.push(read(file)); } catch (e) { this.recoveryWarning = "Invalid recovery checkpoint retained: " + String(e); }
    }
    candidates.sort((a, b) => b.sequence - a.sequence);
    this.sequence = candidates[0]?.sequence ?? 0;
    return candidates[0]?.document ?? null;
  }
}
