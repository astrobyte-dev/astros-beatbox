import { useRef, useState } from "react";
import type { ProjectDocument, Track, Clip, Parameter, ProjectEdit } from "../../src/project";
import type { StudioState } from "../../src/studio-client";
import { client } from "./session";
import { EditableText, Range } from "./controls";

export function Composition({ state, disabled, performing, onPerform }: { state: StudioState; disabled: boolean; performing: boolean; onPerform: () => void }) {
  const p = state.project, live = state.projectRuntime.performance;
  const selected = p.scenes.find(s => s.id === state.workspace.selectedSceneId) ?? p.scenes.find(s => s.id === p.sceneOrder[0])!;
  const heading = useRef<HTMLHeadingElement>(null);
  const move = (ids: string[], id: string, direction: number) => { const next = [...ids], i = next.indexOf(id), j = i + direction; if (j >= 0 && j < next.length) [next[i], next[j]] = [next[j], next[i]]; return next; };
  const duplicate = () => { const id = crypto.randomUUID(); void client.edit([{ type: "scene.duplicate", sceneId: selected.id, newSceneId: id, name: selected.name + " copy" }, { type: "scene.activate", sceneId: id }], "Duplicate scene"); };
  const launch = (sceneId: string, repeat = false) => void client.command({ cmd: "scene.launch", sceneId, boundary: "cycle", repeat }, "Queue scene");
  const name = (id: string | null | undefined) => p.scenes.find(s => s.id === id)?.name ?? "Section";
  return <section className="composition" aria-label="Composition and performance">
    <div className="composition-heading"><h2 ref={heading} tabIndex={-1}>Your sections</h2><button aria-pressed={performing} onClick={onPerform}>{performing ? "Back to editing" : "Perform"}</button></div>
    <p className="performance-status" role="status">{live?.clock === "unavailable" ? "Musical clock unavailable · playback position unconfirmed" : live?.queuedSceneId ? `${name(live.queuedSceneId)} · Next cycle` : live?.ended ? "Arrangement finished · silence" : live?.sceneId ? `${name(live.sceneId)} · Current${live.repeat ? ` · repeat ${live.repeat}` : ""}` : "Choose a section. Launch when you’re ready."}</p>
    <div className="scene-strip">
      {p.sceneOrder.map(id => { const scene = p.scenes.find(s => s.id === id)!, silence = p.tracks.some(t => !scene.clips[t.id]); return <div className={`scene-card ${selected.id === id ? "selected" : ""}`} key={id}>
        <button className="scene-name" disabled={disabled} aria-pressed={selected.id === id} aria-label={`${performing ? "Perform" : "Edit"} scene ${scene.name}`} onClick={() => performing ? launch(id) : void client.edit([{ type: "scene.activate", sceneId: id }], "Select scene")}>{scene.name}</button>
        <span>{live?.queuedSceneId === id ? "Next cycle" : live?.sceneId === id ? "Current" : selected.id === id ? "Editing" : "Ready"}{silence ? " · intentional silence" : ""}</span>
        <button disabled={disabled || live?.queuedSceneId === id} aria-label={`Launch ${scene.name}`} onClick={() => launch(id)}>↗ Launch</button>
      </div>; })}
      <button className="add-scene" disabled={disabled} onClick={() => { const id = crypto.randomUUID(); void client.edit([{ type: "scene.create", sceneId: id, name: "New section" }, { type: "scene.activate", sceneId: id }], "Create scene"); }}>+ Section</button>
    </div>
    {!performing && <div className="scene-tools">
      <EditableText label="Scene name" value={selected.name} disabled={disabled} onCommit={(name, base) => void client.edit([{ type: "scene.rename", sceneId: selected.id, name }], "Rename scene", base)} />
      <button disabled={disabled} onClick={duplicate}>Duplicate scene</button>
      <button disabled={disabled} onClick={() => void client.edit([{ type: "scene.capture", sceneId: selected.id }], "Capture scene")}>Capture editing rhythm</button>
      <button disabled={disabled || p.sceneOrder[0] === selected.id} aria-label="Move scene earlier" onClick={() => void client.edit([{ type: "scene.order", ids: move(p.sceneOrder, selected.id, -1) }], "Reorder scenes")}>←</button>
      <button disabled={disabled || p.sceneOrder.at(-1) === selected.id} aria-label="Move scene later" onClick={() => void client.edit([{ type: "scene.order", ids: move(p.sceneOrder, selected.id, 1) }], "Reorder scenes")}>→</button>
      <button disabled={disabled || p.scenes.length === 1} onClick={async () => { if (await client.edit([{ type: "scene.delete", sceneId: selected.id }], "Delete scene")) heading.current?.focus(); }}>Delete scene</button>
    </div>}
    <div className="performance-actions"><button disabled={disabled} onClick={() => launch(selected.id, true)}>Repeat {selected.name}</button><button disabled={disabled} onClick={() => void client.command({ cmd: "stop" }, "Stop performance")}>Stop performance</button><button disabled={disabled} onClick={() => void client.command({ cmd: "performance.return" }, "Return to editing rhythm")}>Hear editing rhythm</button></div>
    {live?.mode !== "manual" && live && state.projectRuntime.appliedRevision !== p.revision && <p className="notice">Your edits are saved in this jam. Relaunch a section or the arrangement to hear the updated composition. Mix and tempo changes are live.</p>}
    <details className="arrangement" open={performing || undefined}><summary>Arrange your sections <span>{p.arrangement.reduce((n, e) => n + e.cycles, 0)} cycles</span></summary>
      <p>Each repeat lasts one cycle · {p.tempo.beatsPerCycle} beats. Sections play in this order.</p>
      <ol className="arrangement-entries">{p.arrangement.map((entry, i) => <li key={entry.id} className={live?.entryId === entry.id ? "current" : ""}>
        <span>{i + 1}. {name(entry.sceneId)}{live?.entryId === entry.id ? " · Current" : ""}</span>
        <Repeats project={p} entryId={entry.id} index={i} disabled={disabled} />
        <button disabled={disabled || i === 0} aria-label={`Move entry ${i + 1} earlier`} onClick={() => void client.edit([{ type: "arrangement.set", entries: move(p.arrangement.map(a => a.id), entry.id, -1).map(id => p.arrangement.find(a => a.id === id)!) }], "Reorder arrangement")}>←</button>
        <button disabled={disabled || i === p.arrangement.length - 1} aria-label={`Move entry ${i + 1} later`} onClick={() => void client.edit([{ type: "arrangement.set", entries: move(p.arrangement.map(a => a.id), entry.id, 1).map(id => p.arrangement.find(a => a.id === id)!) }], "Reorder arrangement")}>→</button>
        <button disabled={disabled} aria-label={`Remove entry ${i + 1}`} onClick={() => void client.edit([{ type: "arrangement.set", entries: p.arrangement.filter(a => a.id !== entry.id) }], "Remove arrangement entry")}>×</button>
      </li>)}</ol>
      <div className="performance-actions"><button disabled={disabled} onClick={() => void client.edit([{ type: "arrangement.set", entries: [...p.arrangement, { id: crypto.randomUUID(), sceneId: selected.id, cycles: 4 }] }], "Add section to arrangement")}>+ Add {selected.name}</button>
      <label><input type="checkbox" checked={p.arrangementLoop !== false} disabled={disabled} onChange={e => void client.edit([{ type: "arrangement.loop", enabled: e.target.checked }], "Loop arrangement")} /> Loop arrangement</label>
      <button className="primary" disabled={disabled || !p.arrangement.length} onClick={() => void client.command({ cmd: "song.start" }, "Play arrangement")}>Play arrangement</button>
      <button disabled={disabled || !state.projectRuntime.song} onClick={() => void client.command({ cmd: "song.stop" }, "Stop arrangement")}>Stop arrangement</button></div>
    </details>
    {!performing && <details className="scene-tracks"><summary>Section instruments & silence</summary>{p.tracks.map(t => <label key={t.id}>{t.name}<select aria-label={`${t.name} scene clip`} value={selected.clips[t.id] ?? ""} disabled={disabled} onChange={e => { const scene = { ...selected, clips: { ...selected.clips, [t.id]: e.target.value || null } }; void client.edit([{ type: "scene.put", scene }, { type: "scene.activate", sceneId: scene.id }], "Change scene instrument"); }}><option value="">Intentional silence</option>{p.clips.filter(c => c.trackId === t.id).map(c => <option key={c.id} value={c.id}>{c.name} · {c.kind === "code" ? "Code" : "Rhythm"}</option>)}</select></label>)}</details>}
  </section>;
}

