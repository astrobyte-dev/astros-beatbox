import { useEffect, useRef, useState } from "react";
import type { StepClip, ProjectDocument, Track } from "../../src/project";
import type { UserAudioEntry } from "../../src/user-audio";
import { AUDIO_LIMIT, defaultPlayback, type SamplePlayback, type LibraryDetails } from "../../src/sampling";
import type { EditBase } from "../../src/studio-client";
import { client, useProject, useConnection } from "./session";
import { Range } from "./controls";

export function Waveform({ url, start = 0, end = 1 }: { url: string; start?: number; end?: number }) {
  const [peaks, setPeaks] = useState<number[]>([]), [status, setStatus] = useState("Preparing waveform…"), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setPeaks([]); setStatus("Preparing waveform…");
    void fetch(url, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!controller.signal.aborted) { setPeaks(data); setStatus(""); }
    }).catch(() => { if (!controller.signal.aborted) setStatus("Waveform unavailable. Your sound and trim controls remain available."); });
    return () => controller.abort();
  }, [url, attempt]);
  return <div className="waveform-view">
    {status && <p className="waveform-status" role="status">{status}{status.startsWith("Waveform unavailable") && <button className="text-button" onClick={() => setAttempt(attempt + 1)}>Retry waveform</button>}</p>}
    <svg className="sample-wave" viewBox="0 0 512 100" preserveAspectRatio="none" role="img" aria-label={peaks.length ? "Audio waveform with selected region" : status}>
      <rect x={start * 512} y="0" width={(end - start) * 512} height="100" fill="currentColor" opacity=".1" />
      <path d={peaks.map((p, i) => `M${i},${50 - p * 47}V${50 + p * 47}`).join(" ")} stroke="currentColor" strokeWidth="1" />
      <path d={`M${start * 512},0V100 M${end * 512},0V100`} stroke="currentColor" strokeWidth="2" />
    </svg>
  </div>;
}

