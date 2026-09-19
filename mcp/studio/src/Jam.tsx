import { useState, useEffect } from "react";
import type { StudioState } from "../../src/studio-client";
import type { JamScope, VariationRequest } from "../../src/jam-model";
import { jamCapabilities, locked, verbs } from "../../src/jam-model";
import { client, accent } from "./session";
import { Range, ClockStrip } from "./controls";

export function Jam({
  state,
  disabled,
  playing,
  editTrack,
}: {
  state: StudioState;
  disabled: boolean;
  playing: boolean;
  editTrack: (id: string) => void;
}) {
  const p = state.project,
    caps = state.jam?.capabilities ?? jamCapabilities(p);
  const [intensity, setIntensity] =
    useState<VariationRequest["intensity"]>("fresh");
  const [scope, setScope] = useState<"rhythm" | "sound" | "fx" | "motion">(
    "rhythm",
  );
  const [sceneName, setSceneName] = useState("Drop");
  const [compare, setCompare] = useState<string | null>(null);
  const [customName, setCustomName] = useState("My macro");
  const [customTargets, setCustomTargets] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("abx-jam-bench") ?? "[]");
      return Array.isArray(raw)
        ? raw.filter((x) => typeof x === "string").slice(0, 32)
        : [];
    } catch {
      return [];
    }
  });
  const [suggestions, setSuggestions] = useState(true);
  const blocked =
    disabled ||
    !!state.projectRuntime.externallyModified ||
    (state.projectRuntime.performance?.mode !== undefined &&
      state.projectRuntime.performance.mode !== "manual");
  const ids = caps
    .filter((c) => c.scopes.includes(scope) || locked(p, c.trackId, "track"))
    .map((c) => c.trackId);
  const eligible = caps.filter(
    (c) => c.scopes.includes(scope) && !locked(p, c.trackId, scope),
  );
  const seed = () => crypto.getRandomValues(new Uint32Array(1))[0]; // Request entropy only; generation runs in the canonical service.
  const run = (operation: VariationRequest["operation"] = "variation") => {
    setCompare(null);
    void client.command(
      {
        cmd: "jam.variation",
        request: {
          seed: seed(),
          intensity,
          scopes: [scope],
          trackIds: ids,
          operation,
        },
      },
      operation === "fill"
        ? "Add Fill"
        : operation === "chaos"
          ? "Chaos"
          : "Make Variation",
    );
  };
  const toggle = (trackId: string, scope: JamScope) => {
    const old = p.jam?.locks.find((l) => l.trackId === trackId) ?? {
      trackId,
      scopes: [],
      parameters: [],
    };
    void client.command(
      {
        cmd: "jam.lock",
        lock: {
          trackId: old.trackId,
          parameters: old.parameters,
          scopes: old.scopes.includes(scope)
            ? old.scopes.filter((s) => s !== scope)
            : [...old.scopes, scope],
        },
      },
      "Keep / Change",
    );
  };
  const trail = state.jam?.trail ?? [],
    current = trail.find((e) => e.current),
    previous = current?.parentId
      ? trail.find((e) => e.id === current.parentId)
      : trail.filter((e) => !e.current).at(-1);
  useEffect(() => {
    if (compare && !trail.some((e) => e.id === compare)) setCompare(null);
  }, [compare, trail]);
  const start = async (starter: "groove" | "minimal" | "surprise") => {
    if (
      await client.command(
        { cmd: "jam.start", starter, seed: seed() },
        "Start Jam",
      )
    )
      await client.command({ cmd: "resume" }, "Play");
  };
  const pin = (id: string) => {
    const key = p.id + ":" + id,
      next = pins.includes(key)
        ? pins.filter((p) => p !== key)
        : [...pins, key].slice(-32);
    setPins(next);
    try {
      localStorage.setItem("abx-jam-bench", JSON.stringify(next));
    } catch {
      /* Workspace preference can remain local to this view. */
    }
  };
  return (
    <section className="jam-surface" aria-label="Jam playground">
      <div className="jam-hero">
        <div>
          <span className="eyebrow">A LITTLE CURIOSITY GOES A LONG WAY</span>
          <h1>
            What happens if<span>…</span>
          </h1>
          <p>Keep your favorite parts. Try another way around.</p>
        </div>
        <span className="jam-stamp" aria-hidden="true">
          PLAY
          <br />↗ AGAIN
        </span>
      </div>
      {!p.tracks.length ? (
        <div className="jam-starts">
          <button disabled={disabled} onClick={() => void start("groove")}>
            <strong>Start From Groove ↗</strong>
            <span>A pocket beat with room to play.</span>
          </button>
          <button disabled={disabled} onClick={() => void start("minimal")}>
            <strong>Start Minimal ↗</strong>
            <span>Two instruments. Plenty of air.</span>
          </button>
          <button disabled={disabled} onClick={() => void start("surprise")}>
            <strong>Surprise Me ✳</strong>
            <span>A related twist on a familiar pocket.</span>
          </button>
        </div>
      ) : (
        <>
          <div className="jam-scenes" aria-label="Jam scenes">
            <span className="eyebrow">RIGHT NOW</span>
            {p.sceneOrder.map((id) => {
              const scene = p.scenes.find((s) => s.id === id)!;
              return (
                <button
                  key={id}
                  disabled={blocked}
                  aria-pressed={state.workspace.selectedSceneId === id}
                  onClick={() => {
                    setCompare(null);
                    void client.edit(
                      [{ type: "scene.activate", sceneId: id }],
                      "Jam " + scene.name,
                    );
                  }}
                >
                  {scene.name}
                </button>
              );
            })}
            <button
              disabled={disabled}
              onClick={() =>
                void client.command({ cmd: "resume" }, "Continue Current")
              }
            >
              Continue Current ↗
            </button>
          </div>
          {state.projectRuntime.performance?.mode !== undefined &&
            state.projectRuntime.performance.mode !== "manual" && (
              <div className="notice">
                A prepared performance is playing. To hear Jam edits, switch to
                your active instruments.
                <button
                  disabled={disabled}
                  onClick={() =>
                    void client.command(
                      { cmd: "performance.return" },
                      "Play active instruments",
                    )
                  }
                >
                  Play active instruments
                </button>
              </div>
            )}
          <ClockStrip playing={playing} />
          <div className="jam-columns">
            <div className="jam-main">
              <div className="jam-action-deck">
                <div className="jam-scope">
                  <label>
                    Change{" "}
                    <select
                      aria-label="Variation scope"
                      value={scope}
                      onChange={(e) => setScope(e.target.value as typeof scope)}
                    >
                      <option value="rhythm">Rhythms</option>
                      <option value="sound">Sounds & notes</option>
                      <option value="fx">Creative FX</option>
                      <option value="motion">Existing motion</option>
                    </select>
                  </label>
                  <span>{eligible.length} instruments ready</span>
                </div>
                <label className="jam-intensity">
                  A little twist{" "}
                  <output>
                    {intensity === "subtle"
                      ? "Small change"
                      : intensity === "fresh"
                        ? "Fresh"
                        : "Wild"}
                  </output>
                  <input
                    aria-label="Variation intensity"
                    aria-valuetext={intensity}
                    type="range"
                    min={0}
                    max={2}
                    step={1}
                    value={["subtle", "fresh", "wild"].indexOf(intensity)}
                    onChange={(e) =>
                      setIntensity(
                        (["subtle", "fresh", "wild"] as const)[
                          Number(e.target.value)
                        ],
                      )
                    }
                  />
                  A bigger leap
                </label>
                <button
                  className="primary jam-make"
                  disabled={blocked || !eligible.length}
                  onClick={() => run()}
                >
                  Make Variation <span>↗</span>
                </button>
                <div className="jam-extra-actions">
                  <button
                    disabled={blocked || !eligible.length}
                    onClick={() => run("chaos")}
                    title="A seeded variation at the selected intensity and scope; all Keep constraints apply"
                  >
                    Chaos ✳
                  </button>
                  {scope === "rhythm" && (
                    <button
                      disabled={blocked || !eligible.length}
                      onClick={() => run("fill")}
                      title="Author a few end-of-pattern hits. One Undo."
                    >
                      Add Fill
                    </button>
                  )}
                </div>
              </div>
              <div className="jam-section-heading">
                <h2>Keep a little. Change a little.</h2>
                <span>
                  Kept parts hold their sound, including current macro offsets.
                </span>
              </div>
              <div className="jam-tracks">
                {caps.map((cap) => {
                  const t = p.tracks.find((t) => t.id === cap.trackId)!,
                    c = p.clips.find((c) => c.id === t.activeClipId),
                    kept = locked(p, t.id, "track"),
                    pinned = pins.includes(p.id + ":" + t.id);
                  return (
                    <article
                      className={`jam-track ${accent(t.slot)} ${kept ? "is-kept" : ""}`}
                      key={t.id}
                    >
                      <div className="jam-track-heading">
                        <button
                          className="jam-track-name"
                          onClick={() => editTrack(t.id)}
                          title="Open instrument in Studio"
                        >
                          {t.name || "Instrument"}
                          <small>{cap.source}</small>
                        </button>
                        <button
                          className="jam-pin"
                          aria-label={`Pin ${t.name}`}
                          aria-pressed={pinned}
                          onClick={() => pin(t.id)}
                        >
                          {pinned ? "★" : "☆"}
                        </button>
                        <button
                          className="jam-lock"
                          aria-label={`Keep ${t.name}`}
                          aria-pressed={kept}
                          disabled={blocked}
                          onClick={() => toggle(t.id, "track")}
                        >
                          {kept ? "▣ Kept" : "↻ Change"}
                        </button>
                      </div>
                      <div className="jam-mini-pattern" aria-hidden="true">
                        {c?.kind === "steps" ? (
                          c.steps.slice(0, 32).map((v, i) => (
                            <i
                              key={i}
                              className={v ? "hit" : ""}
                              style={{
                                opacity: v ? 0.5 + Math.min(v, 1) * 0.5 : 1,
                              }}
                            />
                          ))
                        ) : (
                          <span>{cap.reason ?? "No active rhythm"}</span>
                        )}
                      </div>
                      <details>
                        <summary>Keep specific parts</summary>
                        <div className="jam-part-locks">
                          {cap.scopes.map((part) => (
                            <button
                              key={part}
                              disabled={blocked || kept}
                              aria-label={`Keep ${t.name} ${part}`}
                              aria-pressed={locked(p, t.id, part)}
                              onClick={() => toggle(t.id, part)}
                            >
                              {locked(p, t.id, part) ? "▣ " : "+ "}
                              {part}
                            </button>
                          ))}
                        </div>
                        {cap.reason && <p>{cap.reason}</p>}
                      </details>
                    </article>
                  );
                })}
              </div>

              <div className="jam-verbs" aria-label="Musical actions">
                {verbs
                  .filter((v) =>
                    caps.some((c) =>
                      v.meaning === "rhythm"
                        ? c.scopes.includes("rhythm")
                        : c.targets.some((t) => t.meta.meaning === v.meaning),
                    ),
                  )
                  .map((v) => (
                    <button
                      key={v.id}
                      title={v.description}
                      disabled={
                        blocked ||
                        !caps.some((c) =>
                          v.meaning === "rhythm"
                            ? c.scopes.includes("rhythm") &&
                              !locked(p, c.trackId, "rhythm")
                            : c.targets.some(
                                (target) =>
                                  target.meta.meaning === v.meaning &&
                                  !locked(
                                    p,
                                    c.trackId,
                                    target.scope,
                                    target.parameter,
                                  ),
                              ),
                        )
                      }
                      onClick={() => {
                        setCompare(null);
                        void client.command(
                          {
                            cmd: "jam.verb",
                            verb: v.id,
                            trackIds: p.tracks.map((t) => t.id),
                          },
                          v.name,
                        );
                      }}
                    >
                      {v.name} <span>↗</span>
                    </button>
                  ))}
              </div>
              {state.jam?.summary && (
                <div className="jam-summary" role="status">
                  <strong>Changed</strong>{" "}
                  {state.jam.summary.changed.join(" · ")}
                  <br />
                  <strong>Kept</strong>{" "}
                  {state.jam.summary.kept.join(" · ") ||
                    "Everything outside your selected scope"}
                  <details>
                    <summary>How this happened</summary>
                    <p>
                      {state.jam.summary.operation} ·{" "}
                      {state.jam.summary.intensity ?? "Semantic recipe"} ·
                      source revision {state.jam.summary.sourceRevision} ·
                      algorithm {state.jam.summary.algorithm}
                      {state.jam.summary.seed !== undefined
                        ? ` · seed ${state.jam.summary.seed}`
                        : ""}
                    </p>
                  </details>
                </div>
              )}
            </div>
            <aside className="jam-side" aria-label="Jam bench and ideas">
              <section className="jam-macros">
                <div className="jam-section-heading">
                  <h2>Turn the feeling.</h2>
                  <span>Offsets keep your original sound underneath.</span>
                </div>
                {!p.jam?.macros.length && (
                  <p>
                    Add expressive controls for the instruments and FX you have.
                  </p>
                )}
                {p.jam?.macros.map((m) => (
                  <div className="jam-macro" key={m.id}>
                    <Range
                      label={`${m.name} macro`}
                      value={m.value}
                      min={-1}
                      max={1}
                      disabled={
                        blocked ||
                        !m.enabled ||
                        m.targets.every((t) =>
                          locked(
                            p,
                            t.trackId,
                            t.parameter.startsWith("fx.") ? "fx" : "sound",
                            t.parameter,
                          ),
                        )
                      }
                      onCommit={(value, base) =>
                        void client.command(
                          { cmd: "jam.macro.value", macroId: m.id, value },
                          m.name + " macro",
                          base,
                        )
                      }
                    />
                    <small>
                      {m.targets.length} mapped controls ·{" "}
                      {
                        m.targets.filter((t) =>
                          locked(
                            p,
                            t.trackId,
                            t.parameter.startsWith("fx.") ? "fx" : "sound",
                            t.parameter,
                          ),
                        ).length
                      }{" "}
                      kept
                    </small>
                    <details>
                      <summary>Mapping & options</summary>
                      <ul>
                        {m.targets.map((t) => (
                          <li key={t.trackId + t.parameter}>
                            {p.tracks.find((x) => x.id === t.trackId)?.name} ·{" "}
                            {caps
                              .find((c) => c.trackId === t.trackId)
                              ?.targets.find((x) => x.parameter === t.parameter)
                              ?.meta.name ?? t.parameter}
                          </li>
                        ))}
                      </ul>
                      <button
                        disabled={blocked}
                        aria-pressed={m.enabled}
                        onClick={() =>
                          void client.command(
                            {
                              cmd: "jam.macro.put",
                              macro: { ...m, enabled: !m.enabled },
                            },
                            "Toggle macro",
                          )
                        }
                      >
                        {m.enabled ? "Disable" : "Enable"} {m.name}
                      </button>
                      <button
                        disabled={blocked}
                        onClick={() =>
                          void client.command(
                            { cmd: "jam.macro.remove", macroId: m.id },
                            "Remove macro",
                          )
                        }
                      >
                        Remove {m.name}
                      </button>
                    </details>
                  </div>
                ))}
                <div className="jam-small-actions">
                  <button
                    disabled={blocked}
                    onClick={() =>
                      void client.command(
                        { cmd: "jam.macros.suggest" },
                        "Set up macros",
                      )
                    }
                  >
                    Find useful macros
                  </button>
                  <button
                    disabled={blocked || !p.jam?.macros.some((m) => m.value)}
                    onClick={() =>
                      void client.command(
                        { cmd: "jam.macros.reset" },
                        "Reset macros",
                      )
                    }
                  >
                    Reset free controls
                  </button>
                </div>
                <small>
                  Release a gesture to hear it. Unlock a kept control to release
                  its held offset. FX ease into place; synth changes arrive on
                  new notes.
                </small>
                <details className="jam-custom">
                  <summary>Make your own macro</summary>
                  <label>
                    Macro name
                    <input
                      value={customName}
                      maxLength={60}
                      onChange={(e) => setCustomName(e.target.value)}
                    />
                  </label>
                  {caps.flatMap((c) =>
                    c.targets.map((target) => {
                      const key = c.trackId + ":" + target.parameter;
                      return (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={customTargets.includes(key)}
                            onChange={() =>
                              setCustomTargets((old) =>
                                old.includes(key)
                                  ? old.filter((k) => k !== key)
                                  : [...old, key].slice(0, 128),
                              )
                            }
                          />
                          {c.name} · {target.meta.name}
                        </label>
                      );
                    }),
                  )}
                  <button
                    disabled={
                      blocked || !customName.trim() || !customTargets.length
                    }
                    onClick={async () => {
                      const targets = caps.flatMap((c) =>
                        c.targets
                          .filter((t) =>
                            customTargets.includes(
                              c.trackId + ":" + t.parameter,
                            ),
                          )
                          .map((t) => ({
                            trackId: c.trackId,
                            parameter: t.parameter,
                            amount: t.meta.jam!,
                          })),
                      );
                      if (
                        await client.command(
                          {
                            cmd: "jam.macro.put",
                            macro: {
                              id: crypto.randomUUID(),
                              name: customName,
                              value: 0,
                              enabled: true,
                              targets,
                            },
                          },
                          "Assign macro",
                        )
                      )
                        setCustomTargets([]);
                    }}
                  >
                    Create macro
                  </button>
                </details>
              </section>
              <section className="jam-ideas">
                <div className="jam-section-heading">
                  <h2>Take the scenic route.</h2>
                  <span>Recent ideas · return, compare, branch again.</span>
                </div>
                <ol>
                  {trail.map((entry, i) => (
                    <li key={entry.id}>
                      <button
                        disabled={blocked}
                        aria-pressed={entry.current}
                        onClick={() => {
                          setCompare(null);
                          void client.command(
                            { cmd: "jam.return", ideaId: entry.id },
                            "Return to idea",
                          );
                        }}
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        {entry.label}
                        {entry.kept ? " ★" : ""}
                        {entry.current ? " · Current" : ""}
                      </button>
                    </li>
                  ))}
                </ol>
                {!trail.length && (
                  <p>Your first variation starts a trail here.</p>
                )}
                <div className="jam-small-actions">
                  <button
                    disabled={blocked || (!previous && !compare)}
                    onClick={async () => {
                      const target = compare ?? previous?.id;
                      if (!target) return;
                      const back = current?.id;
                      if (
                        await client.command(
                          { cmd: "jam.return", ideaId: target },
                          compare ? "Back to B" : "Compare A",
                        )
                      )
                        setCompare(
                          compare
                            ? null
                            : (back ??
                                client
                                  .getSnapshot()
                                  ?.jam?.trail.find(
                                    (e) => e.revision === p.revision,
                                  )?.id ??
                                null),
                        );
                    }}
                  >
                    {compare
                      ? "B · Back to variation"
                      : "A / B · Compare previous"}
                  </button>
                  <button
                    disabled={blocked}
                    onClick={() =>
                      void client.command({ cmd: "jam.keep" }, "Keep This")
                    }
                  >
                    Keep This ★
                  </button>
                </div>
                <small>
                  Session trail is bounded. Save jam to keep your current sound
                  on disk. Returning restores that idea’s locks too.
                </small>
                <div className="jam-promote">
                  <label>
                    Scene name
                    <input
                      aria-label="Jam scene name"
                      maxLength={120}
                      value={sceneName}
                      onChange={(e) => setSceneName(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={blocked || !sceneName.trim()}
                    onClick={() =>
                      void client.command(
                        {
                          cmd: "jam.promote",
                          sceneId: crypto.randomUUID(),
                          name: sceneName,
                        },
                        "Save as Scene",
                      )
                    }
                  >
                    Save as Scene ↗
                  </button>
                  <small>
                    Independent clips & clip motion. Instruments, FX and macros
                    are shared between scenes.
                  </small>
                </div>
              </section>
              <section className="jam-notebook">
                <details>
                  <summary>Keep the journey · event notebook</summary>
                  <p>
                    Capture an event notebook as you try ideas. Use Rec above to
                    record the sound.
                  </p>
                  <div className="jam-small-actions">
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void client.command(
                          {
                            cmd: state.jam?.capture?.active
                              ? "jam.capture.stop"
                              : "jam.capture.start",
                          },
                          "Performance notebook",
                        )
                      }
                    >
                      {state.jam?.capture?.active
                        ? "Stop event capture"
                        : "Capture performance events"}
                    </button>
                    <button
                      disabled={
                        disabled ||
                        !state.jam?.capture ||
                        state.jam.capture.active ||
                        !state.jam.capture.take.events.length
                      }
                      onClick={() =>
                        void client.command(
                          { cmd: "jam.capture.keep" },
                          "Keep Performance",
                        )
                      }
                    >
                      Keep Performance
                    </button>
                  </div>
                  {state.jam?.capture && (
                    <p role="status">
                      {state.jam.capture.take.events.length} / 128 events ·{" "}
                      {state.jam.capture.active ? "Capturing" : "Stopped"}
                    </p>
                  )}
                  <small>
                    Gestures keep their order; scene launches keep scheduled
                    cycles. An event notebook, with no automatic replay or song
                    conversion.
                  </small>
                  {p.jam?.takes?.map((take) => (
                    <details key={take.id}>
                      <summary>
                        {take.name} · {take.events.length} events
                      </summary>
                      <ol>
                        {take.events.map((event, i) => (
                          <li key={i}>
                            {event.description}
                            {event.cycle !== null
                              ? ` · cycle ${event.cycle}`
                              : " · untimed"}
                          </li>
                        ))}
                      </ol>
                    </details>
                  ))}
                </details>
              </section>
              <section className="jam-bench">
                <h2>
                  Your bench <span>★</span>
                </h2>
                {p.tracks
                  .filter((t) => pins.includes(p.id + ":" + t.id))
                  .map((t) => (
                    <button key={t.id} onClick={() => editTrack(t.id)}>
                      {t.name} ↗
                    </button>
                  ))}
                {!p.tracks.some((t) => pins.includes(p.id + ":" + t.id)) && (
                  <p>
                    Star an instrument to keep its deeper controls within reach.
                  </p>
                )}
              </section>
            </aside>
          </div>
          {suggestions && eligible.length > 0 && (
            <div className="jam-suggestion">
              <span>
                ↳ Try a {scope} variation on {eligible[0].name}. Keep the parts
                you already love.
              </span>
              <button
                aria-label="Dismiss Jam suggestion"
                onClick={() => setSuggestions(false)}
              >
                Dismiss
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