function Repeats({ project: p, entryId, index, disabled }: { project: ProjectDocument; entryId: string; index: number; disabled: boolean }) {
  const entry = p.arrangement.find(e => e.id === entryId)!;
  const [draft, setDraft] = useState<string | null>(null);
  const base = useRef(client.base());
  return <label>Repeats<input aria-label={`Entry ${index + 1} repeats`} type="number" min={1} max={128} value={draft ?? entry.cycles} disabled={disabled}
    onFocus={() => { base.current = client.base(); }} onChange={e => setDraft(e.target.value)}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
    onBlur={() => { if (draft !== null) { const cycles = +draft; if (Number.isInteger(cycles) && cycles >= 1 && cycles <= 128) void client.edit([{ type: "arrangement.set", entries: p.arrangement.map(e => e.id === entryId ? { ...e, cycles } : e) }], "Set arrangement repeats", base.current); else client.report("Choose 1–128 repeats."); } setDraft(null); }} /></label>;
}

const parameters: [Parameter, string][] = [["cutoff", "Tone"], ["room", "Room"], ["pan", "Pan"], ["gain", "Musical gain"], ["shape", "Shape"], ["delay", "Delay"], ["speed", "Speed"], ["legato", "Legato"], ["resonance", "Resonance"], ["size", "Size"], ["crush", "Crush"], ["sustain", "Sustain"]];
export function MotionEditor({ project: p, track, clip, disabled }: { project: ProjectDocument; track: Track; clip: Clip; disabled: boolean }) {
  const [parameter, setParameter] = useState<Parameter>("room");
  if (clip.kind !== "steps") return null;
  const lanes = p.automation.filter(a => a.trackId === track.id && (a.clipId === null || a.clipId === clip.id));
  const add = (values: number[]) => { const existing = lanes.find(a => a.parameter === parameter && a.clipId === clip.id); void client.edit([{ type: "automation.put", automation: { id: existing?.id ?? crypto.randomUUID(), trackId: track.id, clipId: clip.id, parameter, enabled: true, bars: existing?.bars ?? 4, values } }], "Apply automation gesture"); };
  return <details className="inspector-details"><summary>Motion <span>{lanes.filter(a => a.enabled).length} active</span></summary>
    <p>Make a control move with this clip. Stored base values stay available when motion is off. Motion uses stepped values.</p>
    <label>Control<select aria-label="Motion control" value={parameter} onChange={e => setParameter(e.target.value as Parameter)}>{parameters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className="performance-actions"><button disabled={disabled} onClick={() => add([0, 0.2, 0.4, 0.6, 0.8, 1])}>Rise</button><button disabled={disabled} onClick={() => add([1, 0.8, 0.6, 0.4, 0.2, 0])}>Fall</button><button disabled={disabled} onClick={() => add([0, 0.5, 1, 0.5, 0])}>Swell</button></div>
    {lanes.map(a => <fieldset key={a.id} className="motion-lane"><legend>{parameters.find(([key]) => key === a.parameter)?.[1]} · {a.clipId ? "this clip" : "all visual clips"}</legend>
      {a.clipId === null && lanes.some(b => b.parameter === a.parameter && b.clipId === clip.id && b.enabled) && <p>Overridden by this clip’s motion.</p>}
      <label><input type="checkbox" checked={a.enabled} disabled={disabled} onChange={e => void client.edit([{ type: "automation.put", automation: { ...a, enabled: e.target.checked } }], "Toggle automation")} /> Active</label>
      <Range label={`${a.parameter} motion cycles`} value={a.bars} min={1} max={64} step={1} disabled={disabled} onCommit={(bars, base) => void client.edit([{ type: "automation.put", automation: { ...a, bars } }], "Automation duration", base)} />
      <svg viewBox="0 0 100 30" role="img" aria-label={`${a.parameter} motion curve`}><polyline fill="none" stroke="currentColor" strokeWidth="2" points={a.values.map((v, i) => `${i * 100 / (a.values.length - 1)},${29 - v * 28}`).join(" ")} /></svg>
      <button disabled={disabled} onClick={() => void client.edit([{ type: "automation.delete", automationId: a.id }], "Remove automation")}>Remove motion</button>
    </fieldset>)}
  </details>;
}

export function CodeEditor({ project: p, clip, disabled }: { project: ProjectDocument; clip: Clip; disabled: boolean }) {
  const [draft, setDraft] = useState(clip.kind === "code" ? clip.draft ?? clip.source : "");
  const base = useRef(client.base());
  if (clip.kind !== "code") return null;
  if (!clip.managed) return <p className="code-explanation">Raw session code · original source preserved. Use the classic console; musical synchronization is bounded.</p>;
  return <details className="inspector-details code-editor" open><summary>Managed code</summary><p>A Tidal pattern expression. Routing and channel mix stay independent. Save a draft, then prepare and apply it.</p>
    <textarea aria-label="Managed Tidal source" value={draft} spellCheck={false} disabled={disabled} onFocus={() => { base.current = client.base(); }} onChange={e => setDraft(e.target.value)} />
    <button disabled={disabled} onClick={() => void client.edit([{ type: "code.draft", clipId: clip.id, source: draft }], "Save code draft", base.current)}>Save draft</button>
    <button disabled={disabled || !clip.draft} onClick={() => void client.command({ cmd: "code.apply", clipId: clip.id }, "Prepare and apply code")}>Prepare & apply</button>
    {clip.draft !== undefined && <p>Saved draft retained until successfully applied.</p>}
    <fieldset><legend>Declared dependencies</legend>{p.dependencies.map(d => <label key={d.id}><input type="checkbox" checked={clip.dependencyIds.includes(d.id)} disabled={disabled} onChange={e => void client.edit([{ type: "clip.put", clip: { ...clip, dependencyIds: e.target.checked ? [...clip.dependencyIds, d.id] : clip.dependencyIds.filter(id => id !== d.id) } }], "Code dependencies")} />{d.name} {d.version}</label>)}{!p.dependencies.length && <p>No declarations. Project dependencies can be added through the structured project API; retained source is never executed automatically.</p>}</fieldset>
  </details>;
}
export function addCodeTrack(p: ProjectDocument, sceneId: string): ProjectEdit[] {
  const slot = Array.from({ length: 12 }, (_, i) => i + 1).find(slot => !p.tracks.some(t => t.slot === slot));
  if (!slot) throw new Error("All managed channels are in use");
  const trackId = crypto.randomUUID(), clipId = crypto.randomUUID(), scene = p.scenes.find(s => s.id === sceneId)!;
  return [{ type: "track.add", track: { id: trackId, slot, channel: slot - 1, name: "Code instrument", activeClipId: clipId, mixer: { level: 1, balance: 0, mute: false, solo: false } } }, { type: "clip.put", clip: { id: clipId, trackId, kind: "code", managed: true, name: "Code", source: "silence", dependencyIds: [] } }, { type: "scene.put", scene: { ...scene, clips: { ...scene.clips, [trackId]: clipId } } }];
}
