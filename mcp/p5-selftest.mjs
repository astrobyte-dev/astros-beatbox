// Horizontal production Studio/HTTP/storage/System journey with explicit synthetic audio.
// Existing phase journeys additionally cover real MCP synchronization.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { chromium } from "playwright";
import { Application } from "./dist/application.js";
import { SamplingFixtureEngine, fixtureWav } from "./dist/sampling-test-fixture.js";
const dir = mkdtempSync(path.join(tmpdir(), "abx-p5-browser-"));
Object.assign(process.env, { TIDAL_PROJECTS_DIR: dir, TIDAL_RECOVERY_DIR: path.join(dir, "recovery"), TIDAL_RECORDINGS_DIR: path.join(dir, "recordings"), TIDAL_METER_PORT: "0" });
const { startDashboard } = await import("./dist/dashboard.js");
const { runtimeKey, RUNTIME_PROTOCOL } = await import("./dist/runtime.js");
const engine = new SamplingFixtureEngine();
const { RuntimeHealth } = await import("./dist/runtime-health.js");
const { RuntimeLogs } = await import("./dist/runtime-logs.js");
const { addSynth } = await import("./dist/sound-lab-edits.js");
const { defaults, definition } = await import("./dist/sound-lab.js");
for (const driver of [engine.tidal, engine.sclang]) driver.health = {pid:null, startedAt:null, exited:false, error:null, usable:false};
const logs = new RuntimeLogs(); let health;
const output = "../docs/p5-after"; mkdirSync(output, {recursive:true});
const evidence = { status: "running", fixtures: "Synthetic audio only; native/Windows acceptance pending", accessibility: [], viewports: [], performance: {} };
const app = new Application(engine, { sets: dir, projects: dir, recovery: path.join(dir, "recovery"), recordings: path.join(dir, "recordings"), device: path.join(dir, "device") });
const file = path.join(dir, "Warehouse voice.wav"); writeFileSync(file, fixtureWav(1, 6000));
const state = () => ({ ...app.projectState(), sessionId: app.sessionId, generation: engine.generation, status: engine.state, error: null, slots: app.rig.slots, stopped: app.rig.stopped, paused: app.rig.paused, synchronized: app.rig.synchronized, recording: app.rig.recording, muted: [...app.rig.muted], solo: app.rig.solo, devices: [], scopes: {}, hits: {} });
const server = startDashboard(0, fileURLToPath(new URL("./dashboard.html", import.meta.url)), state, () => ({ cycle: engine.cycle, cps: .5, lead: 0, age: 0 }), c => app.dispatchExternal(c), {
  audio: () => ({ library: app.userAudio, capture: app.capture, sessionId: app.sessionId, meter: () => ({ available: app.capture.snapshot().inputReady, peak: .35 }) }),
  system: () => health.snapshot(), logs: () => ({sessionId:app.sessionId, entries:logs.read(),cursor:logs.lastId}),
  recordings: app.recordings, sounds: () => [], bridge: () => {},
  identity: () => ({ kind: "astros-beatbox-runtime", protocol: RUNTIME_PROTOCOL, key: runtimeKey, ready: true, sessionId: app.sessionId, pid: process.pid }),
});
await once(server, "listening");
health = new RuntimeHealth(engine, {port:0,lastUpdate:0,listening:false,error:null}, app, server.address().port, logs);
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ABX_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const errors = []; page.on("pageerror", e => errors.push(String(e)));
const dispatch = async c => { const r=await app.dispatch(c); assert.ok(r.ok,JSON.stringify(r)); return r; };
const meta = () => ({ projectId: app.project.document.id, revision: app.project.document.revision });
const sync = async () => { await page.waitForFunction(rev => document.querySelector(".studio-app")?.dataset.revision === String(rev), app.project.document.revision); await page.waitForFunction(() => !document.querySelector(".feedback")?.textContent.includes("waiting for confirmation")); };
const click = async name => { await page.getByRole("button", { name, exact: true }).click(); await sync(); };
const tab = async name => { await page.locator(".lab-tabs button").filter({ hasText: new RegExp("^" + name) }).click(); };

