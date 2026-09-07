import { useEffect, useMemo, useState } from "react";
import type { Track } from "../../src/project";
import type { LibrarySound } from "../../src/sound-library";
import { client, useProject, useConnection, trackName, accent } from "./session";

export function SoundLibrary({ track }: { track?: Track }) {
  const state = useProject()!, connection = useConnection();
  const [sounds, setSounds] = useState<LibrarySound[]>([]), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [bank, setBank] = useState("sd"), [count, setCount] = useState(30);
  const [candidate, setCandidate] = useState<LibrarySound | null>(null);
  const load = async () => {
    try { const r = await fetch("/sounds", { cache: "no-store" }); if (!r.ok) throw new Error("Sound library unavailable"); setSounds(await r.json()); setError(""); }
    catch { setError("Sounds could not be listed. Try Refresh sounds."); }
  };
  useEffect(() => { void load(); }, []);
  const banks = useMemo(() => [...new Set(sounds.map(s => s.bank))], [sounds]);
  const filtered = sounds.filter(s => (!bank || bank === s.bank) && `${s.label} ${s.file} ${s.bank}`.toLowerCase().includes(search.toLowerCase()));
  const clip = state.project.clips.find(c => c.id === track?.activeClipId);
  const current = clip?.kind === "steps" ? state.project.assets.find(a => a.id === clip.assetId) : undefined;
  const disabled = !connection.connected || !!connection.busy;
  return <div className="library-content sound-browser">
    <div className={`sound-target ${accent(track?.slot ?? 1)}`}>
      <span className="eyebrow">CHOOSING FOR</span>
      <h3>{track ? trackName(track.name, track.slot) : "Select an instrument"}</h3>
      <p>{track?.source?.type === "synth" ? "Synth source · choosing a sample changes this track to samples." : current?.audio ? `${current.audio.originalName} · My Sounds` : current ? `${current.name} · ${current.source?.file.split("/")[1] ?? `sample ${current.index + 1}`}` : "Select a visual rhythm to replace its sound."}</p>
      {track?.source?.type !== "synth" && current && state.assets.find(a => a.id === current.id)?.status === "missing" && <p role="alert">Missing sound. Your rhythm is kept.</p>}
    </div>
    <p>Preview a sound, then put it in your groove.</p>
    <label className="sound-filter">Sound bank<select aria-label="Sound bank" value={bank} onChange={e => { setBank(e.target.value); setCount(30); }}><option value="">All banks</option>{banks.map(b => <option key={b} value={b}>{b}</option>)}</select></label>
    <label className="sound-filter">Find a sound<input aria-label="Find a sound" type="search" value={search} onChange={e => { setSearch(e.target.value); setCount(30); }} placeholder="Name or filename" /></label>
    {error && <p role="alert">{error}</p>}
    <div className="sound-choice">
      <span>{candidate?.label ?? "Choose a sound below"}</span>
      {candidate && <small>{candidate.bank} / {candidate.file}</small>}
      <button className="primary" disabled={disabled || !candidate || clip?.kind !== "steps"} onClick={() => { if (candidate && clip) void client.command({ cmd: "sound.replace", clipId: clip.id, value: candidate.key }, "Replace sound"); }}>Replace{track ? ` ${trackName(track.name, track.slot)}` : " sound"}</button>
      <small>Rhythm, velocity and effects stay yours. Undo any time.</small>
    </div>
    <div role="status" className="preview-status">{state.preview?.state === "previewing" ? "Previewing · outside your recording" : state.preview?.state === "preparing" ? "Preparing audio…" : "Preview does not change your jam"}</div>
    {state.preview?.state === "unavailable" && <p role="alert">{state.preview.error}</p>}
    {state.preview?.state === "previewing" && <button disabled={disabled} onClick={() => void client.command({ cmd: "preview.stop" }, "Stop preview")}>Stop preview</button>}
    <ul className="sound-results" aria-label="Available sounds">{filtered.slice(0, count).map(s => <li key={s.key}><button aria-label={`Preview ${s.label} ${s.file}`} aria-pressed={candidate?.key === s.key} disabled={disabled} onClick={() => { setCandidate(s); void client.command({ cmd: "preview.play", value: s.key }, "Preview"); }}><span className="preview-symbol" aria-hidden="true">▷</span><span>{s.label}<small>{s.file}</small></span><span className="preview-word">Preview</span></button></li>)}</ul>
    {!filtered.length && <div className="library-empty"><p>{sounds.length ? "No sounds match this search." : "No installed sounds found. Check your sound library setup in System."}</p>{sounds.length ? <button onClick={() => { setSearch(""); setBank(""); }}>Clear sound filters</button> : <a href="/system">Open System →</a>}</div>}
    {filtered.length > count && <button onClick={() => setCount(count + 30)}>More sounds ({filtered.length - count})</button>}
    <button className="text-button" onClick={() => void load()}>Refresh sounds</button>
    <small className="library-source">Dirt-Samples · grouped by its original sound banks</small>
  </div>;
}
