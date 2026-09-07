// Production Studio + real HTTP/MCP/project services. The explicit cycle fixture
// models acknowledgements; it does NOT establish native Tidal or acoustic timing.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Application } from './dist/application.js';
const dir = mkdtempSync(path.join(tmpdir(), 'abx-p3-browser-'));
Object.assign(process.env, { TIDAL_PROJECTS_DIR: dir, TIDAL_RECOVERY_DIR: path.join(dir, 'recovery'), TIDAL_RECORDINGS_DIR: path.join(dir, 'recordings'), TIDAL_METER_PORT: '0' });
const { startDashboard } = await import('./dist/dashboard.js');
const { runtimeKey, RUNTIME_PROTOCOL } = await import('./dist/runtime.js');
const calls = []; let cycle = 10.25;
const engine = { generation: 0, running: false, state: 'idle', error: null,
  async ensureBooted() { this.running = true; this.state = 'ready'; }, async reboot() { this.generation++; await this.ensureBooted(); }, assertGeneration(g) { assert.equal(g, this.generation); },
  tidal: { async eval(code, operationId) { calls.push(code); if (code.includes('BROKEN_DRAFT')) throw new Error('Fixture compiler rejects BROKEN_DRAFT'); return { operationId, acknowledgement: 'action', output: code.includes('abxInstall') ? 'ABX_SCHEDULED ' + (code.includes('abxInstall True') ? Math.floor(cycle) + 1 : cycle) : '' }; }, async hush(id) { return this.eval('hush', id); } },
  sclang: { async eval(code, operationId) { calls.push(code); return { operationId, acknowledgement: 'action', output: '' }; }, async evalRoutine(code, id) { return this.eval(code, id); } }
};
const app = new Application(engine, { sets: dir, projects: dir, recovery: path.join(dir, 'recovery'), recordings: path.join(dir, 'recordings'), device: path.join(dir, 'device') });
const state = () => ({ ...app.projectState(), sessionId: app.sessionId, generation: engine.generation, status: engine.state, error: null, slots: app.rig.slots, stopped: app.rig.stopped, paused: app.rig.paused, synchronized: app.rig.synchronized, recording: false, muted: [...app.rig.muted], solo: app.rig.solo, devices: [], scopes: {}, hits: {} });
const server = startDashboard(0, fileURLToPath(new URL('./dashboard.html', import.meta.url)), state, () => ({ cycle, cps: .5, lead: 0, age: 0 }), c => app.dispatchExternal(c), { identity: () => ({ kind: 'astros-beatbox-runtime', protocol: RUNTIME_PROTOCOL, key: runtimeKey, ready: true, sessionId: app.sessionId, pid: process.pid }), bridge: () => ({ ok: true }) });
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ABX_CHROMIUM || undefined });
let page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let mcp;
const connect = async () => {
  const client = new Client({ name: 'p3-browser', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./dist/server.js', import.meta.url))], env: { ...process.env, TIDAL_DASH_PORT: String(server.address().port) }, stderr: 'pipe' })); return client;
};
const call = async (name, args = {}) => { const r = await mcp.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
const meta = () => ({ projectId: app.project.document.id, revision: app.project.document.revision });
const sync = async () => {
  await page.waitForFunction(rev => document.querySelector('.studio-app')?.dataset.revision === String(rev), app.project.document.revision);
  await page.waitForFunction(() => !document.querySelector('.feedback')?.textContent.includes('waiting for confirmation'));
};
const click = async name => { await page.getByRole('button', { name, exact: true }).click(); await sync(); };
const observe = at => { cycle = at; app.observeCycle(at); };
try {
  await page.goto(base + '/studio'); await click('Start Pocket groove');
  const grooveId = app.project.document.scenes[0].id;
  const sceneName = page.getByRole('textbox', { name: 'Scene name', exact: true });
  await sceneName.fill('Groove'); await sceneName.press('Enter'); await sync();
  await click('Duplicate scene');
  await sceneName.fill('Lift'); await sceneName.press('Enter'); await sync();
  const lift = app.project.document.scenes.find(s => s.name === 'Lift'), kick = app.project.document.tracks[0];
  await click('Kick step 2'); assert.notEqual(lift.clips[kick.id], app.project.document.scenes[0].clips[kick.id]);
  await page.getByRole('button', { name: 'Launch Groove', exact: true }).focus(); await page.keyboard.press('Enter'); await sync(); await page.getByText('Groove · Next cycle', { exact: true }).waitFor();
  observe(11); await page.getByText('Groove · Current', { exact: true }).waitFor();
  await click('Launch Lift'); await page.getByText('Lift · Next cycle', { exact: true }).waitFor();
  const count = calls.filter(c => c.includes('abxInstall')).length;
  observe(11.99); assert.equal(app.performance.sceneId, grooveId); observe(12); await page.getByText('Lift · Current', { exact: true }).waitFor(); assert.equal(calls.filter(c => c.includes('abxInstall')).length, count);
  await click('Stop performance'); await click('Duplicate scene'); await sceneName.fill('Drop'); await sceneName.press('Enter'); await sync();
  const drop = app.project.document.scenes.find(s => s.name === 'Drop');
  await page.getByText('Arrange your sections', { exact: false }).click();
  for (const name of ['Groove', 'Lift', 'Drop']) { await click('Edit scene ' + name); await click('+ Add ' + name); }
  const repeats = page.getByRole('spinbutton', { name: 'Entry 2 repeats' }); await repeats.fill('2'); await repeats.press('Tab'); await sync();
  assert.deepEqual(app.project.document.arrangement.map(a => a.cycles), [4, 2, 4]);
  await click('Move entry 3 earlier'); await click('Move entry 2 later');
  await page.getByText('Motion', { exact: false }).filter({ has: page.locator('span') }).first().click();
  await page.getByLabel('Motion control').selectOption('room'); await click('Swell');
  assert.equal(app.project.document.automation.length, 1);
  await click('Perform'); await click('Play arrangement'); observe(13); assert.equal(app.performance.entryId, app.project.document.arrangement[0].id);
  await page.getByText("Groove · Current · repeat 1", { exact: true }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('../docs/p3-performance-1440.png', import.meta.url)), fullPage: true });
  mcp = await connect(); const identity = (await call('project_status')).sessionId;
  await mcp.close(); mcp = null; await page.close(); // no clients remain
  const installed = calls.filter(c => c.includes('abxInstall')).length;
  observe(17); assert.equal(app.performance.sceneId, lift.id); observe(19); assert.equal(app.performance.sceneId, drop.id);
  assert.equal(calls.filter(c => c.includes('abxInstall')).length, installed, 'no observer/client sends scene advancement');
  mcp = await connect(); assert.equal((await call('project_status')).sessionId, identity); assert.equal((await call('project_status')).projectRuntime.performance.sceneId, drop.id);
  await call('arrangement_stop', meta());
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.on('pageerror', e => errors.push(String(e))); await page.goto(base + '/studio'); await sync();
  await call('project_edit', { ...meta(), label: 'MCP scene transformation', edits: [{ type: 'scene.rename', sceneId: drop.id, name: 'Ending' }] }); await sync(); await page.getByRole('button', { name: 'Launch Ending', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Undo:/ }).click(); await sync(); assert.equal(app.project.document.scenes.find(s => s.id === drop.id).name, 'Drop');
  const legacy = await browser.newPage(); await legacy.goto(base + '/#steps'); await legacy.locator('[data-pat="' + lift.id + '"]').click();
  await page.waitForFunction(id => document.querySelector('[aria-label="Edit scene Lift"]')?.getAttribute('aria-pressed') === 'true', lift.id);
  await legacy.close();
  await click('+ Code instrument'); const codeTrack = app.project.document.tracks.at(-1); await click('Select Code instrument');
  const editor = page.getByRole('textbox', { name: 'Managed Tidal source' }); await editor.fill('  BROKEN_DRAFT  '); await click('Save draft'); await click('Prepare & apply');
  assert.equal(app.project.document.clips.find(c => c.id === codeTrack.activeClipId).source, 'silence'); assert.equal(await editor.inputValue(), '  BROKEN_DRAFT  '); await click('Dismiss');
  await editor.fill('s "bd*2"'); await click('Save draft'); await click('Prepare & apply');
  await call('project_edit', { ...meta(), label: 'Declare dependency', edits: [{ type: 'dependencies.set', dependencies: [{ id: 'tidal-lib', kind: 'tidal', name: 'Tidal', version: '1.10', source: '-- exact retained declaration' }] }] }); await sync();
  await page.getByRole('checkbox', { name: 'Tidal 1.10' }).click(); await sync(); assert.deepEqual(app.project.document.clips.find(c => c.id === codeTrack.activeClipId).dependencyIds, ['tidal-lib']);
  await call('scene_launch', { ...meta(), sceneId: lift.id, boundary: 'cycle' });
  await call('eval_tidal', { ...meta(), code: 'once $ s "bd"' }); await sync();
  await page.getByRole('button', { name: 'Return to managed project', exact: true }).waitFor();
  const previousGeneration = engine.generation;
  await click('Return to managed project'); assert.equal(engine.generation, previousGeneration + 1); assert.equal(app.projectState().projectRuntime.externallyModified, false);
  await page.locator('.arrangement > summary').click();
  const heldRepeats = page.getByRole('spinbutton', { name: 'Entry 2 repeats' });
  await heldRepeats.focus(); await heldRepeats.fill('3');
  await call('project_edit', { ...meta(), label: 'Concurrent scene name', edits: [{ type: 'scene.rename', sceneId: grooveId, name: 'Groove revised' }] }); await sync();
  await heldRepeats.press('Tab'); await sync();
  await page.getByRole('alert').filter({ hasText: 'Project changed' }).waitFor(); assert.equal(app.project.document.arrangement[1].cycles, 2); await click('Dismiss');
  await call('project_save', { ...meta(), name: 'p3-composition' }); const saved = app.project.document;
  await call('project_new', meta()); await call('project_load', { ...meta(), name: 'p3-composition' }); await sync();
  assert.deepEqual({ ...app.project.document, revision: saved.revision }, saved); assert.equal(app.rig.stopped, true); assert.equal(app.performance.startCycle, null);
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no page overflow');
    await page.screenshot({ path: fileURLToPath(new URL('../docs/p3-composition-' + width + '.png', import.meta.url)), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('P3 BROWSER PASS: independent scenes, edit/launch/queue, explicit cycle observations, stable arrangement repeats/reorder, motion, performance view, zero-client advancement contract, frontend/MCP reconnect, real MCP and legacy sync, undo, code draft failure/correction/dependencies, save/reopen stopped, three widths. Fake audio only.');
} finally { await mcp?.close(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
