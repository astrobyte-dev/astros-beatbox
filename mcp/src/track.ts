// Pure parsers/helpers for the rig — kept out of server.ts (which has import-time
// side effects) so they can be unit-tested in isolation.

export interface RigState {
  slots: Record<string, string>;
  tempoBpm: number;
  beatsPerCycle?: number;
  muted: Set<string>;
  solo: string | null;
}

// Approximate parse of evaluated Tidal to track what each d-slot is doing.
// Not a real Haskell parser — just enough for the dashboard to render. Handles a
// `do { ...; ... }` wrapper (splits on ';'), `setcps`, `dN silence`, and `dN $ ...`.
export function track(rig: RigState, code: string): boolean {
  let tracked = true;
  let c = code.trim();
  const wrap = c.match(/^do\s*\{([\s\S]*)\}\s*$/);
  if (wrap) c = wrap[1];
  for (const raw of splitStatements(c)) {
    const st = raw.trim();
    if (!st) continue;
    let m;
    if ((m = st.match(/^setcps\s*\(?\s*([0-9.]+)\s*\/\s*60\s*\/\s*([0-9.]+)\s*\)?\s*$/))) { rig.tempoBpm = parseFloat(m[1]) / parseFloat(m[2]) * (rig.beatsPerCycle ?? 4); continue; }
    if ((m = st.match(/^setcps\s+([0-9.]+)\s*$/))) { rig.tempoBpm = parseFloat(m[1]) * 60 * (rig.beatsPerCycle ?? 4); continue; }
    if ((m = st.match(/^(d(?:[1-9]|1[0-6]))\s+silence\s*$/))) { delete rig.slots[m[1]]; rig.muted.delete(m[1]); if (rig.solo === m[1]) rig.solo = null; continue; }
    if ((m = st.match(/^(d(?:[1-9]|1[0-6]))\s+(?:\$\s*([\s\S]+)|(\([\s\S]+\)))$/))) { rig.slots[m[1]] = (m[2] ?? m[3]).trim(); rig.muted.delete(m[1]); continue; }
    tracked = false;
  }
  return tracked;
}

export function isTrackedTidal(code: string): boolean {
  if (/^\s*hush\s*;?\s*$/.test(code)) return true;
  return track({ slots: {}, tempoBpm: 0, muted: new Set(), solo: null }, code);
}

// Recognize only explicit top-level assignments; opaque expressions remain
// byte-for-byte intact, including semicolons inside strings or nested do/let.
export function splitStatements(source: string): string[] {
  const result: string[] = []; let start = 0, depth = 0, quoted = false, escaped = false, comment = false, block = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (comment) { if (c === "\n") comment = false; else continue; }
    if (block) { if (c === "{" && n === "-") { block++; i++; } else if (c === "-" && n === "}") { block--; i++; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (c === "-" && n === "-") { comment = true; i++; continue; }
    if (c === "{" && n === "-") { block = 1; i++; continue; }
    if ("([{ ".includes(c) && c !== " ") depth++;
    if (")]}".includes(c)) depth--;
    if (c === ";" && depth === 0) { result.push(source.slice(start, i)); start = i + 1; }
  }
  result.push(source.slice(start)); return result;
}

// Retained only for the P0a compatibility helper tests. No application or browser
// mutation path calls this legacy regex helper.
export function applyParam(code: string, param: string, value: number): string {
  const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`#\\s*${escaped}\\s+[^#]*`);
  const updated = re.test(code) ? code.replace(re, `# ${param} ${value} `) : `${code.trim()} # ${param} ${value}`;
  return updated.replace(/\s+/g, " ").trim();
}

// Escape a string for safe interpolation into a SuperCollider double-quoted literal.
export function scStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
