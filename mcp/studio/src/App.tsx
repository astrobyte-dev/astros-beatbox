import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ProjectDocument, Track } from "../../src/project";
import { pocketGroove } from "../../src/studio-starter";
import {
  client,
  useProject,
  useConnection,
  accent,
  trackName,
} from "./session";
import { ClockStrip, EditableText, Icon, Range } from "./controls";
import { TrackLane } from "./TrackLane";

export function App() {
  const state = useProject(),
    connection = useConnection();
  const [selection, setSelection] = useState<{
    project: string;
    track: string;
    step: number;
  } | null>(null);
  const [library, setLibrary] = useState("Grooves"),
    [mixer, setMixer] = useState(false);
  const [files, setFiles] = useState<string[]>([]),
    [fileError, setFileError] = useState("");
  const [dialog, setDialog] = useState<"save" | "new" | null>(null);
  const workspace = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await client.refresh();
      if (!cancelled) timer = setTimeout(poll, 600);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  const loadFiles = useCallback(async () => {
    try {
      const r = await fetch("/projects", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setFiles(await r.json());
      setFileError("");
    } catch {
      setFileError("Saved jams could not be listed. Try again.");
    }
  }, []);
  useEffect(() => {
    void loadFiles();
  }, [library, loadFiles]);
  const p = state?.project;
  const track =
    p?.tracks.find(
      (t) => selection?.project === p.id && t.id === selection.track,
    ) ?? p?.tracks[0];
  const selectedStep =
    selection?.track === track?.id ? (selection?.step ?? 0) : 0;
  const select = useCallback((id: string, step?: number) => {
    const current = client.getSnapshot()!.project;
    setSelection((old) =>
      old?.track === id &&
      old.project === current.id &&
      (step === undefined || old.step === step)
        ? old
        : { project: current.id, track: id, step: step ?? 0 },
    );
  }, []);
  // Stable IDs keep focus through revisions. If a selected object is removed or
  // a project is switched externally, move to the workspace's stable heading.
  const previous = useRef<{ project: string; track?: string } | null>(null);
  useEffect(() => {
    if (!p) return;
    if (
      previous.current &&
      (previous.current.project !== p.id ||
        (previous.current.track &&
          !p.tracks.some((t) => t.id === previous.current!.track)))
    )
      workspace.current?.focus();
    previous.current = { project: p.id, track: track?.id };
  }, [p, track]);
  const disabled = !connection.connected || !!connection.busy;
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.altKey ||
        e.key.toLowerCase() !== "z" ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,select,[contenteditable],dialog"))
      )
        return;
      e.preventDefault();
      const s = client.getSnapshot();
      if (!s || client.getStatus().busy) return;
      if (e.shiftKey ? s.history.redo : s.history.undo)
        void client.command(
          { cmd: e.shiftKey ? "project.redo" : "project.undo" },
          e.shiftKey ? "Redo" : "Undo",
        );
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  if (!state || !p)
    return (
      <main className="connecting">
        <span className="brand-mark">
          a<span>✳</span>
        </span>
        <h1>Make room for a little rhythm.</h1>
        <p role="status">{connection.error || "Opening your studio…"}</p>
        <button onClick={() => void client.refresh()}>Reconnect</button>
        <a href="/">Classic dashboard</a>
      </main>
    );
  const playing =
    state.status === "ready" &&
    !state.stopped &&
    !state.paused &&
    state.synchronized &&
    state.projectRuntime.appliedRevision !== null;
  const engineIssue = state.error || state.projectRuntime.error;
  const statusText = !connection.connected
    ? "Reconnecting"
    : connection.busy
      ? connection.busy === "Play" && state.status !== "ready"
        ? "Preparing your instruments…"
        : `${connection.busy}…`
      : engineIssue ||
          state.status === "degraded" ||
          (!state.synchronized && state.status === "ready")
        ? "Playback needs attention"
        : playing
          ? "Playing"
          : state.status === "idle"
            ? "Ready when you are"
            : state.status === "booting"
              ? "Preparing sound…"
              : "Paused";
  const start = async () => {
    try {
      const edits = pocketGroove(p),
        base = client.base();
      // An empty project can still have a running transport after a legacy New.
      // Prepare the starter stopped, including in that existing engine session.
      if (
        state.status === "ready" &&
        !state.paused &&
        !state.stopped &&
        !(await client.command({ cmd: "pause" }, "Prepare starter", base))
      )
        return;
      await client.edit(edits, "Start Pocket groove", base);
    } catch (e) {
      client.report(String(e));
    }
  };
  const hasMusic =
    p.tracks.length > 0 || p.clips.length > 0 || p.arrangement.length > 0;
  return (
    <div className="studio-app" data-revision={p.revision} data-project={p.id}>
      <a className="skip-link" href="#workspace">
        Skip to instruments
      </a>
      <header className="topbar">
        <a href="/studio" className="brand" aria-label="Astro's Beatbox studio">
          <span className="brand-mark">
            a<span>✳</span>
          </span>
          <span>
            astro’s<span>beatbox</span>
          </span>
        </a>
        <div className="project-title">
          <span className="eyebrow">YOUR JAM</span>
          <EditableText
            label="Project name"
            value={p.name}
            disabled={disabled}
            onCommit={(name, base) =>
              void client.edit(
                [{ type: "project.rename", name }],
                "Rename jam",
                base,
              )
            }
          />
        </div>
        <div className="transport">
          <button
            className="primary play-button"
            disabled={disabled || !p.tracks.some((t) => t.activeClipId)}
            onClick={() =>
              void client.command(
                { cmd: playing ? "pause" : "resume" },
                playing ? "Pause" : "Play",
              )
            }
          >
            <Icon name={playing ? "pause" : "play"} />
            {connection.busy === "Play"
              ? "Preparing"
              : playing
                ? "Pause"
                : "Play"}
          </button>
          <Tempo project={p} disabled={disabled} />
          <button
            className={`record-button ${state.recording ? "recording" : ""}`}
            disabled={disabled || state.status !== "ready"}
            aria-label={state.recording ? "Finish recording" : "Record"}
            aria-pressed={state.recording}
            title="Record to the existing recordings folder"
            onClick={() => void client.command({ cmd: "record" }, "Record")}
          >
            <i />
            {state.recording ? "Finish" : "Rec"}
          </button>
        </div>
        <div className="history-actions">
          <button
            className="icon-button"
            aria-label={`Undo${state.history.undoLabel ? ": " + state.history.undoLabel : ""}`}
            title={`Undo ${state.history.undoLabel ?? ""} · Ctrl/⌘ Z`}
            disabled={disabled || !state.history.undo}
            onClick={() => void client.command({ cmd: "project.undo" }, "Undo")}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            aria-label={`Redo${state.history.redoLabel ? ": " + state.history.redoLabel : ""}`}
            title={`Redo ${state.history.redoLabel ?? ""} · Ctrl/⌘ Shift Z`}
            disabled={disabled || !state.history.redo}
            onClick={() => void client.command({ cmd: "project.redo" }, "Redo")}
          >
            <Icon name="redo" />
          </button>
        </div>
        <button
          className="save-button"
          disabled={disabled}
          onClick={() => setDialog("save")}
        >
          <Icon name="save" />
          Save jam
        </button>
      </header>
      <div className="studio-body">
        <aside className="library" aria-label="Library">
          <div className="library-top">
            <span className="eyebrow">YOUR SOUND STARTS HERE</span>
            <h2>
              The collection<span>.</span>
            </h2>
          </div>
          <nav aria-label="Library sections">
            {[
              ["Grooves", "groove"],
              ["Sounds", "sound"],
              ["My Jams", "folder"],
            ].map(([name, icon]) => (
              <button
                key={name}
                className={library === name ? "active" : ""}
                aria-pressed={library === name}
                onClick={() => setLibrary(name)}
              >
                <Icon name={icon} />
                {name}
                {library === name && <span className="nav-dot" />}
              </button>
            ))}
          </nav>
          {library === "Grooves" ? (
            <div className="library-content">
              <span className="eyebrow">A GOOD PLACE TO START</span>
              <div className="groove-art" aria-hidden="true">
                <div className="vinyl">
                  <i />
                  <i />
                  <i />
                </div>
                <span>
                  POCKET
                  <br />
                  GROOVE
                </span>
                <b>01</b>
              </div>
              <h3>Pocket groove</h3>
              <p>
                A laid-back little beat.
                <br />
                Four instruments. All yours.
              </p>
              <div className="groove-tags">
                <span>108 BPM</span>
                <span>4 instruments</span>
              </div>
              <button
                className="starter-button"
                disabled={disabled || hasMusic}
                onClick={start}
              >
                {hasMusic ? "Start in a new jam" : "Use this groove"}
                <Icon name="arrow" />
              </button>
              {hasMusic && (
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => setDialog("new")}
                >
                  New empty jam
                </button>
              )}
            </div>
          ) : library === "Sounds" ? (
            <div className="library-content">
              <span className="eyebrow">IN THIS JAM</span>
              {p.assets.length ? (
                <ul className="asset-list">
                  {p.assets.map((a) => (
                    <li key={a.id}>
                      <Icon name="sound" />
                      <span>
                        {a.name}
                        <small>
                          {a.kind} · {a.index + 1}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Your instruments’ sounds will appear here.</p>
              )}
              <p className="upcoming">
                Sound browsing and previews are coming in a later update. For
                now, explore the sounds in your jam.
              </p>
            </div>
          ) : (
            <div className="library-content">
              <span className="eyebrow">SAVED ON THIS COMPUTER</span>
              {fileError && <p role="alert">{fileError}</p>}
              {files.length ? (
                <ul className="jam-list">
                  {files.map((f) => (
                    <li key={f}>
                      <button
                        disabled={disabled}
                        aria-label={`Open jam ${f}`}
                        onClick={() =>
                          void client.command(
                            { cmd: "project.load", value: f },
                            "Open jam",
                          )
                        }
                      >
                        <Icon name="folder" />
                        <span>{f}</span>
                        <span>↗</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Keep a groove you love.
                  <br />
                  Save your jam to find it here.
                </p>
              )}
              <button className="text-button" onClick={() => void loadFiles()}>
                Refresh jams
              </button>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => setDialog("new")}
              >
                New empty jam
              </button>
            </div>
          )}
          <div className="library-footer">
            <span className="tiny-star">✳</span>
            <p>
              A little curiosity.
              <br />A lot of possibility.
            </p>
            <a href="/" target="_blank" rel="noreferrer">
              Classic dashboard ↗
            </a>
          </div>
        </aside>
        <main id="workspace" className="workspace" tabIndex={-1}>
          <div className="workspace-intro">
            <div>
              <span className="eyebrow">THE STUDIO / 01</span>
              <h1 ref={workspace} tabIndex={-1}>
                Play with sound<span>.</span>
              </h1>
              <p>Find your groove. Change a little. Make it yours.</p>
            </div>
            <span className="doodle" aria-hidden="true">
              ✳
            </span>
          </div>
          <div className="workspace-toolbar">
            <div className="workspace-tabs">
              <button aria-pressed={!mixer} onClick={() => setMixer(false)}>
                Instruments <span>{p.tracks.length}</span>
              </button>
              <button aria-pressed={mixer} onClick={() => setMixer(true)}>
                <Icon name="mix" />
                Mixer
              </button>
            </div>
            <span
              className={`engine-state ${playing ? "is-playing" : ""}`}
              role="status"
            >
              <i />
              {statusText}
            </span>
          </div>
          {state.projectRuntime.song && (
            <div className="notice">
              An arrangement is playing. Switch to these instruments to hear the
              active rhythms.{" "}
              <button
                disabled={disabled}
                onClick={() =>
                  void client.command(
                    { cmd: "song.stop" },
                    "Play active instruments",
                  )
                }
              >
                Play these instruments
              </button>
            </div>
          )}
          {state.workspace.recovered && (
            <p className="quiet-notice">
              Your last session was recovered. Press Play when you’re ready.
            </p>
          )}
          {state.workspace.recoveryWarning && (
            <p className="notice" role="alert">
              {state.workspace.recoveryWarning}
            </p>
          )}
          {state.recordingUnconfirmed && (
            <p className="notice" role="alert">
              Recording could not be finalized. Open the classic dashboard to
              inspect the engine.
            </p>
          )}
          {engineIssue && (
            <div className="notice" role="alert">
              Sound could not be confirmed: {engineIssue}{" "}
              <a href="/" target="_blank" rel="noreferrer">
                Open diagnostics ↗
              </a>
            </div>
          )}
          {p.tracks.length ? (
            <>
              <div className="rhythm-guide">
                <span>
                  {mixer ? "INDEPENDENT CHANNEL MIX" : "YOUR RHYTHMS"}
                </span>
                <span>
                  {mixer
                    ? "Levels leave your pad velocities intact"
                    : "Click to add a beat · drag to paint"}
                </span>
              </div>
              <ClockStrip playing={playing} />
              {!mixer ? (
                <div className="tracks">
                  {p.tracks.map((t) => {
                    const c = p.clips.find((c) => c.id === t.activeClipId),
                      a =
                        c?.kind === "steps"
                          ? p.assets.find((a) => a.id === c.assetId)
                          : null;
                    return (
                      <TrackLane
                        key={t.id}
                        track={t}
                        clip={c}
                        sound={
                          a
                            ? `${a.name}${a.index ? " · " + (a.index + 1) : ""} / ${a.kind === "sample" ? "drum sample" : a.kind}`
                            : c
                              ? "Custom instrument"
                              : "No active rhythm"
                        }
                        selected={track?.id === t.id}
                        selectedStep={selectedStep}
                        disabled={disabled}
                        onSelect={select}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="mixer-grid">
                  {p.tracks.map((t) => (
                    <div
                      key={t.id}
                      className={`mixer-channel ${accent(t.slot)} ${track?.id === t.id ? "selected" : ""}`}
                    >
                      <button
                        className="channel-title"
                        aria-pressed={track?.id === t.id}
                        onClick={() => select(t.id)}
                      >
                        {trackName(t.name, t.slot)}
                      </button>
                      {t.channel !== null ? (
                        <>
                          <Range
                            label={`${trackName(t.name, t.slot)} level`}
                            value={t.mixer.level}
                            max={2}
                            disabled={disabled}
                            onCommit={(level, base) =>
                              void client.edit(
                                [
                                  {
                                    type: "mixer.set",
                                    trackId: t.id,
                                    values: { level },
                                  },
                                ],
                                `Mix ${trackName(t.name, t.slot)}`,
                                base,
                              )
                            }
                          />
                          <Range
                            label={`${trackName(t.name, t.slot)} balance`}
                            value={t.mixer.balance}
                            min={-1}
                            disabled={disabled}
                            onCommit={(balance, base) =>
                              void client.edit(
                                [
                                  {
                                    type: "mixer.set",
                                    trackId: t.id,
                                    values: { balance },
                                  },
                                ],
                                `Balance ${trackName(t.name, t.slot)}`,
                                base,
                              )
                            }
                          />
                        </>
                      ) : (
                        <p>Custom routing. Use the classic dashboard.</p>
                      )}
                      <button
                        disabled={disabled}
                        aria-pressed={t.mixer.mute}
                        onClick={() =>
                          void client.edit(
                            [
                              {
                                type: "mixer.set",
                                trackId: t.id,
                                values: { mute: !t.mixer.mute },
                              },
                            ],
                            `Mute ${trackName(t.name, t.slot)}`,
                          )
                        }
                      >
                        Mute
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="workspace-tip">
                <span>↳</span>
                <p>
                  {mixer
                    ? "Give each instrument its own space."
                    : "Small changes make a different groove."}
                  <small>
                    {mixer
                      ? "Select an instrument to explore its sound."
                      : "Try moving a kick. Undo is always close by."}
                  </small>
                </p>
              </div>
              <p id="pad-help" className="keyboard-hint">
                ← → move between pads · Space or Enter toggles a beat · select a
                pad to change its velocity.
              </p>
            </>
          ) : (
            <div className="empty-workspace">
              <div className="empty-pads" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
              <h2>Every groove starts somewhere.</h2>
              <p>
                Start with Pocket groove, then tap the pads
                <br />
                to put your own spin on it.
              </p>
              <button className="primary" disabled={disabled} onClick={start}>
                Start Pocket groove
                <Icon name="arrow" />
              </button>
              <span>Nothing plays until you press Play.</span>
            </div>
          )}
          <div className="feedback" aria-live="polite" aria-atomic="true">
            {connection.busy ? (
              `${connection.busy}… waiting for confirmation`
            ) : connection.error ? (
              <span role="alert">
                {connection.error}{" "}
                <button onClick={client.dismiss}>Dismiss</button>
              </span>
            ) : (
              connection.message
            )}
          </div>
        </main>
        <aside
          className={`inspector ${track ? accent(track.slot) : ""}`}
          aria-label="Instrument inspector"
        >
          {track ? (
            <Inspector
              key={p.id + ":" + track.id + ":" + track.activeClipId}
              project={p}
              track={track}
              step={selectedStep}
              disabled={disabled}
            />
          ) : (
            <div className="inspector-empty">
              <Icon name="sound" />
              <h2>A closer listen.</h2>
              <p>
                Select an instrument to explore its rhythm, sound and effects.
              </p>
            </div>
          )}
        </aside>
      </div>
      <footer className="bottom-bar">
        <span>
          <b>ASTRO’S BEATBOX</b> / Play with sound.
        </span>
        <span>
          {playing ? "● LIVE" : "○ AT YOUR PACE"}
          <i />
          {p.tempo.beatsPerCycle} beats / cycle
          <i />
          {p.tracks.length} instruments
        </span>
      </footer>
      {dialog && (
        <ProjectDialog
          kind={dialog}
          files={files}
          projectName={p.name}
          onClose={() => setDialog(null)}
          onSaved={() => {
            void loadFiles();
          }}
        />
      )}
    </div>
  );
}

function Tempo({
  project,
  disabled,
}: {
  project: ProjectDocument;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null),
    base = useRef<ReturnType<typeof client.base> | null>(null);
  return (
    <label className="tempo">
      <input
        type="number"
        aria-label="Tempo"
        min="1"
        max="1000"
        step="1"
        value={draft ?? project.tempo.bpm}
        disabled={disabled}
        onFocus={() => {
          base.current = client.base();
        }}
        onChange={(e) => {
          base.current ??= client.base();
          setDraft(e.target.value);
        }}
        onBlur={() => {
          if (draft !== null && base.current && +draft !== project.tempo.bpm) {
            if (+draft > 0 && +draft <= 1000)
              void client.edit(
                [
                  {
                    type: "tempo.set",
                    bpm: +draft,
                    beatsPerCycle: project.tempo.beatsPerCycle,
                  },
                ],
                "Change tempo",
                base.current,
              );
            else client.report("Choose a tempo between 1 and 1000 BPM.");
          }
          setDraft(null);
          base.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            base.current = null;
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      <span>BPM</span>
    </label>
  );
}

function Inspector({
  project: p,
  track,
  step,
  disabled,
}: {
  project: ProjectDocument;
  track: Track;
  step: number;
  disabled: boolean;
}) {
  const state = useProject()!;
  const clip = p.clips.find((c) => c.id === track.activeClipId),
    visual = clip?.kind === "steps" ? clip : null;
  const sound = visual && p.assets.find((a) => a.id === visual.assetId),
    name = trackName(track.name, track.slot);
  const index = visual ? Math.min(step, visual.steps.length - 1) : 0;
  const assetStatus = sound && state.assets.find((a) => a.id === sound.id);
  const motion = p.automation.filter(
    (a) =>
      a.trackId === track.id && (a.clipId === null || a.clipId === clip?.id),
  );
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">IN FOCUS</span>
        <span className="selection-pill">Selected</span>
      </div>
      <div className="instrument-portrait" aria-hidden="true">
        <span className={`portrait-shape portrait-${(track.slot - 1) % 4}`} />
        <span className="portrait-number">
          {String(track.slot).padStart(2, "0")}
        </span>
        <span className="portrait-spark">✳</span>
      </div>
      <div className="instrument-name">
        <EditableText
          label="Instrument name"
          value={name}
          disabled={disabled}
          onCommit={(name, base) =>
            void client.edit(
              [{ type: "track.rename", trackId: track.id, name }],
              "Rename instrument",
              base,
            )
          }
        />
        <span>
          {sound
            ? `${sound.name} · ${sound.kind} ${sound.index + 1}`
            : "Custom Tidal instrument"}
        </span>
      </div>
      {assetStatus?.status === "missing" && (
        <p className="notice" role="alert">
          This sound is missing. Its rhythm is kept, but playback is silent.
        </p>
      )}
      {visual ? (
        <>
          <section className="inspector-section">
            <h3>
              Rhythm<span>{visual.steps.length} steps</span>
            </h3>
            <Range
              label="Swing"
              value={visual.swing}
              max={0.5}
              disabled={disabled}
              onCommit={(value, base) =>
                void client.edit(
                  [{ type: "swing.set", clipId: visual.id, value }],
                  `Swing ${name}`,
                  base,
                )
              }
            />
            <p className="control-hint">A little lean between the beats.</p>
            <Range
              label={`Step ${index + 1} velocity`}
              value={visual.steps[index]}
              max={1.5}
              step={0.05}
              disabled={disabled}
              onCommit={(value, base) => {
                const steps = [...visual.steps];
                steps[index] = value;
                void client.edit(
                  [{ type: "steps.set", clipId: visual.id, steps }],
                  `${name} step ${index + 1} velocity`,
                  base,
                );
              }}
            />
            <p className="control-hint">
              Select any pad. Zero makes it silent.
            </p>
          </section>
          <section className="inspector-section">
            <h3>Shape the sound</h3>
            <Range
              label="Tone"
              value={visual.parameters.cutoff ?? 24000}
              min={100}
              max={24000}
              step={100}
              unit=" Hz"
              disabled={disabled}
              onCommit={(value, base) =>
                void client.edit(
                  [
                    {
                      type: "parameter.set",
                      clipId: visual.id,
                      parameter: "cutoff",
                      value,
                    },
                  ],
                  `Shape ${name} tone`,
                  base,
                )
              }
            />
            <Range
              label="Room"
              value={visual.parameters.room ?? 0}
              disabled={disabled}
              onCommit={(value, base) =>
                void client.edit(
                  [
                    {
                      type: "parameter.set",
                      clipId: visual.id,
                      parameter: "room",
                      value,
                    },
                  ],
                  `Change ${name} room`,
                  base,
                )
              }
            />
          </section>
        </>
      ) : (
        <p className="code-explanation">
          This instrument uses custom code. Its musical expression is preserved.
          Continue editing it in the classic dashboard.
        </p>
      )}
      <details className="inspector-details">
        <summary>
          Motion{" "}
          <span>
            {motion.filter((a) => a.enabled).length
              ? `${motion.filter((a) => a.enabled).length} active`
              : "Explore later"}
          </span>
        </summary>
        <p>
          {motion.length
            ? "Existing motion is preserved. Edit its curves in the classic dashboard."
            : "Motion adds changes over time. More ways to explore it are coming later."}
        </p>
        {motion.map((a) => (
          <p key={a.id}>
            {a.parameter} · {a.enabled ? "on" : "off"}
          </p>
        ))}
      </details>
      <details className="inspector-details code-details">
        <summary>
          Peek at the code <span>↗</span>
        </summary>
        <p>
          {visual
            ? "Generated from your rhythm, sound and motion. This is a read-only view of the project."
            : "The original Tidal expression. It stays separate from visual rhythm editing."}
        </p>
        <pre tabIndex={0} aria-label={`${name} Tidal code`}>
          {state.slots["d" + track.slot]
            ? `d${track.slot} $ ${state.slots["d" + track.slot]}`
            : "No active code"}
        </pre>
      </details>
      <div className="inspector-note">
        <span>✳</span>
        <p>
          Follow your ears.
          <br />
          You can always undo.
        </p>
      </div>
    </>
  );
}

function ProjectDialog({
  kind,
  files,
  projectName,
  onClose,
  onSaved,
}: {
  kind: "save" | "new";
  files: string[];
  projectName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    base = useRef(client.base());
  const [name, setName] = useState(
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .slice(0, 80) || "my-jam",
  );
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const d = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    d.showModal();
    return () => {
      d.close();
      previous?.focus();
    };
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setWorking(true);
    const ok = await client.command(
      {
        cmd: kind === "save" ? "project.save" : "project.new",
        ...(kind === "save" ? { value: name } : {}),
      },
      kind === "save" ? "Save jam" : "New jam",
      base.current,
    );
    setWorking(false);
    if (ok) {
      onSaved();
      onClose();
    } else
      setError(
        client.getStatus().error ||
          "Could not complete this action. Close and review your jam.",
      );
  };
  return (
    <dialog
      ref={ref}
      className="project-dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!working) onClose();
      }}
    >
      <form onSubmit={submit}>
        <span className="eyebrow">
          {kind === "save" ? "KEEP WHAT YOU LIKE" : "A FRESH START"}
        </span>
        <h2 id="dialog-title">
          {kind === "save" ? "Give this groove a home." : "Start an empty jam?"}
        </h2>
        <p>
          {kind === "save"
            ? "Your instruments, rhythms, effects and mix are saved together on this computer."
            : "Save your current jam first if you want to return to it. Starting a new jam resets undo history."}
        </p>
        {kind === "save" && (
          <label>
            Save as
            <input
              autoFocus
              aria-label="Save as"
              required
              pattern="[a-zA-Z0-9_\-]{1,80}"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={working}
            />
            <small>Letters, numbers, hyphens and underscores.</small>
          </label>
        )}
        {kind === "save" && files.includes(name) && (
          <p className="notice">This replaces the saved jam “{name}”.</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={working} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={working || !!error}>
            {working
              ? "Saving…"
              : kind === "new"
                ? "Start new jam"
                : files.includes(name)
                  ? "Replace saved jam"
                  : "Save jam"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
