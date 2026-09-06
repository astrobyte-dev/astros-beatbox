import { client, useProject } from "./session";

export function Recordings() {
  const state = useProject()!;
  return <div className="library-content recording-library">
    <span className="eyebrow">YOU MADE THESE</span><h3>Your recordings</h3>
    <p>Saved on this computer. Kept when you Undo or open another jam.</p>
    {state.recordingWarning && <p role="alert">{state.recordingWarning}</p>}
    {!state.recordings?.length && <p>Press Record, play your groove, then Finish. Your take will be here.</p>}
    <ul className="recording-list">{state.recordings?.map(r => <li key={r.id} data-recording-id={r.id}>
      <h4>{r.name}</h4><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
      <span className={`take-state take-${r.state}`}>{r.state === "ready" ? "Ready to keep" : r.state}</span>
      {r.error && <p role="alert">{r.error}</p>}
      {r.state === "ready" && <>
        <small>{r.audio?.duration.toFixed(1)} seconds · WAV · {Math.round((r.audio?.sampleRate ?? 0) / 1000)} kHz</small>
        {r.audio?.peak === 0 && <p>This take contains silence.</p>}
        <audio controls preload="none" aria-label={`Play recording ${r.name}`} src={`/recordings/${r.id}.wav`} onError={() => client.report("This recording could not be played. Refresh recordings to check its file.")} />
        <a className="download-recording" href={`/recordings/${r.id}.wav?download=1`} download>Download WAV ↗</a>
      </>}
    </li>)}</ul>
    <button className="text-button" onClick={() => void client.refresh()}>Refresh recordings</button>
  </div>;
}
