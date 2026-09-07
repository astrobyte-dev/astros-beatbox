import { useEffect, useRef } from "react";

// Workspace preferences only: never stores music or participates in project Undo.
export function readTips() {
  try { return localStorage.getItem("abx-tips-v1") !== "hidden"; }
  catch { return true; }
}
export function rememberTips(show: boolean) {
  try { localStorage.setItem("abx-tips-v1", show ? "shown" : "hidden"); }
  catch { /* Preferences can remain in memory when storage is unavailable. */ }
}
export function focusRegion(selector: string) {
  requestAnimationFrame(() => {
    const node = document.querySelector<HTMLElement>(selector);
    node?.focus();
    node?.scrollIntoView({ block: "nearest" });
  });
}
export function Help({ onClose, onTips }: { onClose: () => void; onTips: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!, previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="project-dialog help-dialog" aria-labelledby="help-title" onCancel={onClose}>
    <span className="eyebrow">FOLLOW YOUR EARS</span>
    <h2 id="help-title">A little room to explore.</h2>
    <p>Play a groove. Tap a pad to change it. Undo brings the previous idea back.</p>
    <dl className="help-workflows">
      <dt>Studio</dt><dd>Rhythms are your notes and beats. Sound Lab shapes the selected instrument; Mixer balances the channels.</dd>
      <dt>Collection</dt><dd>Sounds are built-in samples. Synths make sound. Add WAVs in My Sounds, or record an input in Capture, then Keep as Sample.</dd>
      <dt>Jam</dt><dd>Keep the parts you like, then Make Variation. Compare earlier ideas. Save jam keeps your current sound on this computer.</dd>
      <dt>Scenes</dt><dd>Save different rhythms as scenes, arrange them, then Perform. Instruments and FX are shared between scenes.</dd>
      <dt>System</dt><dd>Check audio readiness, inspect a problem or close Beatbox. Closing this tab keeps the runtime running.</dd>
    </dl>
    <h3>Keyboard shortcuts</h3>
    <dl className="shortcut-list">
      <dt><kbd>Ctrl / ⌘</kbd> + <kbd>Space</kbd></dt><dd>Play / Pause</dd>
      <dt><kbd>Ctrl / ⌘</kbd> + <kbd>Z</kbd></dt><dd>Undo · add Shift to Redo</dd>
      <dt><kbd>Ctrl / ⌘</kbd> + <kbd>S</kbd></dt><dd>Save jam</dd>
      <dt><kbd>?</kbd></dt><dd>Open this guide</dd>
      <dt><kbd>←</kbd> <kbd>→</kbd>, <kbd>Space</kbd></dt><dd>Move between pads, toggle a beat</dd>
      <dt><kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Shift</kbd></dt><dd>Adjust a knob; hold Shift for fine control</dd>
      <dt><kbd>Home</kbd> / <kbd>End</kbd></dt><dd>Minimum / maximum of a slider</dd>
      <dt><kbd>Escape</kbd></dt><dd>Cancel a control draft or close a dialog</dd>
    </dl>
    <p>Global shortcuts pause in text fields, controls and dialogs. Changes to knobs and sliders apply when you release the gesture.</p>
    <div className="dialog-actions"><button onClick={() => { onTips(); onClose(); }}>Show contextual tips</button><button className="primary" autoFocus onClick={onClose}>Back to the music</button></div>
  </dialog>;
}
