import { useEffect, useRef, useState } from "react";
import type { SystemSnapshot, Component } from "../../src/runtime-health";
import type { LogEntry } from "../../src/runtime-logs";
import { Icon } from "./controls";

const actions = { "audio.restart": "Restart audio", "audio.stop": "Stop audio", "runtime.restart": "Restart services", "runtime.quit": "Quit Astro’s Beatbox" };
type Action = keyof typeof actions;
const time = (value: string | number | null) => value ? new Date(value).toLocaleTimeString() : "Not observed";
const attention = (state: string) => /failed|degraded|unverified|unavailable|attention|conflict/i.test(state);

export function System() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [connected, setConnected] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<Action | null>(null), [confirm, setConfirm] = useState<Action | null>(null);
  const [quit, setQuit] = useState(false), [source, setSource] = useState("all"), [diagnostic, setDiagnostic] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]), [paused, setPaused] = useState(false);
  const [cleared, setCleared] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null), logEnd = useRef<HTMLDivElement>(null), submitting = useRef(false);
  const current = useRef<SystemSnapshot | null>(null);
  const confirmationBase = useRef<{ sessionId: string; generation: number } | null>(null);
  useEffect(() => {
    if (quit) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch("/runtime/health", { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error();
        const s: SystemSnapshot = await r.json();
        if (cancelled) return;
        if (s.schema !== 1) throw new Error();
        if (current.current && current.current.sessionId !== s.sessionId) { setMessage("Beatbox restarted. Review the current state before continuing."); setConfirm(null); setCleared(0); }
        current.current = s; setSnapshot(s); setConnected(true);
      } catch { if (!cancelled) setConnected(false); }
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [quit]);
  useEffect(() => {
    if (quit || paused) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/runtime/logs?source=${source}&after=${cleared}&diagnostic=${diagnostic ? 1 : 0}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (r.ok) { const data = await r.json(); if (!cancelled && data.sessionId === current.current?.sessionId) setLogs(data.entries); }
      } catch { /* Health carries the connection state. */ }
      if (!cancelled) timer = setTimeout(poll, 1200);
    };
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [source, diagnostic, cleared, paused, quit]);
  useEffect(() => { if (!paused && logEnd.current) logEnd.current.scrollTop = logEnd.current.scrollHeight; }, [logs, paused]);
  useEffect(() => {
    if (!confirm || !dialog.current) return;
    const d = dialog.current, previous = document.activeElement as HTMLElement | null;
    d.showModal();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const buttons = [...d.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0], last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    d.addEventListener("keydown", trap);
    return () => { d.removeEventListener("keydown", trap); d.close(); previous?.focus(); };
  }, [confirm]);
  const busy = !!pending || !!snapshot && !["idle", "Complete", "Failed"].includes(snapshot.lifecycle.phase);
  const disabled = !connected || busy || quit;
  async function perform(action: Action) {
    if (submitting.current || !current.current) return;
    submitting.current = true; setPending(action); setConfirm(null); setMessage("");
    const base = confirmationBase.current;
    if (!base) { setPending(null); submitting.current = false; return; }
    try {
      const r = await fetch("/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: action, operationId: crypto.randomUUID(), sessionId: base.sessionId, expectedGeneration: base.generation, issuedAt: Date.now() }), signal: AbortSignal.timeout(180000) });
      const result = await r.json();
      if (current.current?.sessionId !== base.sessionId) throw new Error("This response belongs to a previous runtime. Review current System status.");
      if (!result.ok) throw new Error(result.error);
      setMessage(result.msg);
      if (action === "runtime.quit") { setQuit(true); setConnected(false); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Action was not confirmed. Check System before trying again."); }
    finally { setPending(null); submitting.current = false; }
  }
  function renderComponent(c: Component): React.ReactNode {
    const children = snapshot!.components.filter(item => item.parent === c.id);
    return <li key={c.id}>
      <details className="system-component">
        <summary><span className="service-glyph" aria-hidden="true">{c.id === "runtime" ? "✳" : c.id === "audio" ? "♪" : "·"}</span><span><strong>{c.name}</strong><small>{c.health}</small></span><span className={attention(c.state) ? "service-state attention" : "service-state"}>{c.state}</span></summary>
        <div className="service-detail"><dl><dt>Technology</dt><dd>{c.technical}</dd><dt>Ownership</dt><dd>{c.ownership}</dd><dt>Process ID</dt><dd>{c.pid ?? "Service; no separate process"}</dd><dt>Started / connected</dt><dd>{time(c.startedAt)}</dd><dt>Last transition</dt><dd>{time(c.transitionedAt)}</dd><dt>Restart</dt><dd>{c.restart ? "Restarts with " + (c.restart === "audio.restart" ? "audio" : "services") : "No separate restart"}</dd></dl>{c.error && <p className="system-warning">{c.error}</p>}</div>
      </details>
      {!!children.length && (c.id === "tidal" || c.id === "sclang" ? <details className="system-support"><summary>{children.length} direct supporting {children.length === 1 ? "process" : "processes"} · inspect tree</summary><ul>{children.map(renderComponent)}</ul></details> : <ul>{children.map(renderComponent)}</ul>)}
    </li>;
  }
  const conflicts = snapshot?.ports.filter(p => p.state === "conflict") ?? [];
  const title = quit ? "See you next jam." : !connected ? snapshot ? "Connection lost" : "Connecting to Beatbox" : snapshot!.state;
  return <div className="system-page">
    <a href="#system-main" className="skip-link">Skip to System</a>
    <header className="topbar"><a href="/studio" className="brand" aria-label="Astro's Beatbox studio"><span className="brand-mark">a<span>✳</span></span><span>astro’s<span>beatbox</span></span></a><nav aria-label="Main"><a href="/studio">Studio</a><a href="/system" aria-current="page">System</a></nav><span className="system-local">Your music, on this computer</span></header>
    <main id="system-main" className="system-main">
      <section className="system-hero"><div><p className="eyebrow">SYSTEM / THE INSTRUMENT ROOM</p><h1 aria-live="polite">{title}</h1><p>{quit ? "Beatbox has closed its owned audio services and local server. Launch Beatbox when you’re ready to return." : !connected ? "Waiting for the local runtime. Music may still be running; this page cannot confirm its current state." : "One quiet place to see what’s running and look after your sound."}</p></div><div className="system-art" aria-hidden="true"><i /><i /><i /><i /><i /></div></section>
      <div className="system-actions"><a className="primary" href="/studio">Open Studio <Icon name="arrow" /></a>{(Object.entries(actions) as [Action, string][]).map(([action, label]) => <button key={action} className={action === "runtime.quit" ? "system-quit" : ""} disabled={disabled} onClick={() => { if (snapshot) confirmationBase.current = { sessionId: snapshot.sessionId, generation: snapshot.generation }; setConfirm(action); }}>{pending === action ? "Working…" : label}</button>)}</div>
      <p role="status" className="system-feedback">{message || (busy ? snapshot?.lifecycle.phase : "Closing a browser or assistant connection keeps your jam running.")}</p>
      {snapshot && !quit && <>
        {!!conflicts.length && <section className="system-warning" role="alert"><strong>PORT CONFLICT</strong><p>A required port belongs to another process. Beatbox will leave it running. Inspect its details below, then close it yourself if appropriate.</p></section>}
        {(snapshot.lifecycle.error || snapshot.inspection.error || snapshot.project.recoveryWarning) && <p className="system-warning" role="alert">{snapshot.lifecycle.error || snapshot.inspection.error || snapshot.project.recoveryWarning}</p>}
        <div className={connected ? "system-columns" : "system-columns system-stale"}>
          <section className="system-card"><div className="system-section-title"><div><p className="eyebrow">WHAT’S RUNNING</p><h2>Your Beatbox</h2></div><small>{connected ? "Live" : "Last observed"} · {time(snapshot.at)}</small></div><p className="system-hint">Open a service for process and ownership details.</p><ul className="system-tree">{snapshot.components.filter(c => c.parent === null).map(renderComponent)}</ul></section>
          <div className="system-side">
            <section className="system-card"><p className="eyebrow">SOUND CHECK</p><h2>Audio <span className={attention(snapshot.audio.state) ? "service-state attention" : "service-state"}>{snapshot.audio.state}</span></h2><dl className="system-facts"><dt>Backend</dt><dd>{snapshot.audio.capabilities.backend}</dd><dt>Routing</dt><dd>{snapshot.audio.capabilities.configuration}</dd><dt>Output</dt><dd>{snapshot.audio.device}</dd><dt>Format</dt><dd>{snapshot.audio.sampleRate ? `${snapshot.audio.sampleRate / 1000} kHz · ${snapshot.audio.outputs} channels` : "Available after audio preparation"}</dd><dt>Instruments</dt><dd>{snapshot.audio.orbits ? `${snapshot.audio.orbits} managed stereo channels` : "Not prepared"}</dd><dt>Preview</dt><dd>{snapshot.audio.preview}</dd><dt>Recording</dt><dd>{snapshot.audio.recording}</dd></dl><div className="system-levels" aria-label={snapshot.audio.meterFresh ? "Live output activity" : "Audio activity unavailable"}>{[snapshot.audio.left, snapshot.audio.right].map((v, i) => <label key={i}>{i ? "R" : "L"}<meter min={0} max={1} value={v ?? 0} />{v === null ? "—" : v > 0.001 ? "Active" : "Quiet"}</label>)}</div></section>
            <section className="system-card system-project"><p className="eyebrow">CURRENT JAM</p><h2>{snapshot.project.name}</h2><p>{snapshot.project.saved === "saved" ? "Saved" : "Unsaved changes"} · revision {snapshot.project.revision}</p><dl className="system-facts"><dt>Audio revision</dt><dd>{snapshot.project.appliedRevision ?? "Not applied"}</dd><dt>Recovery</dt><dd>{snapshot.project.recovered ? "Recovered from checkpoint" : "Current session"}</dd></dl><details><summary>Project identity</summary><code>{snapshot.project.id}</code></details><a href="/studio">Open in Studio →</a></section>
          </div>
        </div>
        <section className="system-card system-ports"><details open={conflicts.length > 0}><summary><span><span className="eyebrow">CONNECTIONS</span><strong>Ports & ownership</strong></span><span>{conflicts.length ? `${conflicts.length} need attention` : `${snapshot.ports.length} observed dependencies`}</span></summary><p className="system-hint">Read-only {snapshot.platform} inspection · {time(snapshot.inspection.at)}. Ownership is verified from process identity and ancestry, never from a port number.</p><div className="system-table-wrap"><table><thead><tr><th>Port</th><th>Purpose</th><th>Owner</th><th>Status</th><th>Details</th></tr></thead><tbody>{snapshot.ports.map((p, i) => <tr key={`${p.protocol}-${p.port}-${i}`}><td>{p.protocol} {p.port}</td><td>{p.purpose}</td><td>{p.owner?.name ?? (p.state === "free" ? "No listener" : "Ownership unavailable")}<small>{p.pid ? `PID ${p.pid}` : ""}</small></td><td className={p.state === "conflict" ? "attention" : ""}>{p.state === "conflict" ? "PORT CONFLICT · not owned" : p.state === "owned" ? "Beatbox-owned" : p.state === "free" ? "Free" : "Unverified"}</td><td><details><summary>Inspect</summary><p>{p.address}</p><p>{p.owner?.path ?? "Executable path unavailable"}</p><p>Started: {time(p.owner?.startedAt ?? null)}</p>{p.appearsBeatbox && !p.owned && <p>Looks like an audio dependency; this does not verify another Beatbox instance or grant ownership.</p>}</details></td></tr>)}</tbody></table></div></details></section>
      </>}
      <section className="system-card system-logs"><div className="system-section-title"><div><p className="eyebrow">WHEN YOU NEED A CLOSER LOOK</p><h2>Recent activity</h2></div><label className="system-check"><input type="checkbox" checked={diagnostic} onChange={e => setDiagnostic(e.target.checked)} />Developer diagnostics</label></div><div className="system-log-controls"><label>Source <select aria-label="Source" value={source} onChange={e => setSource(e.target.value)}>{["all", "runtime", "studio", "mcp", "tidal", "supercollider", "audio", "telemetry", "recording"].map(s => <option key={s} value={s}>{s === "all" ? "All services" : s === "mcp" ? "MCP" : s[0].toUpperCase() + s.slice(1)}</option>)}</select></label><button aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "Resume live logs" : "Pause live logs"}</button><button onClick={() => { setCleared(snapshot?.logCursor ?? logs.at(-1)?.id ?? 0); setLogs([]); }}>Clear visible logs</button><button onClick={() => { void navigator.clipboard.writeText(logs.map(l => `${l.at} [${l.source}] ${l.message}`).join("\n")).then(() => setMessage("Visible logs copied."), () => setMessage("Copy unavailable. Select the log text to copy it manually.")); }}>Copy visible logs</button></div><div ref={logEnd} className="system-log-output" tabIndex={0} aria-label="Captured runtime logs">{logs.length ? logs.map(l => <p key={l.id} className={l.level === "error" ? "log-error" : ""}><time>{time(l.at)}</time><b>{l.source}</b><span>{l.message}</span></p>) : <p>No activity in this view.</p>}</div><p className="system-hint">Up to 800 recent entries. Diagnostics adds captured interpreter output; all services stay headless.</p></section>
      <footer className="system-footer">Astro’s Beatbox · {snapshot?.platform ?? "local"} runtime{snapshot && <details><summary>Runtime identity</summary><code>{snapshot.sessionId} · generation {snapshot.generation}</code><p>Last health transition: {time(snapshot.transitionedAt)}</p></details>}</footer>
    </main>
    {confirm && <dialog ref={dialog} className="project-dialog" aria-labelledby="system-confirm-title" onCancel={() => setConfirm(null)} onClose={() => setConfirm(null)}><h2 id="system-confirm-title">{actions[confirm]}?</h2><p>{confirm === "runtime.quit" ? "This closes Beatbox for every connected browser and assistant. Your current jam remains in recovery checkpoints; save a named jam in Studio if you want one." : confirm === "audio.stop" ? "Music and Preview will stop. Your jam stays here for when you restart audio." : confirm === "runtime.restart" ? "Restarts owned audio and telemetry services, then restores your jam. The persistent owner and Studio connection stay available." : "Music and Preview will pause while audio restarts. Your jam and transport state will be restored."}</p><p>Any active recording will be finalized first.</p><div className="dialog-actions"><button onClick={() => setConfirm(null)}>Cancel</button><button className="primary" disabled={disabled} onClick={() => void perform(confirm)}>{actions[confirm]}</button></div></dialog>}
  </div>;
}