type ListedSound = UserAudioEntry & { status: string };
export function UserSounds({ track, onSelect, onCapture }: { track?: Track; onSelect: (id: string) => void; onCapture: () => void }) {
  const state = useProject()!, connection = useConnection();
  const [entries, setEntries] = useState<ListedSound[]>([]), [search, setSearch] = useState(""), [filter, setFilter] = useState("All"), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [limit, setLimit] = useState(20);
  const [pending, setPending] = useState<File[]>([]), [relink, setRelink] = useState<string | undefined>();
  const files = useRef<HTMLInputElement>(null), folder = useRef<HTMLInputElement>(null);
  const load = async () => { try { const r = await fetch("/audio/library"); if (!r.ok) throw new Error("Library unavailable"); const data = await r.json(); setEntries(data.entries); if (data.warning) setMessage(data.warning); } catch (e) { setMessage(String(e)); } };
  useEffect(() => { void load(); }, []);
  const disabled = busy || !!connection.busy || !connection.connected;
  const choose = (list: FileList | null) => {
    setPending([]);
    const all = Array.from(list ?? []);
    const accepted = all.filter(f => !((f as File & { webkitRelativePath: string }).webkitRelativePath || f.name).split("/").some(part => part.startsWith(".")) && /\.wav$/i.test(f.name));
    if (all.length > 2000 || accepted.length > 100 || accepted.reduce((n, f) => n + f.size, 0) > 1024 * 1024 * 1024 || accepted.some(f => f.size > AUDIO_LIMIT)) { setMessage("Choose up to 100 WAVs, 256 MiB each and 1 GiB per batch. Larger folders need a smaller selection."); return; }
    setPending(accepted); setMessage(`${accepted.length} WAV files selected; ${all.length - accepted.length} hidden or unsupported files skipped. Review, then import.`);
  };
  const upload = async () => {
    setBusy(true); let added = 0, duplicates = 0; const errors: string[] = [];
    try {
      for (const [i, f] of pending.entries()) {
        setMessage(`Importing ${i + 1} of ${pending.length}: ${f.name} — copying and drawing waveform…`);
        const r = await fetch(`/audio/import?name=${encodeURIComponent(f.name)}${relink ? "&relink=" + relink : ""}`, { method: "POST", headers: { "content-type": "audio/wav", "x-beatbox-session": state.sessionId }, body: f });
        const data = await r.json(); if (!r.ok) errors.push(`${f.name}: ${data.error}`); else data.duplicate ? duplicates++ : added++;
      }
      setPending([]); setRelink(undefined); await load(); await client.refresh(); setMessage(`${added} added · ${duplicates} already owned${errors.length ? " · " + errors.join("; ") : ""}`);
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  };
  const clip = state.project.clips.find(c => c.id === track?.activeClipId);
  const filtered = entries.filter(e => (filter !== "Captured" || e.origin === "captured") && (filter !== "Favorites" || e.details.favorite) && (filter !== "Loops" || e.details.classification === "loop") && `${e.details.name} ${e.metadata.originalName} ${e.details.tags.join(" ")} ${e.details.collection}`.toLowerCase().includes(search.toLowerCase()));
  const useSound = async (e: ListedSound, add: boolean) => { const before = state.project.tracks.map(t => t.id); if (await client.command({ cmd: add ? "audio.add" : "audio.assign", value: e.id, ...(add ? {} : { clipId: clip!.id }) }, add ? "Add sound" : "Assign sound")) { const t = client.getSnapshot()?.project.tracks.find(t => !before.includes(t.id)); if (t) onSelect(t.id); } };
  return <div className="library-content user-sounds">
    <span className="eyebrow">SOUNDS YOU OWN</span><h3>Keep something interesting.</h3>
    <p>WAV · PCM16 mono/stereo · up to 15 min / 256 MiB per sound.</p>
    <div className="sample-actions"><button disabled={disabled} onClick={() => { setRelink(undefined); files.current?.click(); }}>Add Files</button><button disabled={disabled} onClick={() => { setRelink(undefined); folder.current?.click(); }}>Add Folder</button></div>
    <input ref={files} hidden type="file" accept=".wav" multiple={!relink} aria-label="Audio files" onChange={e => { choose(e.target.files); e.target.value = ""; }} />
    <input ref={folder} hidden type="file" {...{ webkitdirectory: "" } as object} multiple aria-label="Audio folder" onChange={e => { choose(e.target.files); e.target.value = ""; }} />
    <p role="status" className="import-progress">{message}</p>
    {!!pending.length && <div className="import-review"><strong>{relink ? "Relink exact original" : `Import ${pending.length} selected sounds`}</strong><small>{pending.slice(0, 4).map(f => f.name).join(" · ")}{pending.length > 4 && "…"}</small><button className="primary" disabled={disabled} onClick={() => void upload()}>Import selected sounds</button><button disabled={busy} onClick={() => { setPending([]); setRelink(undefined); }}>Cancel import</button></div>}
    <label>Browse<select aria-label="My Sounds filter" value={filter} onChange={e => { setFilter(e.target.value); setLimit(20); }}>{["All", "Captured", "Recent", "Favorites", "Loops"].map(f => <option key={f}>{f}</option>)}</select></label>
    <input aria-label="Search My Sounds" type="search" placeholder="Name, tags or collection" value={search} onChange={e => { setSearch(e.target.value); setLimit(20); }} />
    <div className="user-sound-list">{filtered.slice(0, filter === "Recent" ? 10 : limit).map(e => <article className="user-sound-card" key={e.id}>
      <small>{e.origin === "captured" ? "CAPTURED" : "MY SOUND"} · {e.metadata.duration.toFixed(1)}s · {e.details.classification}</small><h4>{e.details.name}</h4>
      <Waveform url={`/audio/sound/${e.id}/wave`} />
      {e.status === "missing" ? <p role="alert">Missing original. Relink the same WAV to restore it.</p> : <button disabled={disabled} onClick={() => void client.command({ cmd: "audio.preview", value: e.id }, "Preview sound")}>▷ Preview {e.details.name}</button>}
      <div className="sample-actions"><button disabled={disabled || e.status === "missing"} onClick={() => void useSound(e, true)}>+ Add track</button><button disabled={disabled || e.status === "missing" || clip?.kind !== "steps"} onClick={() => void useSound(e, false)}>Use on {track?.name ?? "selected track"}</button></div>
      <button className="text-button" disabled={disabled} aria-pressed={e.details.favorite} onClick={async () => { await client.command({ cmd: "audio.details", assetId: e.id, libraryRevision: e.revision, details: { ...e.details, favorite: !e.details.favorite } }, "Favorite sound"); await load(); }}>{e.details.favorite ? "★ Favorited" : "☆ Favorite"}</button>
      <SoundDetails entry={e} disabled={disabled} reload={load} />
      {e.status === "missing" && <button disabled={disabled} onClick={() => { setRelink(e.id); setTimeout(() => files.current?.click(), 0); }}>Relink original WAV</button>}
    </article>)}</div>
    {!filtered.length && <div className="library-empty"><p>{entries.length ? "No sounds match. Try another name or filter." : "Your next sound belongs here. Add a WAV or record something around you."}</p>{entries.length ? <button onClick={() => { setSearch(""); setFilter("All"); }}>Clear sound filters</button> : <button onClick={onCapture}>Open Capture →</button>}</div>}
    {filtered.length > limit && filter !== "Recent" && <button onClick={() => setLimit(limit + 20)}>More sounds</button>}
    <button className="text-button" onClick={() => void load()}>Refresh My Sounds</button>
    <small>Copies stay in Beatbox. Importing and library details do not add musical Undo; assigning a sound does.</small>
  </div>;
}
function SoundDetails({ entry, disabled, reload }: { entry: ListedSound; disabled: boolean; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<LibraryDetails>(entry.details);
  useEffect(() => setDraft(entry.details), [entry.revision]);
  return <details className="sound-details"><summary>Sound details</summary>
    <label>Name<input value={draft.name} maxLength={120} disabled={disabled} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <label>Tags<input value={draft.tags.join(",")} disabled={disabled} onChange={e => setDraft({ ...draft, tags: e.target.value.split(",").slice(0, 16) })} /></label>
    <label>Collection<input value={draft.collection} maxLength={80} disabled={disabled} onChange={e => setDraft({ ...draft, collection: e.target.value })} /></label>
    <label>Kind<select value={draft.classification} disabled={disabled} onChange={e => setDraft({ ...draft, classification: e.target.value as LibraryDetails["classification"] })}><option value="one-shot">One-shot</option><option value="loop">Loop</option></select></label>
    <label>Known BPM (optional)<input type="number" min="20" max="400" value={draft.bpm ?? ""} disabled={disabled} onChange={e => setDraft({ ...draft, bpm: e.target.value ? +e.target.value : null })} /></label>
    <button disabled={disabled || !draft.name.trim()} onClick={async () => { await client.command({ cmd: "audio.details", assetId: entry.id, libraryRevision: entry.revision, details: { ...draft, tags: draft.tags.map(s => s.trim()).filter(Boolean) } }, "Save sound details"); await reload(); }}>Save sound details</button>
    <small>{entry.metadata.originalName} · {entry.metadata.channels === 1 ? "Mono" : "Stereo"} · {entry.metadata.sampleRate} Hz</small>
  </details>;
}

export function SampleEditor({ project, clip, disabled }: { project: ProjectDocument; clip: StepClip; disabled: boolean }) {
  const asset = project.assets.find(a => a.id === clip.assetId)!, v = clip.playback ?? defaultPlayback();
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null), [edge, setEdge] = useState<"start" | "end">("start"), [divisions, setDivisions] = useState(8), [point, setPoint] = useState(0.5);
  const drag = useRef<{ base: EditBase; start: number; end: number } | null>(null);
  const user = asset.source?.origin === "user" || asset.source?.origin === "captured";
  const commit = (patch: Partial<SamplePlayback>, base = client.base()) => void client.edit([{ type: "sample.playback", clipId: clip.id, playback: { ...v, ...patch } }], "Shape sample", base);
  const slices = clip.slices ?? [], mapping = clip.sliceSteps ?? clip.steps.map(() => null);
  const putSlices = (next: typeof slices, nextMapping = mapping.map(id => next.some(s => s.id === id) ? id : null)) => void client.edit([{ type: "sample.slices", clipId: clip.id, slices: next, sliceSteps: nextMapping }], "Edit slices");
  const position = (e: React.PointerEvent<HTMLDivElement>) => { const box = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)); };
  const move = (at: number) => { const g = drag.current; if (!g) return; if (edge === "start") g.start = Math.min(g.end - 0.0001, at); else g.end = Math.max(g.start + 0.0001, at); setTrim({ start: g.start, end: g.end }); };
  return <div className="sample-editor">
    <div className="sample-heading"><div><span className="eyebrow">NON-DESTRUCTIVE SAMPLE</span><h3>{asset.audio?.originalName ?? asset.name}</h3><p>Pitch changes speed and duration. Your original stays intact.</p></div><button disabled={disabled} onClick={() => void client.command({ cmd: "audio.preview", value: asset.id, playback: v }, "Preview shaped sample")}>▷ Preview trim</button></div>
    <div className="trim-modes"><button aria-pressed={edge === "start"} onClick={() => setEdge("start")}>Set start</button><button aria-pressed={edge === "end"} onClick={() => setEdge("end")}>Set end</button><small>Drag on the waveform, or use the controls below.</small></div>
    <div className="trim-wave" onPointerDown={e => { if (disabled) return; drag.current = { base: client.base(), start: v.start, end: v.end }; e.currentTarget.setPointerCapture(e.pointerId); move(position(e)); }} onPointerMove={e => { if (drag.current) move(position(e)); }} onPointerUp={() => { const g = drag.current; if (!g) return; drag.current = null; setTrim(null); commit({ start: g.start, end: g.end }, g.base); }} onPointerCancel={() => { drag.current = null; setTrim(null); }}>
      {user ? <Waveform url={`/audio/sound/${asset.id}/wave`} start={trim?.start ?? v.start} end={trim?.end ?? v.end} /> : <p>Built-in sample · use Start and End to select a region.</p>}
    </div>
    <div className="sample-control-grid">{([ ["Start", "start", 0, v.end - 0.0001, 0.001], ["End", "end", v.start + 0.0001, 1, 0.001], ["Pitch", "pitch", -24, 24, 1], ["Attack", "attack", 0.001, 2, 0.001], ["Release", "release", 0.001, 5, 0.001] ] as const).map(([label, key, min, max, step]) => <Range key={key} precision={4} label={label} value={v[key]} min={min} max={max} step={step} disabled={disabled} unit={key === "pitch" ? " st" : key === "attack" || key === "release" ? " s" : ""} onCommit={(value, base) => commit({ [key]: value }, base)} />)}</div>
    <div className="sample-actions"><button disabled={disabled} aria-pressed={v.reverse} onClick={() => commit({ reverse: !v.reverse })}>Reverse</button><button disabled={disabled} aria-pressed={v.mode === "loop"} onClick={() => commit({ mode: v.mode === "loop" ? "one-shot" : "loop" })}>Loop phrase</button><button disabled={disabled} onClick={() => commit(defaultPlayback())}>Reset sample</button></div>
    {v.mode === "loop" && <><Range label="Loop phrase beats" value={v.beats} min={1} max={64} step={1} disabled={disabled} onCommit={(beats, base) => commit({ beats }, base)} /><p>The pad phrase repeats over {v.beats} beats. Each active pad retriggers its region at the chosen pitch; tempo does not stretch the audio.</p></>}
    <div className="slice-lab"><h3>Chop it up<span>✳</span></h3><p>Regions share the original sound. Preview a chop, then choose it for a rhythm pad.</p>
      <div className="sample-actions"><label>Equal slices<select aria-label="Equal slices" value={divisions} onChange={e => setDivisions(+e.target.value)}>{[2, 4, 8, 16].map(n => <option key={n}>{n}</option>)}</select></label><button disabled={disabled} onClick={() => { const next = Array.from({ length: divisions }, (_, i) => ({ id: crypto.randomUUID(), name: `Chop ${i + 1}`, start: v.start + (v.end - v.start) * i / divisions, end: v.start + (v.end - v.start) * (i + 1) / divisions })); putSlices(next, clip.steps.map((_, i) => next[i % divisions].id)); }}>Chop to pads</button></div>
      <Range label="Slice point" value={point} min={v.start + 0.0001} max={v.end - 0.0001} step={0.001} disabled={disabled} onCommit={value => setPoint(value)} />
      <button disabled={disabled || slices.length >= 16 || point <= v.start || point >= v.end} onClick={() => { const old = slices.find(s => s.start < point && s.end > point); if (old) putSlices(slices.flatMap(s => s.id === old.id ? [{ ...s, end: point }, { id: crypto.randomUUID(), name: "New chop", start: point, end: s.end }] : [s])); else putSlices([...slices, { id: crypto.randomUUID(), name: "New chop", start: point, end: v.end }]); }}>Add slice at point</button>
      <div className="chop-pads">{slices.map((s, i) => <div className="chop-pad" key={s.id}><button disabled={disabled} aria-label={`Preview chop ${i + 1}`} onClick={() => void client.command({ cmd: "audio.preview", value: asset.id, playback: { ...v, start: s.start, end: s.end } }, "Preview chop")}><b>{i + 1}</b>{s.name}<small>{Math.round(s.start * 100)}–{Math.round(s.end * 100)}%</small></button><button disabled={disabled || i === 0} onClick={() => { const next = [...slices]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; putSlices(next); }}>Earlier</button><button disabled={disabled} onClick={() => putSlices(slices.filter(x => x.id !== s.id))}>Remove</button><details><summary>Adjust region</summary><Range label={`Chop ${i + 1} start`} value={s.start} max={s.end - 0.0001} step={0.001} disabled={disabled} onCommit={(start, base) => void client.edit([{ type: "sample.slices", clipId: clip.id, slices: slices.map(x => x.id === s.id ? { ...x, start } : x), sliceSteps: mapping }], "Move slice", base)} /><Range label={`Chop ${i + 1} end`} value={s.end} min={s.start + 0.0001} step={0.001} disabled={disabled} onCommit={(end, base) => void client.edit([{ type: "sample.slices", clipId: clip.id, slices: slices.map(x => x.id === s.id ? { ...x, end } : x), sliceSteps: mapping }], "Move slice", base)} /></details></div>)}</div>
      {!!slices.length && <div className="slice-sequence">{clip.steps.map((_, i) => <label key={i}>Pad {i + 1}<select aria-label={`Slice for pad ${i + 1}`} disabled={disabled} value={mapping[i] ?? ""} onChange={e => putSlices(slices, mapping.map((id, j) => i === j ? e.target.value || null : id))}><option value="">Full trim</option>{slices.map((s, j) => <option value={s.id} key={s.id}>{j + 1} · {s.name}</option>)}</select></label>)}</div>}
    </div>
  </div>;
}

