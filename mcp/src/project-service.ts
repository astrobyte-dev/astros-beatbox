import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { applyEdits, clone, emptyProject, validateProject, type ProjectDocument } from "./project.js";
import { ProjectStorage } from "./project-storage.js";

export class ProjectConflict extends Error { readonly code = "STALE_PROJECT"; }
type HistoryEntry = { before: ProjectDocument; after: ProjectDocument; label: string; group?: string; at: number };
export class ProjectService {
  private current: ProjectDocument;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  readonly workspace = { selectedSceneId: null as string | null, recovered: false, recoveryWarning: null as string | null };
  constructor(readonly storage?: ProjectStorage) {
    const recovered = storage?.recover();
    this.current = recovered ?? emptyProject();
    this.workspace.recovered = !!recovered;
    this.workspace.recoveryWarning = storage?.recoveryWarning ?? null;
    this.syncSelection();
  }
  private syncSelection(): void {
    const matches = this.current.scenes.filter(s => this.current.tracks.every(t => (s.clips[t.id] ?? null) === t.activeClipId));
    this.workspace.selectedSceneId = matches.find(s => s.id === this.workspace.selectedSceneId)?.id ?? matches[0]?.id ?? null;
  }
  get document(): ProjectDocument { return clone(this.current); }
  get history() { return { undo: this.past.length, redo: this.future.length, undoLabel: this.past.at(-1)?.label, redoLabel: this.future.at(-1)?.label }; }
  assert(id: string, revision: number): void {
    if (id !== this.current.id || revision !== this.current.revision) throw new ProjectConflict("Project changed; refresh and review the edit before submitting again.");
  }
  prepare(edits: unknown): ProjectDocument { return applyEdits(this.current, edits); }
  commit(next: ProjectDocument, label: string, group?: string): boolean {
    next = validateProject(next);
    const before = this.current;
    if (next.id !== before.id) throw new Error("Use project switching to change identity");
    next.revision = before.revision;
    if (JSON.stringify(next) === JSON.stringify(before)) return false;
    next.revision++;
    this.storage?.checkpoint(next); // durability is part of acknowledgement
    const last = this.past.at(-1), now = Date.now();
    if (group && last?.group === group && !this.future.length && now - last.at < 30000) { last.after = clone(next); last.at = now; }
    else this.past.push({ before: clone(before), after: clone(next), label, group, at: now });
    this.future = [];
    while (this.past.length > 64 || this.past.length > 1 && JSON.stringify(this.past).length > 16 * 1024 * 1024) this.past.shift();
    this.current = next;
    this.syncSelection();
    return true;
  }
  historyTarget(redo: boolean): ProjectDocument {
    const e = (redo ? this.future : this.past).at(-1);
    if (!e) throw new Error(redo ? "Nothing to redo" : "Nothing to undo");
    const next = clone(redo ? e.after : e.before); next.revision = this.current.revision + 1; return next;
  }
  acceptHistory(redo: boolean, next: ProjectDocument): void {
    this.storage?.checkpoint(next);
    const from = redo ? this.future : this.past, to = redo ? this.past : this.future;
    to.push(from.pop()!); this.current = clone(next); this.syncSelection();
  }
  switchTarget(next: ProjectDocument): ProjectDocument { next = validateProject(next); next.revision = Math.max(next.revision, this.current.revision) + 1; return next; }
  acceptSwitch(next: ProjectDocument): void {
    this.storage?.checkpoint(next); this.current = clone(next); this.past = []; this.future = [];
    this.workspace.selectedSceneId = null; this.workspace.recovered = false;
    this.syncSelection();
  }
  assets(sampleDirectory?: string, document = this.current): { id: string; status: "available" | "missing" | "unverified"; reference: string }[] {
    return document.assets.map(a => {
      let status: "available" | "missing" | "unverified" = "unverified";
      if (a.kind === "file") status = existsSync(a.reference) ? "unverified" : "missing";
      if (a.kind === "sample" && sampleDirectory) {
        try { const files = readdirSync(path.join(sampleDirectory, a.reference)).filter(f => /\.(wav|aif|aiff|flac)$/i.test(f)); status = a.index < files.length ? "available" : "missing"; } catch { status = "missing"; }
      }
      return { id: a.id, status, reference: a.reference };
    });
  }
}
