import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Track, Clip } from "../../src/project";
import type { EditBase } from "../../src/studio-client";
import { client, accent, trackName } from "./session";
import { Icon } from "./controls";

export const TrackLane = memo(function TrackLane({
  track,
  clip,
  sound,
  selected,
  selectedStep,
  disabled,
  onSelect,
}: {
  track: Track;
  clip?: Clip;
  sound: string;
  selected: boolean;
  selectedStep: number;
  disabled: boolean;
  onSelect: (id: string, step?: number) => void;
}) {
  const name = trackName(track.name, track.slot);
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<{
    base: EditBase;
    steps: number[];
    value: number;
    visited: Set<number>;
    clipId: string;
  } | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const suppressClick = useRef(false);
  const finish = useRef(() => {});
  finish.current = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDraft(null);
    void client.edit(
      [{ type: "steps.set", clipId: g.clipId, steps: g.steps }],
      `Paint ${name} rhythm`,
      g.base,
    );
  };
  useEffect(() => {
    const end = () => finish.current();
    const cancel = () => {
      gesture.current = null;
      setDraft(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const toggle = (i: number) => {
    if (!clip || clip.kind !== "steps" || disabled) return;
    const steps = [...clip.steps];
    steps[i] = steps[i] > 0 ? 0 : 1;
    onSelect(track.id, i);
    void client.edit(
      [{ type: "steps.set", clipId: clip.id, steps }],
      `Change ${name} step ${i + 1}`,
    );
  };
  const steps = clip?.kind === "steps" ? (draft ?? clip.steps) : [];
  return (
    <article
      ref={root}
      className={`track-lane ${accent(track.slot)} ${selected ? "selected" : ""} ${track.mixer.mute ? "muted" : ""}`}
      data-track={track.id}
      aria-label={`${name} instrument`}
    >
      <div className="track-heading">
        <button
          className="track-select"
          aria-label={`Select ${name}`}
          aria-pressed={selected}
          onClick={() => onSelect(track.id)}
        >
          <span
            className={`instrument-symbol symbol-${(track.slot - 1) % 4}`}
            aria-hidden="true"
          >
            <Icon name="sound" />
          </span>
          <span>
            <strong>{name}</strong>
            <small>{sound}</small>
          </span>
        </button>
        <div className="lane-actions">
          <span className="step-count">
            {steps.length ? `${steps.length} steps` : "Code"}
          </span>
          <button
            className="mini"
            disabled={disabled}
            aria-label={`Mute ${name}`}
            aria-pressed={track.mixer.mute}
            onClick={() =>
              void client.edit(
                [
                  {
                    type: "mixer.set",
                    trackId: track.id,
                    values: { mute: !track.mixer.mute },
                  },
                ],
                `${track.mixer.mute ? "Unmute" : "Mute"} ${name}`,
              )
            }
          >
            M
          </button>
          <button
            className="mini"
            disabled={disabled}
            aria-label={`Solo ${name}`}
            aria-pressed={track.mixer.solo}
            onClick={() =>
              void client.edit(
                [
                  {
                    type: "mixer.set",
                    trackId: track.id,
                    values: { solo: !track.mixer.solo },
                  },
                ],
                `${track.mixer.solo ? "Unsolo" : "Solo"} ${name}`,
              )
            }
          >
            S
          </button>
        </div>
      </div>
      {clip?.kind === "steps" ? (
        <div className="pad-scroll">
          <div
            className="rhythm-pads"
            style={{ "--steps": steps.length } as CSSProperties}
            aria-label={`${name} rhythm`}
          >
            {steps.map((velocity, i) => (
              <button
                key={i}
                className={`rhythm-pad ${velocity > 0 ? "on" : ""} ${i % 4 === 0 ? "group-start" : ""} ${selected && selectedStep === i ? "chosen" : ""}`}
                style={
                  { "--velocity": Math.min(velocity / 1.5, 1) } as CSSProperties
                }
                aria-label={`${name} step ${i + 1}`}
                aria-describedby="pad-help"
                tabIndex={
                  i ===
                  (selected ? Math.min(selectedStep, steps.length - 1) : 0)
                    ? 0
                    : -1
                }
                aria-pressed={velocity > 0}
                aria-disabled={disabled}
                title={`Step ${i + 1} · velocity ${velocity}`}
                data-step={i}
                onFocus={() => onSelect(track.id, i)}
                onPointerDown={(e) => {
                  if (e.button !== 0 || disabled) return;
                  e.currentTarget.focus();
                  suppressClick.current = true;
                  // Avoid implicit touch capture so dragging can visit neighbouring pads.
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  const next = [...clip.steps],
                    value = next[i] > 0 ? 0 : 1;
                  next[i] = value;
                  gesture.current = {
                    base: client.base(),
                    steps: next,
                    value,
                    visited: new Set([i]),
                    clipId: clip.id,
                  };
                  setDraft(next);
                }}
                onPointerEnter={() => {
                  const g = gesture.current;
                  if (!g || g.visited.has(i)) return;
                  g.visited.add(i);
                  g.steps = [...g.steps];
                  g.steps[i] = g.value;
                  setDraft(g.steps);
                }}
                onClick={(e) => {
                  if (e.detail > 0 && suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  toggle(i);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    gesture.current = null;
                    setDraft(null);
                    return;
                  }
                  const target =
                    e.key === "ArrowRight"
                      ? (i + 1) % steps.length
                      : e.key === "ArrowLeft"
                        ? (i - 1 + steps.length) % steps.length
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? steps.length - 1
                            : null;
                  if (target !== null) {
                    e.preventDefault();
                    root.current
                      ?.querySelector<HTMLButtonElement>(
                        `[data-step="${target}"]`,
                      )
                      ?.focus();
                  }
                }}
              >
                <span className="pad-dot" />
                <span className="pad-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <i className="velocity-mark" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="code-track-note">
          {clip
            ? "A custom Tidal instrument. Its original code is preserved."
            : "No rhythm is active on this instrument."}{" "}
          <a href="/#steps" target="_blank" rel="noreferrer">
            Open in classic ↗
          </a>
        </div>
      )}
    </article>
  );
});