function InputMeter({ ready }: { ready: boolean }) {
  const [level, setLevel] = useState<{ available: boolean; peak: number }>({ available: false, peak: 0 });
  useEffect(() => { if (!ready) return; let stopped = false; let timer: ReturnType<typeof setTimeout>; const poll = async () => { try { const r = await fetch("/audio/input-meter", { signal: AbortSignal.timeout(1500) }); if (r.ok && !stopped) setLevel(await r.json()); } catch { if (!stopped) setLevel({ available: false, peak: 0 }); } if (!stopped) timer = setTimeout(poll, 100); }; void poll(); return () => { stopped = true; clearTimeout(timer); }; }, [ready]);
  return <div className="input-meter"><meter aria-label="Input level" min={0} max={1} high={0.9} optimum={0.35} value={ready && level.available ? level.peak : 0} /><span>{!ready || !level.available ? "Input level unavailable" : level.peak >= 0.98 ? "Clipping — lower input gain" : level.peak < 0.005 ? "Very low / no signal" : "Signal present"}</span></div>;
}
export function CapturePanel({ onSounds }: { onSounds: () => void }) {
  const state = useProject()!, connection = useConnection(), c = state.capture;
  const [name, setName] = useState("My captured sound"), [device, setDevice] = useState(""), [channel, setChannel] = useState(0);
  const disabled = !connection.connected || !!connection.busy;
  return <div className="library-content capture-panel"><span className="eyebrow">FROM THE WORLD TO YOUR GROOVE</span><h3>Heard something?<br />Keep it.</h3><p>Record an input → Keep as Sample → use it in My Sounds. Rec in the top bar records your whole jam.</p>
    <label>Input device<select aria-label="Capture input device" disabled={disabled || !!c?.activeId} value={device} onChange={e => setDevice(e.target.value)}><option value="">Default audio input</option>{state.input?.devices.map(d => <option key={d}>{d}</option>)}</select></label>
    <small>{state.input?.enumeration ? "Device list is available after audio boots. Prepare input restarts audio; stop playback first." : "Beatbox cannot list inputs on this system. It will use the input configured in your audio setup."}</small>
    <label>Input channel<select aria-label="Capture input channel" value={channel} disabled={disabled || !!c?.activeId} onChange={e => setChannel(+e.target.value)}><option value="0">Input 1 (mono)</option><option value="1">Input 2 (mono)</option></select></label>
    <button disabled={disabled || !!c?.activeId} onClick={() => void client.command({ cmd: "capture.prepare", device, channel }, "Prepare input")}>Prepare input</button>
    <p role="status">{c?.inputReady ? `Input ready · ${state.input?.configuration?.device || "default audio input"} · channel ${(state.input?.configuration?.channel ?? 0) + 1}` : "Input is not prepared"}</p>
    <InputMeter ready={!!c?.inputReady} />
    <Range label="Input gain" value={c?.gain ?? 1} max={2} disabled={disabled || !c?.inputReady} onCommit={gain => void client.command({ cmd: "capture.controls", gain, monitor: c?.monitor ?? false }, "Input gain")} />
    <button disabled={disabled || !c?.inputReady} aria-pressed={!!c?.monitor} onClick={() => void client.command({ cmd: "capture.controls", gain: c?.gain ?? 1, monitor: !c?.monitor }, "Monitor input")}>{c?.monitor ? "Monitor ON" : "Monitor OFF"}</button><small>Use headphones when monitoring to avoid feedback.</small>
    <label>Take name<input aria-label="Capture name" value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
    <button className="capture-record primary" disabled={disabled || !c?.inputReady || !name.trim()} onClick={() => void client.command(c?.activeId ? { cmd: "capture.stop", value: c.activeId } : { cmd: "capture.start", value: name }, c?.activeId ? "Finish capture" : "Capture input")}>{c?.activeId ? "■ Stop capture" : "● Record input"}</button>
    <small>Dry input after gain · five-minute maximum. Keep the original, then add Distortion, Reverb or other track FX.</small>
    {c?.warning && <p role="alert">{c.warning}</p>}
    {c?.takes.filter(t => t.state !== "discarded").slice(0, 8).map(t => <article className="capture-take" key={t.id}><h4>{t.name}</h4><p role="status">{t.state}{t.duration ? ` · ${t.duration.toFixed(1)}s` : ""}</p>{t.error && <p role="alert">{t.error}</p>}{["ready", "kept"].includes(t.state) && <Waveform url={`/audio/capture/${t.id}/wave`} />}{t.state === "ready" && <div className="sample-actions"><button disabled={disabled} onClick={() => void client.command({ cmd: "capture.preview", value: t.id }, "Preview take")}>▷ Play take</button><button className="primary" disabled={disabled} onClick={() => void client.command({ cmd: "capture.keep", value: t.id }, "Keep as Sample")}>Keep as Sample</button><button disabled={disabled} onClick={() => void client.command({ cmd: "capture.discard", value: t.id }, "Discard take")}>Discard</button></div>}{t.state === "kept" && <div><p>Kept in My Sounds · ready to play and sequence.</p><button className="primary" onClick={onSounds}>Use this sound →</button></div>}{["failed", "interrupted"].includes(t.state) && <button disabled={disabled} onClick={() => void client.command({ cmd: "capture.discard", value: t.id }, "Discard incomplete take")}>Discard incomplete take</button>}</article>)}
  </div>;
}
