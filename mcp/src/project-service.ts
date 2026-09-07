import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { applyEdits, clone, emptyProject, validateProject, uid, type ProjectDocument } from "./project.js";
import { ProjectStorage } from "./project-storage.js";
import { resolveSample } from "./sound-library.js";

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
        status = resolveSample(a, sampleDirectory).status;
      }
      return { id: a.id, status, reference: a.reference };
    });
  }
}

// Exploration references use the same validated document snapshots as Undo.
// Only ProjectService.current can be played/saved; these are inert alternatives.
export class ExplorationTrail {
  private entries: { id: string; label: string; kept: boolean; fingerprint: string; document: ProjectDocument; summary?: import("./jam.js").JamSummary; parentId: string | null }[] = [];
  private projectId = "";
  private fingerprint(p: ProjectDocument) { return createHash("sha256").update(JSON.stringify({ ...p, revision: 0 })).digest("hex"); }
  reset(p: ProjectDocument) { this.entries = []; this.projectId = p.id; }
  inspect(p: ProjectDocument) {
    if (this.projectId !== p.id) this.reset(p);
    const current = this.fingerprint(p);
    return this.entries.map(({ document, fingerprint, ...entry }) => ({ ...entry, revision: document.revision, current: current === fingerprint }));
  }
  private add(p: ProjectDocument, label: string, parentId: string | null, summary?: import("./jam.js").JamSummary) {
    const fingerprint = this.fingerprint(p);
    const match = this.entries.find(e => e.fingerprint === fingerprint);
    if (match) return match;
    const entry = { id: "idea_" + uid(), label, kept: false, fingerprint, document: clone(p), summary: summary && clone(summary), parentId };
    this.entries.push(entry);
    // Preserve Original plus explicitly kept ideas. Favorite capacity reserves
    // room for Original/current (each <=4 MiB) within the 16 MiB JSON budget.
    while (this.entries.length > 12 || this.entries.length > 2 && JSON.stringify(this.entries).length > 16 * 1024 * 1024) {
      const index = this.entries.findIndex((e, i) => i > 0 && !e.kept && e.id !== entry.id);
      if (index < 0) throw new Error("Session idea capacity reached; save your current jam");
      this.entries.splice(index, 1);
    }
    return entry;
  }
  record(before: ProjectDocument, after: ProjectDocument, label: string, summary?: import("./jam.js").JamSummary) {
    this.inspect(before);
    const parent = this.add(before, this.entries.length ? "Before " + label : "Original", null);
    this.add(after, label, parent.id, summary);
  }
  keep(p: ProjectDocument) {
    this.inspect(p);
    const current = this.entries.find(e => e.fingerprint === this.fingerprint(p));
    if (current?.kept) return;
    const favorites = this.entries.slice(1).filter(e => e.kept);
    if (current !== this.entries[0] && (favorites.length >= 6 || JSON.stringify(favorites.map(e => e.document)).length + JSON.stringify(p).length > 7 * 1024 * 1024)) throw new Error("Session favorites are full. Save your current jam or promote its clips to a scene.");
    const entry = this.add(p, "Kept idea", null); entry.kept = true;
  }
  target(p: ProjectDocument, id: string) {
    this.inspect(p); const entry = this.entries.find(e => e.id === id); if (!entry) throw new Error("This idea is no longer in the session trail");
    return { ...clone(entry.document), revision: p.revision };
  }
}
