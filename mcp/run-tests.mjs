// run-tests.mjs — cross-platform test runner for the MCP package.
//
// Replaces `node --test dist/*.test.js`. That form relied on glob expansion: cmd.exe and
// PowerShell do NOT expand `*`, and Node only expands it natively on Node >= 21, so it was
// fragile across shells/versions. Worse, when the glob matched nothing (e.g. an unbuilt dist/),
// `node --test` exited 0 with zero tests run — a SILENT GREEN. This runner closes that hole.
//
// It discovers dist/*.test.js via fs (auto-discovery, so new test files are picked up with no
// list to maintain), FAILS LOUDLY if none are found, runs them via node:test's run() API, and
// enforces a test-count FLOOR.
//
// FLOOR convention — tests should monotonically grow, never silently shrink:
//   * Raise FLOOR in the SAME commit that adds tests.
//   * If a refactor legitimately removes tests, LOWER FLOOR explicitly with a one-line
//     justification in that commit's message — never edit it reflexively, or it stops being a net.
//
// Requires Node 20+ (node:test run() + reporters), matching the CI Node version.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";

const FLOOR = 31; // current test count: track 7 + dsp 12 + mixer 12 (raised with the mixer tests)

const distDir = join(dirname(fileURLToPath(import.meta.url)), "dist");
let files = [];
try {
  files = readdirSync(distDir).filter((f) => f.endsWith(".test.js")).map((f) => join(distDir, f));
} catch {
  /* dist/ missing — handled by the zero-match check below */
}
if (files.length === 0) {
  console.error("No test files matched dist/*.test.js — was dist/ built? Run `npm run build` first.");
  process.exit(1);
}

let passed = 0, failed = 0;
const stream = run({ files });
stream.on("test:pass", () => { passed++; });
stream.on("test:fail", () => { failed++; });
stream.on("end", () => {
  const total = passed + failed;
  if (failed > 0) {
    console.error(`\n${failed} of ${total} test(s) FAILED.`);
    process.exitCode = 1;
  } else if (total < FLOOR) {
    console.error(`\nOnly ${total} tests ran, expected at least ${FLOOR}. Test discovery regressed ` +
      `(stale build, or a *.test file stopped being emitted). Failing.`);
    process.exitCode = 1;
  } else {
    console.log(`\n${total} tests passed (floor ${FLOOR}).`);
  }
});
// Pipe through the spec reporter for the usual readable output; the counts above come from the
// stream's own events (verified: one event per test, no file-wrapper inflation).
stream.compose(spec).pipe(process.stdout);