const axeSource = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const checkA11y = async name => {
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => (await axe.run(document, {runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
  evidence.accessibility.push({name, violations:result});
  if (result.length) console.log("A11Y", name, JSON.stringify(result));
};
const shot = async (name, {a11y=true}={}) => {
  await page.evaluate(() => { if(document.activeElement?.id === "workspace") document.activeElement.blur(); window.scrollTo(0,0); });
  await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
  if(a11y) await checkA11y(name);
  if (["sound-lab-1440", "sampling-1440", "capture-1440"].includes(name)) {
    const target=name.startsWith("capture")?".capture-take":".sound-lab";
    await page.locator(target).scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/${name.replace("-1440","-focused-1440")}.png`});
    assert.ok(await page.locator(".topbar").evaluate(el=>Math.abs(el.getBoundingClientRect().top)<1),"Transport remains visible when editing below the fold");
    await page.evaluate(()=>window.scrollTo(0,0));
  }
  if (["sound-lab-1440", "sampling-1440", "capture-1440", "jam-1440", "performance-1440", "system-1440"].includes(name)) {
    const original = page.viewportSize();
    for (const [width,height] of [[1024,768],[1280,800],[1920,1080]]) {
      await page.setViewportSize({width,height});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      assert.equal(overflow,0,`${name} overflows at ${width}`);
      if(name.startsWith("performance")) assert.ok(await page.locator(".workspace").evaluate(el=>el.getBoundingClientRect().width)>width*.8,"Performance uses full width");
      await page.screenshot({path:`${output}/${name.replace("1440",String(width))}.png`,fullPage:true});
    }
    await page.setViewportSize(original);
  }
};
const save = async name => {
  await click("Save jam"); const d=page.getByRole("dialog"); await d.getByLabel("Save as",{exact:true}).fill(name);
  await d.getByRole("button",{name:/^(Save jam|Replace saved jam)$/}).click(); await d.waitFor({state:"hidden"}); await sync();
  await page.getByText("✓ Saved on this computer",{exact:true}).waitFor();
};
try {
  await page.goto(base+"/studio"); await sync(); await shot("arrival-1440");
  await click("Start Playing"); await page.getByRole("button",{name:"Pause",exact:true}).waitFor();
  assert.equal(app.project.document.tracks.length,4);
  const kick=app.project.document.tracks[0], first=app.project.document.clips.find(c=>c.trackId===kick.id);
  const previous=first.steps[1];
  await page.getByRole("button",{name:"Kick step 2",exact:true}).press("Space"); await sync();
  assert.notEqual(app.project.document.clips.find(c=>c.id===first.id).steps[1],previous);
  await page.locator("#workspace").focus(); await page.keyboard.press("Control+z"); await sync();
  assert.equal(app.project.document.clips.find(c=>c.id===first.id).steps[1],previous);
  await page.keyboard.press("Control+Shift+z"); await sync();
  await page.keyboard.press("Control+Space"); await sync(); assert.equal(app.rig.paused,true);
  await page.keyboard.press("Control+Space"); await sync(); assert.equal(app.rig.paused,false);
  await click("Help and keyboard shortcuts"); await shot("help"); await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button",{name:"Help and keyboard shortcuts"}).evaluate(el=>el===document.activeElement),true);
  await click("Dismiss contextual tips"); await page.reload(); await sync();
  assert.equal(await page.locator(".context-tip").count(),0);
  await page.locator("#workspace").focus(); await page.keyboard.press("?");
  await page.getByRole("dialog").waitFor(); await click("Show contextual tips"); assert.equal(await page.locator(".context-tip").count(),1);
  for (const [width,height] of [[1024,768],[1280,800],[1440,900],[1920,1080]]) {
    await page.setViewportSize({width,height});
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,padTop:document.querySelector('.tracks').getBoundingClientRect().top}));
    evidence.viewports.push({width,height,...geometry}); assert.equal(geometry.overflow,0); assert.ok(geometry.padTop < height-100,JSON.stringify(geometry));
    await shot(`studio-${width}`,{a11y:width===1440});
  }
  await page.setViewportSize({width:1440,height:900});
  await click("Sounds"); await shot("sounds-empty");
  await click("Synths"); await page.getByRole("button",{name:/Dirty Mono/}).click(); await sync();
  const synth=app.project.document.tracks.at(-1);
  await page.getByRole("button",{name:`Sound Lab · ${synth.name}`,exact:true}).click();
  await page.waitForFunction(()=>document.activeElement===document.querySelector(".sound-lab"));
  await page.getByRole("slider",{name:"Cutoff",exact:true}).press("ArrowUp"); await sync();
  await shot("sound-lab-1440");
  await tab("FX"); await click("+ Add effect"); await shot("fx-1440");
  await tab("Motion"); await page.getByLabel("Modulation destination").selectOption("synth.cutoff"); await click("+ Add motion"); await shot("motion-1440");
  await click("Jam ✳"); await click("Keep Kick");
  const keptSteps=structuredClone(app.project.document.clips.find(c=>c.id===first.id).steps);
  await page.getByRole("button",{name:/^Make Variation/}).click(); await sync();
  assert.deepEqual(app.project.document.clips.find(c=>c.id===first.id).steps,keptSteps);
  await page.locator(".jam-summary").waitFor(); await shot("variation-1440"); await click("Keep This ★"); await click("Find useful macros");
  await page.getByLabel("Jam scene name").fill("Night drive"); await click("Save as Scene ↗");
  await shot("jam-1440");
  await click("Exit Jam ✳"); await click("Scenes & arrangement");
  await click("Edit scene Night drive"); await page.locator(".arrangement > summary").click(); await click("+ Add Night drive");
  assert.equal(app.project.document.arrangement.length,1);
  await click("My Sounds"); await shot("my-sounds-empty");
  await page.getByLabel("Audio files",{exact:true}).setInputFiles(file); await click("Import selected sounds");
  await page.getByText("1 added · 0 already owned",{exact:true}).waitFor(); await click("+ Add track");
  const sample=app.project.document.tracks.at(-1); await tab("Sample"); await click("Loop phrase"); await click("Chop to pads"); await shot("sampling-1440");
  await click("Capture"); await click("Pause");
  await page.getByLabel("Capture input device").selectOption("Fixture microphone"); await click("Prepare input");
  await page.getByLabel("Capture name").fill("Pocket voice"); await click("● Record input"); await shot("capture-recording");
  await click("■ Stop capture"); await click("Keep as Sample"); await shot("capture-1440"); await click("Use this sound →");
  await page.getByLabel("My Sounds filter").selectOption("Captured"); await click(`Use on ${sample.name}`);
  assert.equal(app.userAudio.list().find(e=>e.id===app.project.document.clips.find(c=>c.trackId===sample.id).assetId).origin,"captured");
  await tab("Sample"); await click("Loop phrase"); await click("Chop to pads");
  await save("night-drive"); const saved=structuredClone(app.project.document);
  // A title edit must retain the real saved filename and trigger a guarded switch.
  await page.getByLabel("Project name",{exact:true}).fill("A different title"); await page.getByLabel("Project name",{exact:true}).press("Enter"); await sync();
  await page.getByText("● Unsaved changes",{exact:true}).waitFor();
  const textRevision=app.project.document.revision;
  await page.getByLabel("Project name",{exact:true}).focus(); await page.keyboard.press("Control+Space");
  assert.equal(app.project.document.revision,textRevision); await page.getByLabel("Project name",{exact:true}).press("Escape");
  await click("My Jams"); await click("Open jam night-drive"); await shot("unsaved-switch");
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();
  assert.equal(app.project.document.name,"A different title");
  await click("Open jam night-drive"); await page.getByRole("dialog").getByRole("button",{name:"Open without saving",exact:true}).click(); await sync();
  await page.getByText("✓ Saved on this computer",{exact:true}).waitFor();
  assert.deepEqual({...app.project.document,revision:saved.revision},saved); assert.equal(app.rig.stopped,true);
  await click("Save jam"); assert.equal(await page.getByRole("dialog").getByLabel("Save as",{exact:true}).inputValue(),"night-drive"); await page.keyboard.press("Escape");
  // Failed disk write stays unsaved, and can be retried with a corrected filename.
  await page.getByLabel("Project name",{exact:true}).fill("Night drive final"); await page.getByLabel("Project name",{exact:true}).press("Enter"); await sync();
  const originalSave=app.project.storage.save; app.project.storage.save=()=>{throw new Error("Fixture disk full: choose another location or free space");};
  await click("Save jam"); await page.getByRole("dialog").getByRole("button",{name:"Replace saved jam",exact:true}).click();
  await page.getByRole("dialog").getByRole("alert").waitFor(); await shot("save-error"); assert.equal(app.savedState,"unsaved");
  app.project.storage.save=originalSave; await page.getByRole("dialog").getByLabel("Save as",{exact:true}).fill("night-drive-final");
  await page.getByRole("dialog").getByRole("button",{name:"Save jam",exact:true}).click(); await page.getByRole("dialog").waitFor({state:"hidden"}); await sync();
  await click("Perform"); await click("Play arrangement"); engine.cycle++; app.observeCycle(engine.cycle); await sync(); await shot("performance-1440");
  await click("Record"); await click("Finish recording");
  await page.locator(".recording-list audio").waitFor(); assert.equal(app.recordings.list()[0].state,"ready"); await shot("recordings-1440");
  assert.equal(await page.locator(".recording-library").isVisible(),true); await click("Hear editing rhythm");
  // Explicit degraded fixture; authored document survives and recovery goes to System.
  engine.state="degraded"; engine.error="Fixture audio disconnected"; app.runtime.error="Fixture audio disconnected";
  await page.getByText("Playback needs attention.",{exact:true}).waitFor(); await shot("degraded-1440");
  await page.getByRole("link",{name:"System",exact:true}).click(); await page.getByRole("heading",{name:"Needs attention",exact:true}).waitFor(); await shot("system-degraded-1440");
  await page.locator(".system-compatibility summary").click(); assert.equal(await page.getByRole("link",{name:"Open classic dashboard ↗"}).getAttribute("href"),"/");
  engine.state="idle"; engine.error=null; engine.running=false; app.runtime.error=null;
  await page.getByRole("heading",{name:"Ready when you are",exact:true}).waitFor(); await shot("system-1440");
  await page.getByRole("link",{name:"Studio",exact:true}).click(); await sync();
  // A missing imported file stays authored and is repaired with the exact original.
  const selectedClip=app.project.document.clips.find(c=>c.trackId===sample.id), missingId=selectedClip.assetId;
  const managed=app.userAudio.file(missingId), originalBytes=readFileSync(managed);
  rmSync(managed); await page.getByRole("button",{name:`Select ${sample.name}`,exact:true}).click(); await sync();
  await page.getByRole("button",{name:"Relink in My Sounds",exact:true}).waitFor(); await click("Relink in My Sounds");
  await page.getByText("Missing original. Relink the same WAV to restore it.",{exact:true}).waitFor(); await shot("missing-asset-1440");
  assert.equal(app.project.document.clips.find(c=>c.trackId===sample.id).assetId,missingId);
  await page.getByRole("button",{name:"Relink original WAV",exact:true}).click();
  const repair=path.join(dir,"original-capture.wav");writeFileSync(repair,originalBytes);
  await page.getByLabel("Audio files",{exact:true}).setInputFiles(repair);await click("Import selected sounds");
  await page.waitForFunction(()=>!document.querySelector('.user-sounds')?.textContent.includes('Missing original.'));
  assert.equal(app.userAudio.status(missingId),"available");assert.deepEqual(readFileSync(managed),originalBytes);
  // Missing waveform is a separate observation, with a retry that doesn't edit music.
  await page.route("**/audio/sound/*/wave",r=>r.fulfill({status:503,body:"Unavailable fixture"}));
  await click("Sounds"); await click("My Sounds");
  await page.getByText("Waveform unavailable. Your sound and trim controls remain available.",{exact:false}).first().waitFor(); await shot("waveform-error-1440");
  await page.unroute("**/audio/sound/*/wave"); await page.getByRole("button",{name:"Retry waveform",exact:true}).first().click();
  await page.locator('.user-sound-card').first().getByRole('img',{name:'Audio waveform with selected region'}).waitFor();
  await page.emulateMedia({reducedMotion:"reduce"}); await click("Play");
  assert.equal(await page.locator(".clock-strip > div").evaluate(el=>getComputedStyle(el).opacity),"0");
  assert.equal(await page.locator(".play-button").evaluate(el=>getComputedStyle(el).transitionDuration),"0s");
  await page.setViewportSize({width:1280,height:800}); await shot("reduced-motion-1280"); await click("Pause");
  // Realistic upper managed-channel fixture: 12 instruments, 16 scenes, racks,
  // automation, imported audio, chops and twelve exploration ideas.
  while(app.project.document.tracks.length<12) await dispatch({cmd:"project.edit",...meta(),edits:addSynth(app.project.document,app.project.document.sceneOrder[0]),label:"Stress instrument"});
  for(const t of app.project.document.tracks) {
    const def=definition("effect","reverb");
    await dispatch({cmd:"project.edit",...meta(),label:"Stress FX and motion",edits:[{type:"fx.put",trackId:t.id,effect:{id:crypto.randomUUID(),definitionId:"reverb",version:1,enabled:true,values:defaults(def)}},{type:"automation.put",automation:{id:crypto.randomUUID(),trackId:t.id,clipId:t.activeClipId,parameter:"room",enabled:true,bars:4,values:[0,.2,.5,.8,.3,0]}}]});
  }
  while(app.project.document.scenes.length<16) await dispatch({cmd:"project.edit",...meta(),label:"Stress scene",edits:[{type:"scene.duplicate",sceneId:app.project.document.sceneOrder[0],newSceneId:crypto.randomUUID(),name:`Scene ${app.project.document.scenes.length+1}`}]});
  for(let seed=0;seed<12;seed++) {const r=await app.dispatch({cmd:"jam.variation",...meta(),request:{seed,trackIds:app.project.document.tracks.map(t=>t.id),scopes:["rhythm"],intensity:"subtle"}});assert.ok(r.ok,JSON.stringify(r));}
  await sync(); await page.reload(); const began=performance.now(); await sync(); const rendered=performance.now()-began;
  await page.setViewportSize({width:1280,height:800}); await shot("large-project-1280");
  const cdp=await page.context().newCDPSession(page); await cdp.send("Performance.enable");
  const before=(await cdp.send("Performance.getMetrics")).metrics;
  let requests=0; const count=r=>{if(r.url().endsWith("/projects"))requests++;};page.on("request",count);
  await page.waitForTimeout(3000);
  const after=(await cdp.send("Performance.getMetrics")).metrics;page.off("request",count);
  const metric=(set,name)=>set.find(m=>m.name===name)?.value;
  evidence.performance={tracks:app.project.document.tracks.length,scenes:app.project.document.scenes.length,clips:app.project.document.clips.length,fx:app.project.document.tracks.reduce((n,t)=>n+(t.effects?.length??0),0),automation:app.project.document.automation.length,assets:app.project.document.assets.length,chops:app.project.document.clips.reduce((n,c)=>n+(c.slices?.length??0),0),ideas:app.projectState().jam.trail.length,renderAfterNavigationMs:rendered,idleTaskMs:(metric(after,"TaskDuration")-metric(before,"TaskDuration"))*1000,heapMiB:metric(after,"JSHeapUsedSize")/1048576,projectListRequestsDuringIdle:requests};
  assert.ok(evidence.performance.chops>0); assert.equal(requests,0); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Even a title-only edit to an empty project is authored work worth protecting.
  await dispatch({cmd:"project.new",...meta()});await sync();await save("empty-start");
  await page.getByLabel("Project name",{exact:true}).fill("Before the first beat");await page.getByLabel("Project name",{exact:true}).press("Enter");await sync();
  await click("My Jams");await click("Open jam empty-start");await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();assert.equal(app.project.document.name,"Before the first beat");
  assert.deepEqual(errors,[]);
  assert.deepEqual(evidence.accessibility.filter(v=>v.violations.length),[],"Accessibility violations remain");
  const names=["studio-1440","sound-lab-focused-1440","sampling-focused-1440","capture-focused-1440","jam-1440","performance-1440","system-1440","missing-asset-1440","save-error"];
  const sheet=await browser.newPage({viewport:{width:1500,height:1500}});
  await sheet.setContent(`<body style="margin:0;background:#dedbd2;font:16px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${names.map(n=>`<div><p>${n}</p><div style="height:420px;overflow:hidden"><img style="width:100%;height:auto" src="data:image/png;base64,${readFileSync(`${output}/${n}.png`).toString('base64')}"></div></div>`).join('')}</body>`);
  await sheet.screenshot({path:`${output}/contact-sheet.png`,fullPage:true});await sheet.close();
  evidence.status="passed";
  console.log("P5 WHOLE PRODUCT PASS", JSON.stringify(evidence.performance));
} finally {
  if(evidence.status === "running") evidence.status="failed";
  writeFileSync("../docs/p5-validation.json",JSON.stringify(evidence,null,2)+"\n");
  await browser.close(); await app.dispatch({cmd:"stop"}); engine.stop(); server.closeAllConnections(); await new Promise(r=>server.close(r)); rmSync(dir,{recursive:true,force:true});
}
