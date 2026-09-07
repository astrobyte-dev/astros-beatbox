// Opt-in native stdin-size regression; no audio server is started.
import assert from 'node:assert/strict';
import { Sclang } from './dist/sclang.js';
import { SC_WELCOME } from './dist/config.js';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const before = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('abx-sclang-')));
const sc = new Sclang();
try {
  sc.start(); await sc.waitFor(SC_WELCOME, 60000);
  // Individual SC string tokens also have a lexer limit; use ten bounded tokens.
  const literal = '[' + Array(10).fill(JSON.stringify('x'.repeat(7000))).join(',') + ']';
  const result = await sc.evalRoutine(`0.05.wait; (${literal}.collect(_.size).sum).postln;`);
  assert.match(result.output, /70000/);
  const medium = '[' + Array(9).fill(JSON.stringify('x'.repeat(1000))).join(',') + ']';
  assert.match((await sc.eval(`(${medium}.collect(_.size).sum).postln;`)).output, /9000/);
  await assert.rejects(sc.eval(`${literal}; 1 + ;`));
  assert.match((await sc.eval('42.postln;')).output, /42/);
  assert.deepEqual(readdirSync(tmpdir()).filter(n => n.startsWith('abx-sclang-') && !before.has(n)), []);
  console.log('SCLANG NATIVE PASS: 70KB source, asynchronous completion, compiler rejection, recovery and temporary-file cleanup.');
} finally { sc.stop(); }
