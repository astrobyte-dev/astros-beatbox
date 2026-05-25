// Pure parsers/helpers for the rig — kept out of server.ts (which has import-time
// side effects) so they can be unit-tested in isolation.

export interface RigState {
  slots: Record<string, string>;
  tempoBpm: number;
  muted: Set<string>;
  solo: string | null;
}

// Approximate parse of evaluated Tidal to track what each d-slot is doing.
// Not a real Haskell parser — just enough for the dashboard to render. Handles a
// `do { ...; ... }` wrapper (splits on ';'), `setcps`, `dN silence`, and `dN $ ...`.
export function track(rig: RigState, code: string): void {
  let c = code.trim();
  const wrap = c.match(/^do\s*\{([\s\S]*)\}\s*$/);
  if (wrap) c = wrap[1];
  for (const raw of c.split(";")) {
    const st = raw.trim();
    if (!st) continue;
    let m;
    if ((m = st.match(/setcps\s*\(?\s*([0-9.]+)\s*\/\s*60\s*\/\s*4/))) { rig.tempoBpm = Math.round(parseFloat(m[1])); continue; }
    if ((m = st.match(/setcps\s+([0-9.]+)/))) { rig.tempoBpm = Math.round(parseFloat(m[1]) * 60 * 4); continue; }
    if ((m = st.match(/^(d\d{1,2})\s+silence\b/))) { delete rig.slots[m[1]]; rig.muted.delete(m[1]); if (rig.solo === m[1]) rig.solo = null; continue; }
    if ((m = st.match(/^(d\d{1,2})\s*\$?\s*([\s\S]+)/))) { rig.slots[m[1]] = m[2].trim(); rig.muted.delete(m[1]); continue; }
  }
}

// Replace or append `# param value` in a slot's code (used by the live knobs).
export function applyParam(code: string, param: string, value: number): string {
  const re = new RegExp(`#\\s*${param}\\s+[^#]*`);
  const updated = re.test(code) ? code.replace(re, `# ${param} ${value} `) : `${code.trim()} # ${param} ${value}`;
  return updated.replace(/\s+/g, " ").trim();
}

// Escape a string for safe interpolation into a SuperCollider double-quoted literal.
export function scStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
