import { useState } from "react";
import type { ProjectDocument, Track, ProjectEdit } from "../../src/project";
import {
  instruments,
  effects,
  defaults,
  definition,
  synthSource,
  type SoundDefinition,
  type Effect,
} from "../../src/sound-lab";
import { addSynth } from "../../src/sound-lab-edits";
import { client, accent } from "./session";
import { Knob, EditableText, Range } from "./controls";
import { MotionEditor } from "./Composition";

export function InstrumentBrowser({
  project: p,
  sceneId,
  disabled,
  onSelect,
}: {
  project: ProjectDocument;
  sceneId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="instrument-browser library-content">
      <span className="eyebrow">GENERATE SOMETHING</span>
      <h3>A room full of possibilities.</h3>
      <p>Choose a synth. A first phrase is ready for you to play.</p>
      {instruments.map((d, i) => (
        <button
          className={`instrument-card ${accent(i + 1)}`}
          key={d.id}
          disabled={disabled}
          onClick={async () => {
            try {
              const edits = addSynth(p, sceneId, d.id);
              const id = (
                edits[1] as Extract<ProjectEdit, { type: "track.add" }>
              ).track.id;
              if (await client.edit(edits, "Add " + d.name)) onSelect(id);
            } catch (e) {
              client.report(String(e));
            }
          }}
        >
          <span className="instrument-card-art" aria-hidden="true">
            {["▥", "◉", "≋", "◇", "✳"][i]}
          </span>
          <small>{d.category} · SYNTH</small>
          <strong>{d.name}</strong>
          <span>{d.description}</span>
          <b>+ Add instrument</b>
        </button>
      ))}
    </div>
  );
}
export function SoundLab({
  project: p,
  track,
  disabled,
}: {
  project: ProjectDocument;
  track: Track;
  disabled: boolean;
}) {
  const [tab, setTab] = useState(
      track.source?.type === "synth" ? "Instrument" : "FX",
    ),
    [advanced, setAdvanced] = useState(false),
    [patchName, setPatchName] = useState("My patch"),
    [fxChoice, setFxChoice] = useState("distortion"),
    [destination, setDestination] = useState(""),
    [motionSource, setMotionSource] = useState<"lfo" | "random" | "envelope">(
      "lfo",
    );
  const source = track.source?.type === "synth" ? track.source : undefined,
    d = source && definition("instrument", source.definitionId, source.version);
  const clip = p.clips.find((c) => c.id === track.activeClipId),
    rack = track.effects ?? [],
    routes = track.modulation ?? [];
  const edit = (edits: ProjectEdit[], label: string) =>
    void client.edit(edits, label);
  const patchControls = (
    def: SoundDefinition,
    values: Record<string, number>,
    presetId?: string,
    fx?: Effect,
  ) => (
    <div className="patch-controls">
      <label>
        Patch
        <select
          aria-label={fx ? `${def.name} patch` : "Instrument patch"}
          disabled={disabled}
          value={presetId ?? ""}
          onChange={(e) =>
            edit(
              [
                {
                  type: "patch.load",
                  trackId: track.id,
                  effectId: fx?.id,
                  presetId: e.target.value,
                },
              ],
              "Load " + def.name + " patch",
            )
          }
        >
          <option value="" disabled>
            Custom sound
          </option>
          {[
            ...def.presets,
            ...(p.patches ?? []).filter(
              (patch) =>
                patch.definitionId === def.id &&
                patch.version === def.version &&
                patch.kind === (fx ? "effect" : "instrument"),
            ),
          ].map((patch) => (
            <option key={patch.id} value={patch.id}>
              {patch.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={disabled}
        onClick={() =>
          edit(
            fx
              ? [
                  {
                    type: "fx.put",
                    trackId: track.id,
                    effect: {
                      ...fx,
                      values: defaults(def),
                      presetId: undefined,
                    },
                  },
                ]
              : [
                  {
                    type: "source.set",
                    trackId: track.id,
                    source: { ...synthSource(def.id), presetId: undefined },
                  },
                ],
            "Restore " + def.name + " defaults",
          )
        }
      >
        Defaults
      </button>
      <details>
        <summary>Save a patch</summary>
        <input
          aria-label={fx ? `${def.name} patch name` : "Patch name"}
          value={patchName}
          maxLength={80}
          onChange={(e) => setPatchName(e.target.value)}
        />
        <button
          disabled={disabled || !patchName.trim()}
          onClick={() =>
            edit(
              [
                {
                  type: "patch.put",
                  patch: {
                    id: crypto.randomUUID(),
                    name: patchName.trim(),
                    kind: fx ? "effect" : "instrument",
                    definitionId: def.id,
                    version: def.version,
                    values,
                  },
                },
              ],
              "Save user patch",
            )
          }
        >
          Save {fx ? def.name : "instrument"} patch
        </button>
        <small>Stored with this jam.</small>
      </details>
    </div>
  );
  const knobs = (
    def: SoundDefinition,
    values: Record<string, number>,
    fx?: Effect,
  ) => (
    <div className="knob-bank">
      {def.parameters
        .filter((param) => advanced || !param.advanced)
        .map((param) => {
          const target = fx ? `fx.${fx.id}.${param.id}` : `synth.${param.id}`;
          return (
            <Knob
              key={param.id}
              label={fx ? `${def.name} ${param.name}` : param.name}
              value={values[param.id]}
              defaultValue={param.default}
              disabled={disabled}
              modulated={routes.some((m) => m.target === target && m.enabled)}
              automated={p.automation.some(
                (a) =>
                  a.trackId === track.id && a.parameter === target && a.enabled && (a.clipId === null || a.clipId === clip?.id),
              )}
              onCommit={(value, base) =>
                void client.edit(
                  fx
                    ? [
                        {
                          type: "fx.put",
                          trackId: track.id,
                          effect: {
                            ...fx,
                            presetId: undefined,
                            values: { ...fx.values, [param.id]: value },
                          },
                        },
                      ]
                    : [
                        {
                          type: "synth.parameter",
                          trackId: track.id,
                          parameter: param.id,
                          value,
                        },
                      ],
                  "Change " + param.name,
                  base,
                )
              }
            />
          );
        })}
    </div>
  );
  const targets = [
    ...(d?.parameters ?? []).map((param) => ({
      id: "synth." + param.id,
      name: d!.name + " · " + param.name,
    })),
    ...rack.flatMap((fx) =>
      (definition("effect", fx.definitionId, fx.version)?.parameters ?? []).map(
        (param) => ({
          id: `fx.${fx.id}.${param.id}`,
          name: `${definition("effect", fx.definitionId)!.name} ${rack.indexOf(fx) + 1} · ${param.name}`,
        }),
      ),
    ),
  ];
  const available = targets.filter(
      (t) => !routes.some((m) => m.target === t.id),
    ),
    target = available.some((t) => t.id === destination)
      ? destination
      : available[0]?.id;
  return (
    <section
      className={`sound-lab ${accent(track.slot)}`}
      aria-label="Sound Lab"
    >
      <header className="lab-heading">
        <div>
          <span className="eyebrow">
            SOUND LAB / {String(track.slot).padStart(2, "0")}
          </span>
          <h2>
            {track.name}
            <span>✳</span>
          </h2>
          <p>
            {d?.description ??
              (source
                ? "Unavailable instrument version. Your sound is retained; playback is silent."
                : "Shape this track with a serial effects rack.")}
          </p>
        </div>
        <span className="lab-source">{source ? "SYNTH" : "SAMPLE / CODE"}</span>
      </header>
      <nav className="lab-tabs" aria-label="Sound Lab sections">
        {["Notes", "Instrument", "FX", "Motion"].map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
            {name === "FX" && <small>{rack.length}</small>}
            {name === "Motion" && <small>{routes.length}</small>}
          </button>
        ))}
      </nav>
      {tab === "Instrument" && (
        <div className="lab-instrument">
          <label>
            Instrument
            <select
              aria-label="Synth instrument"
              value={source?.definitionId ?? ""}
              disabled={disabled || clip?.kind !== "steps"}
              onChange={(e) =>
                edit(
                  [
                    {
                      type: "source.set",
                      trackId: track.id,
                      source: synthSource(e.target.value),
                    },
                  ],
                  "Change instrument",
                )
              }
            >
              <option value="" disabled>
                Choose a synth
              </option>
              {source && !d && (
                <option value={source.definitionId}>
                  Unavailable: {source.definitionId} v{source.version}
                </option>
              )}
              {instruments.map((i) => (
                <option value={i.id} key={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          {d && source && (
            <>
              {patchControls(d, source.values, source.presetId)}
              {knobs(d, source.values)}
              {d.parameters.some((param) => param.advanced) && (
                <button
                  className="text-button"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  {advanced ? "Less" : "Advanced"} controls
                </button>
              )}
              <p className="control-hint">
                Drag up · Shift for fine control · arrow keys to adjust ·
                release to hear the change.
              </p>
            </>
          )}
        </div>
      )}
      {tab === "Notes" && (
        <div className="lab-notes">
          <h3>Give it a phrase.</h3>
          {source && clip?.kind === "steps" ? (
            <>
              <p>
                One MIDI note per pad. C2 = 36, C3 = 48. Silent pads keep their
                pitch.
              </p>
              <EditableText
                label="Note sequence"
                maxLength={512}
                value={(clip.notes ?? clip.steps.map(() => 36)).join(" ")}
                disabled={disabled}
                onCommit={(value, base) => {
                  const notes = value.split(/\s+/).map(Number);
                  if (
                    notes.length !== clip.steps.length ||
                    notes.some((n) => !Number.isInteger(n) || n < 0 || n > 127)
                  ) {
                    client.report("Enter one MIDI note (0–127) per pad.");
                    return;
                  }
                  void client.edit(
                    [
                      {
                        type: "notes.set",
                        clipId: clip.id,
                        notes,
                        octave: clip.octave ?? 0,
                      },
                    ],
                    "Change note sequence",
                    base,
                  );
                }}
              />
              <Range
                label="Octave"
                value={clip.octave ?? 0}
                min={-4}
                max={4}
                step={1}
                disabled={disabled}
                onCommit={(octave, base) =>
                  void client.edit(
                    [
                      {
                        type: "notes.set",
                        clipId: clip.id,
                        notes: clip.notes ?? clip.steps.map(() => 36),
                        octave,
                      },
                    ],
                    "Change octave",
                    base,
                  )
                }
              />
              <Range
                label="Note length"
                value={clip.parameters.legato ?? 4}
                min={0.1}
                max={16}
                step={0.1}
                unit="×"
                disabled={disabled}
                onCommit={(value, base) =>
                  void client.edit(
                    [
                      {
                        type: "parameter.set",
                        clipId: clip.id,
                        parameter: "legato",
                        value,
                      },
                    ],
                    "Change note length",
                    base,
                  )
                }
              />
              <p>
                Longer notes give envelopes room to ring. Mono bass notes cut
                the previous voice and glide from its pitch.
              </p>
            </>
          ) : (
            <p>
              Select a synth rhythm to edit its pitch sequence. The pads above
              control rhythm.
            </p>
          )}
        </div>
      )}
      {tab === "FX" && (
        <div className="lab-rack">
          <div className="signal-flow">
            Source <span>→</span> Insert FX <span>→</span> Channel{" "}
            <span>→</span> Master
          </div>
          {rack.map((fx, i) => {
            const def = definition("effect", fx.definitionId, fx.version);
            return (
              <article
                className={`rack-unit ${fx.enabled ? "" : "bypassed"}`}
                key={fx.id}
              >
                <header>
                  <span className="rack-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3>
                    {def?.name ?? fx.definitionId}
                    <small>{def?.category ?? "Unavailable · bypassed"}</small>
                  </h3>
                  <button
                    role="switch"
                    aria-checked={fx.enabled}
                    aria-label={`${def?.name ?? fx.definitionId} enabled`}
                    disabled={disabled}
                    onClick={() =>
                      edit(
                        [
                          {
                            type: "fx.put",
                            trackId: track.id,
                            effect: { ...fx, enabled: !fx.enabled },
                          },
                        ],
                        "Bypass effect",
                      )
                    }
                  >
                    {fx.enabled ? "On" : "Bypass"}
                  </button>
                  <button
                    aria-label={`Move effect ${i + 1} earlier`}
                    disabled={disabled || i === 0}
                    onClick={() => {
                      const ids = rack.map((f) => f.id);
                      [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                      edit(
                        [{ type: "fx.order", trackId: track.id, ids }],
                        "Reorder effects",
                      );
                    }}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move effect ${i + 1} later`}
                    disabled={disabled || i === rack.length - 1}
                    onClick={() => {
                      const ids = rack.map((f) => f.id);
                      [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                      edit(
                        [{ type: "fx.order", trackId: track.id, ids }],
                        "Reorder effects",
                      );
                    }}
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`Remove effect ${i + 1}`}
                    title="Remove this effect and its automation and modulation. Undo restores all three."
                    disabled={disabled}
                    onClick={() =>
                      edit(
                        [
                          {
                            type: "fx.remove",
                            trackId: track.id,
                            effectId: fx.id,
                          },
                        ],
                        "Remove effect",
                      )
                    }
                  >
                    ×
                  </button>
                </header>
                {def && (
                  <>
                    {knobs(def, fx.values, fx)}
                    {patchControls(def, fx.values, fx.presetId, fx)}
                  </>
                )}
              </article>
            );
          })}
          <div className="add-effect">
            <select
              aria-label="Effect to add"
              value={fxChoice}
              onChange={(e) => setFxChoice(e.target.value)}
            >
              {effects.map((e) => (
                <option value={e.id} key={e.id}>
                  {e.category} / {e.name}
                </option>
              ))}
            </select>
            <button
              disabled={disabled || rack.length >= 8}
              onClick={() => {
                const d = definition("effect", fxChoice)!;
                edit(
                  [
                    {
                      type: "fx.put",
                      trackId: track.id,
                      effect: {
                        id: crypto.randomUUID(),
                        definitionId: d.id,
                        version: d.version,
                        values: defaults(d),
                        enabled: true,
                      },
                    },
                  ],
                  "Add " + d.name,
                );
              }}
            >
              + Add effect
            </button>
          </div>
        </div>
      )}
      {tab === "Motion" && (
        <div className="lab-motion">
          <h3>A little movement goes a long way.</h3>
          <p>
            Sound modulation runs in the audio engine. Depth offsets the base or
            composition value.
          </p>
          {routes.map((route) => (
            <article className="motion-route" key={route.id}>
              <header>
                <span className="motion-wave">∿</span>
                <strong>
                  {route.source === "lfo" ? "LFO" : route.source} →{" "}
                  {targets.find((t) => t.id === route.target)?.name ??
                    route.target}
                </strong>
                <button
                  role="switch"
                  aria-label={`Enable modulation ${route.id}`}
                  aria-checked={route.enabled}
                  disabled={disabled}
                  onClick={() =>
                    edit(
                      [
                        {
                          type: "modulation.put",
                          trackId: track.id,
                          route: { ...route, enabled: !route.enabled },
                        },
                      ],
                      "Toggle modulation",
                    )
                  }
                >
                  {route.enabled ? "On" : "Off"}
                </button>
              </header>
              <Range
                label="Modulation depth"
                value={route.amount}
                min={-1}
                max={1}
                disabled={disabled}
                onCommit={(amount, base) =>
                  void client.edit(
                    [
                      {
                        type: "modulation.put",
                        trackId: track.id,
                        route: { ...route, amount },
                      },
                    ],
                    "Change modulation depth",
                    base,
                  )
                }
              />
              <Range
                label="Modulation rate"
                value={route.rate}
                min={0.02}
                max={20}
                step={0.02}
                unit=" Hz"
                disabled={disabled}
                onCommit={(rate, base) =>
                  void client.edit(
                    [
                      {
                        type: "modulation.put",
                        trackId: track.id,
                        route: { ...route, rate },
                      },
                    ],
                    "Change modulation rate",
                    base,
                  )
                }
              />
              <button
                disabled={disabled}
                onClick={() =>
                  edit(
                    [
                      {
                        type: "modulation.remove",
                        trackId: track.id,
                        routeId: route.id,
                      },
                    ],
                    "Remove modulation",
                  )
                }
              >
                Remove modulation
              </button>
            </article>
          ))}
          <div className="motion-assignment">
            <select
              aria-label="Modulation source"
              value={motionSource}
              onChange={(e) =>
                setMotionSource(e.target.value as typeof motionSource)
              }
            >
              <option value="lfo">LFO / sine</option>
              <option value="random">Random / hold</option>
              <option value="envelope">Envelope pulse</option>
            </select>
            <span>→</span>
            <select
              aria-label="Modulation destination"
              value={target ?? ""}
              onChange={(e) => setDestination(e.target.value)}
            >
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              disabled={disabled || !target || routes.length >= 16}
              onClick={() =>
                edit(
                  [
                    {
                      type: "modulation.put",
                      trackId: track.id,
                      route: {
                        id: crypto.randomUUID(),
                        target,
                        source: motionSource,
                        amount: 0.2,
                        rate: 1,
                        enabled: true,
                      },
                    },
                  ],
                  "Add modulation",
                )
              }
            >
              + Add motion
            </button>
          </div>
          {clip?.kind === "steps" && (
            <MotionEditor
              project={p}
              track={track}
              clip={clip}
              disabled={disabled}
            />
          )}
        </div>
      )}
    </section>
  );
}
