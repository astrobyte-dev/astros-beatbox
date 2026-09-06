import type { ProjectDocument, ProjectEdit } from "./project.js";
import type { Command, CommandResult } from "./commands.js";
import type { RecordingEntry } from "./recordings.js";

export interface StudioState {
  project: ProjectDocument;
  sessionId: string;
  generation: number;
  status: string;
  error: string | null;
  paused: boolean;
  stopped: boolean;
  synchronized: boolean;
  recording: boolean;
  recordingUnconfirmed?: boolean;
  recPath?: string;
  recordingState?: RecordingEntry | null;
  recordings?: RecordingEntry[];
  recordingWarning?: string | null;
  preview?: { state: string; key: string | null; error: string | null };
  history: {
    undo: number;
    redo: number;
    undoLabel?: string;
    redoLabel?: string;
  };
  workspace: {
    selectedSceneId: string | null;
    recovered: boolean;
    recoveryWarning: string | null;
  };
  projectRuntime: {
    appliedRevision: number | null;
    appliedProjectId: string | null;
    song: boolean;
    error: string | null;
    queued: number;
  };
  assets: { id: string; status: string; reference: string }[];
  slots: Record<string, string>;
}
export type EditBase = { id: string; revision: number; sessionId: string };
export type ClientStatus = {
  connected: boolean;
  busy: string | null;
  error: string | null;
  message: string;
};
type Listener = () => void;

// Disposable server read model. No reducer, optimistic music commits, local saves,
// automatic retries, or rebasing across other clients. Gesture bases are immutable.
export class StudioClient {
  private state: StudioState | null = null;
  private status: ClientStatus = {
    connected: false,
    busy: null,
    error: null,
    message: "",
  };
  private listeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();
  private sequence = 0;
  constructor(
    private request: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}
  getSnapshot = () => this.state;
  getStatus = () => this.status;
  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  subscribeStatus = (fn: Listener) => {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  };
  private updateStatus(patch: Partial<ClientStatus>) {
    const next = { ...this.status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.statusListeners.forEach((fn) => fn());
  }
  dismiss = () => this.updateStatus({ error: null, message: "" });
  report = (error: string) => this.updateStatus({ error });
  base(): EditBase {
    if (!this.state) throw new Error("Waiting for your project.");
    return {
      id: this.state.project.id,
      revision: this.state.project.revision,
      sessionId: this.state.sessionId,
    };
  }
  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    try {
      const response = await this.request("/state", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Could not read your project.");
      const incoming = (await response.json()) as StudioState;
      if (!incoming.project || !incoming.sessionId)
        throw new Error("Project state is unavailable.");
      if (sequence !== this.sequence) return;
      // Pick only authored state and slow runtime observations. Wave/scope/meter/hit
      // traffic never notifies React. Keep project object identity between revisions.
      const {
        project,
        sessionId,
        generation,
        status,
        error,
        paused,
        stopped,
        synchronized,
        recording,
        recordingUnconfirmed,
        recPath,
        recordingState, recordings, recordingWarning, preview,
        history,
        workspace,
        projectRuntime,
        assets,
        slots,
      } = incoming;
      const next = {
        project,
        sessionId,
        generation,
        status,
        error,
        paused,
        stopped,
        synchronized,
        recording,
        recordingUnconfirmed,
        recPath,
        recordingState, recordings, recordingWarning, preview,
        history,
        workspace,
        projectRuntime,
        assets,
        slots,
      };
      if (
        this.state?.sessionId === sessionId &&
        this.state.project.id === project.id &&
        this.state.project.revision === project.revision
      )
        next.project = this.state.project;
      if (JSON.stringify(next) !== JSON.stringify(this.state)) {
        this.state = next;
        this.listeners.forEach((fn) => fn());
      }
      this.updateStatus({
        connected: true,
        ...(this.status.error?.endsWith(" Reconnecting…")
          ? { error: null }
          : {}),
      });
    } catch (e) {
      if (sequence === this.sequence)
        this.updateStatus({
          connected: false,
          error: String(e instanceof Error ? e.message : e) + " Reconnecting…",
        });
    }
  }
  async command(
    command: Command,
    label: string,
    base = this.base(),
  ): Promise<boolean> {
    if (this.status.busy) return false;
    if (!this.status.connected) {
      this.report("Reconnect to the project before editing.");
      return false;
    }
    this.updateStatus({ busy: label, error: null, message: "" });
    ++this.sequence;
    let ok = false;
    try {
      const response = await this.request("/cmd", {
        method: "POST",
        signal: AbortSignal.timeout(120000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...command,
          ...(!command.cmd.startsWith("preview.") && !command.cmd.startsWith("record") ? { projectId: base.id, revision: base.revision } : {}),
          operationId: globalThis.crypto.randomUUID(),
          sessionId: base.sessionId,
          issuedAt: Date.now(),
        }),
      });
      const result = (await response.json()) as CommandResult;
      if (result.sessionId !== base.sessionId || this.state?.sessionId !== base.sessionId || result.generation < (this.state?.generation ?? 0)) throw new Error("Runtime changed before this response arrived. The old result cannot confirm the current session.");
      if (!response.ok || !result.ok)
        throw new Error(
          !result.ok ? result.error : "The action was not confirmed.",
        );
      ok = true;
      this.updateStatus({
        message:
          label === "Save jam"
            ? "Jam saved. Find it in My Jams."
            : label === "Record"
              ? result.msg
              : label + " — done",
      });
    } catch (e) {
      this.report(
        (e instanceof Error ? e.message : String(e)) +
          " Refreshing your project; review it before trying again.",
      );
    } finally {
      await this.refresh();
      this.updateStatus({ busy: null });
    }
    return ok;
  }
  edit(
    edits: ProjectEdit[],
    label: string,
    base = this.base(),
    groupId?: string,
  ) {
    return this.command(
      { cmd: "project.edit", edits, label, groupId },
      label,
      base,
    );
  }
}
