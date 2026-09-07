// Delimiters bound output; only an acknowledgement inside the evaluated action
// proves that action returned. END without OK is never an action acknowledgement.
export type OutputStream = "stdout" | "stderr";
export interface EvalResult {
  operationId: string;
  output: string;
  acknowledgement: "action" | "completion";
}
export interface Frame {
  token: string;
  script: string;
  streams: OutputStream[];
  acknowledgement: EvalResult["acknowledgement"];
}
export const diagnostic = /(?:\berror:|\*\*\* Exception:|Failed to (?:Stream\.doTick|send)|FAILURE IN SERVER|no synth or sample named|not in scope|parse error|lexical error|unknown command|unrecognised (?:flag|command)|unrecognized (?:flag|command)|server .*exited|server not running)/i;

export class FrameReader {
  private started = new Set<OutputStream>();
  private ended = new Set<OutputStream>();
  private acknowledged = false;
  private failed = false;
  private chunks: string[] = [];
  private size = 0;
  constructor(readonly frame: Frame) {}
  line(stream: OutputStream, line: string): void {
    const mark = line.trim();
    if (mark === this.frame.token + ":BEGIN") { this.started.add(stream); return; }
    if (!this.started.has(stream) || this.ended.has(stream)) return;
    if (mark === this.frame.token + ":END") { this.ended.add(stream); return; }
    if (mark === this.frame.token + ":OK") { this.acknowledged = true; return; }
    if (mark === this.frame.token + ":FAIL") { this.failed = true; return; }
    if (diagnostic.test(line)) this.failed = true;
    this.chunks.push(line); this.size += line.length;
    while (this.size > 32000 && this.chunks.length > 1) this.size -= this.chunks.shift()!.length;
  }
  get complete(): boolean { return this.frame.streams.every((s) => this.ended.has(s)); }
  result(operationId: string): EvalResult {
    const output = this.chunks.join("\n").trim();
    if (!this.complete || this.failed || (this.frame.acknowledgement === "action" && !this.acknowledged)) {
      throw new Error(output || "Interpreter did not acknowledge the action (it may have partially executed).");
    }
    return { operationId, output, acknowledgement: this.frame.acknowledgement };
  }
}

const hs = (s: string) => JSON.stringify(s);
const sc = (s: string) => JSON.stringify(s).replace(/\\u([0-9a-f]{4})/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)));
// Split SC markers so echoed stdin can never impersonate a response.
const scMark = (token: string, suffix: string) => `("\\n" ++ ${sc(token)} ++ ${sc(":" + suffix)}).postln;`;

export function tidalFrame(code: string, token: string): Frame {
  const t = code.replace(/\r\n/g, "\n").trim();
  // Preserve declarations, pure expressions and GHCi commands. Their bounded
  // diagnostic completion is explicitly weaker than an acknowledgement in IO.
  const action = /^(?:d\d+\b|do\b|hush\b|setcps\b|once\b|asap\b|first\b|mute\b|unmute\b|solo\b|unsolo\b|unmuteAll\b|unsoloAll\b|panic\b|mapM_\b|all\b|resetCycles\b|setCycle\b|p\s|xfade\w*\b|jump\w*\b|\()/.test(t);
  const begin = `System.IO.putStrLn ${hs("\n" + token + ":BEGIN")} >> System.IO.hPutStrLn System.IO.stderr ${hs("\n" + token + ":BEGIN")}`;
  const end = `System.IO.hPutStrLn System.IO.stderr ${hs("\n" + token + ":END")} >> System.IO.hFlush System.IO.stderr >> System.IO.putStrLn ${hs("\n" + token + ":END")} >> System.IO.hFlush System.IO.stdout`;
  const body = action
    ? `:{\nControl.Exception.catch\n  (do\n    _ <- (\n      ${t.replace(/\n/g, "\n      ")}\n      )\n    System.IO.putStrLn ${hs("\n" + token + ":OK")}\n  )\n  (\\e -> do\n    System.IO.putStrLn ${hs("\n" + token + ":FAIL")}\n    System.IO.hPutStrLn System.IO.stderr (show (e :: Control.Exception.SomeException))\n  )\n:}`
    : (t.includes("\n") && !t.startsWith(":")) ? `:{\n${t}\n:}` : t;
  return { token, script: `${begin}\n${body}\n${end}\n`, streams: ["stdout", "stderr"], acknowledgement: action ? "action" : "completion" };
}

export function sclangFrame(code: string, token: string, routine = false): Frame {
  return sclangCompileFrame(sc(code), token, routine);
}

export function sclangFileFrame(file: string, token: string, routine = false): Frame {
  return sclangCompileFrame(`File.readAllString(${sc(file.replace(/\\/g, "/"))})`, token, routine);
}

function sclangCompileFrame(source: string, token: string, routine: boolean): Frame {
  const work = `try { f.value; ${scMark(token, "OK")} } { |e| ${scMark(token, "FAIL")} e.reportError; }; ${scMark(token, "END")}`;
  return {
    token, streams: ["stdout"], acknowledgement: "action",
    script: `{ var f; ${scMark(token, "BEGIN")} f = ${source}.compile; if(f.isNil) { ${scMark(token, "FAIL")} ${scMark(token, "END")} } { ${routine ? `Routine({ ${work} }).play(SystemClock);` : work} }; }.value;\n\x0c\n`,
  };
}
