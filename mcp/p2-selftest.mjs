// One complete production-browser journey, run with deterministic fake audio or
// --live for the owned Windows engine. Live tests must run sequentially.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";
import { Application } from "./dist/application.js";
import { validateWav } from "./dist/recordings.js";
const live = process.argv.includes("--live");
const dir=mkdtempSync(path.join(tmpdir(),"abx-p2-journey-"));
process.env.TIDAL_PROJECTS_DIR=path.join(dir,"projects");
const { startDashboard }=await import("./dist/dashboard.js");
const { DIRT_SAMPLES_DIR, METER_UDP_PORT }=await import("./dist/config.js");
function fakeWav() {
  const b=Buffer.alloc(44+48000*4); b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(b.length-44,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(Math.round(3000*Math.sin(i/30)),i);return b;
}
const samples=live ? DIRT_SAMPLES_DIR : path.join(dir,"samples");
if(!live) for(const bank of ["bd","sd","hh","cp"]) {mkdirSync(path.join(samples,bank),{recursive:true});for(const file of ["a.wav","b.wav"])writeFileSync(path.join(samples,bank,file),fakeWav());}
const calls=[];
let engine,meter;
if(live) {const {Engine}=await import("./dist/engine.js");const {Meter}=await import("./dist/meter.js");engine=new Engine();meter=new Meter();}
else {
  const evaluate=async(code,operationId)=>{calls.push(code);await new Promise(r=>setTimeout(r,100));if(code.includes("~recBuf.close"))writeFileSync(app.rig.recPath,fakeWav());return{operationId,acknowledgement:"action",output:"ABX_PREVIEW 1"};};
  engine={generation:0,running:false,state:"idle",error:null,async ensureBooted(){this.running=true;this.state="ready";},async reboot(){this.generation++;await this.ensureBooted();},assertGeneration(g){assert.equal(g,this.generation);},tidal:{eval:evaluate,hush:id=>evaluate("hush",id)},sclang:{eval:evaluate,evalRoutine:evaluate},stop(){this.running=false;}};
}
const app=new Application(engine,{sets:dir,recordings:path.join(dir,"recordings"),projects:process.env.TIDAL_PROJECTS_DIR,recovery:path.join(dir,"recovery"),device:path.join(dir,"device"),samples});
const state=()=>({...app.projectState(),sessionId:app.sessionId,generation:engine.generation,status:engine.state,error:engine.error,stopped:app.rig.stopped,paused:app.rig.paused,synchronized:app.rig.synchronized,recording:app.rig.recording,recPath:app.rig.recPath,slots:app.rig.slots});
const server=startDashboard(0,path.resolve("dashboard.html"),state,()=>({cycle:meter?.cycle??0,cps:meter?.cps??0,lead:meter?.lead??0,age:meter?Date.now()-meter.cycleAt:9999}),c=>app.dispatchExternal(c),{sounds:()=>app.sounds(),recordings:app.recordings});
await once(server,"listening");
const url=`http://127.0.0.1:${server.address().port}`;
let browser,page;
const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Journey condition timed out");};
const sync=async()=>{await page.waitForFunction(rev=>document.querySelector(".studio-app")?.dataset.revision===String(rev),app.project.document.revision);await page.waitForFunction(()=>!document.querySelector(".feedback").textContent.includes("waiting for confirmation"));};
const send=async(cmd,args={})=>{const p=app.project.document;const r=await app.dispatchExternal({cmd,projectId:p.id,revision:p.revision,...args});assert.ok(r.ok,JSON.stringify(r));return r;};
try {
  if(meter)await meter.start(METER_UDP_PORT);
  browser=await chromium.launch({headless:true,executablePath:process.env.ABX_CHROMIUM||undefined});page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));page.on("console",m=>{if(m.type()==="error"&&!m.text().includes("409"))errors.push(m.text());});
  await page.goto(url+"/studio");await page.getByRole("button",{name:"Start Pocket groove",exact:true}).click();await wait(()=>app.project.document.tracks.length===4);await sync();
  await page.getByRole("button",{name:"Play",exact:true}).click();await page.getByRole("button",{name:"Pause",exact:true}).waitFor({timeout:120000});await sync();
  await page.getByRole("button",{name:"Snare step 2",exact:true}).click();await wait(()=>app.project.document.clips[1].steps[1]===1);await sync();
  const original=app.project.document.clips[1], history=app.project.history.undo;
  await page.getByRole("button",{name:"Sounds",exact:true}).click();await page.getByLabel("Sound bank",{exact:true}).selectOption("sd");
  const choices=app.sounds().filter(s=>s.bank==="sd"), choice=choices[1];assert.ok(choice);
  await page.getByRole("button",{name:`Preview ${choice.label} ${choice.file}`,exact:true}).click();await sync();assert.equal(app.project.history.undo,history);assert.deepEqual(app.project.document.clips[1],original);
  await page.getByRole("button",{name:"Replace Snare",exact:true}).click();await wait(()=>app.project.document.clips[1].assetId!==original.assetId);await sync();
  assert.deepEqual({...app.project.document.clips[1],assetId:original.assetId},original);const replacement=app.project.document.assets.at(-1);assert.equal(replacement.source.file,choice.key);
  await page.getByRole("button",{name:/^Undo:/}).click();await wait(()=>app.project.document.clips[1].assetId===original.assetId);await sync();
  // Keep the replacement for the persisted-identity half of the journey.
  await page.getByRole("button",{name:/^Redo:/}).click();await wait(()=>app.project.document.clips[1].assetId===replacement.id);await sync();
  for(const width of [1280,1440,1920]) {await page.setViewportSize({width,height:1000});await page.screenshot({path:`../docs/p2-sounds-${width}${live?"-live":""}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:1440,height:1000});await page.getByRole("button",{name:"Save jam",exact:true}).click();await page.getByRole("textbox",{name:"Save as",exact:true}).fill("p2-journey");await page.getByRole("dialog").getByRole("button",{name:"Save jam",exact:true}).click();await page.getByRole("dialog").waitFor({state:"detached"});
  await page.getByRole("button",{name:"My Jams",exact:true}).click();await page.getByRole("button",{name:"New empty jam",exact:true}).click();await page.getByRole("button",{name:"Start new jam",exact:true}).click();await wait(()=>app.project.document.tracks.length===0);await sync();
  await page.getByRole("button",{name:"Open jam p2-journey",exact:true}).click();await wait(()=>app.project.document.tracks.length===4);await sync();assert.deepEqual(app.project.document.assets.at(-1),replacement);
  const gen=engine.generation;await page.reload();await page.getByRole("button",{name:"Pause",exact:true}).waitFor();assert.equal(engine.generation,gen);assert.equal(app.rig.paused,false);
  await page.getByRole("button",{name:"Record",exact:true}).click();await wait(()=>app.rig.recording);await sync();const take=app.projectState().recordingState.id;
  // Preview during a take exercises the real separation, not just a disabled UI.
  await page.getByRole("button",{name:"Sounds",exact:true}).click();await page.getByRole("button",{name:`Preview ${choice.label} ${choice.file}`,exact:true}).click();await sync();
  await new Promise(r=>setTimeout(r,live?2200:200));await page.getByRole("button",{name:"Finish recording",exact:true}).click();await wait(()=>app.recordings.get(take)?.state==="ready");await sync();
  const entry=app.recordings.get(take);assert.ok(entry.audio.peak>0);const audio=page.locator(`li[data-recording-id="${take}"] audio`);await audio.waitFor();
  await audio.evaluate(async el=>{await el.play();});await page.waitForFunction(id=>document.querySelector(`li[data-recording-id="${id}"] audio`)?.currentTime>0,take);await audio.evaluate(el=>el.pause());
  const downloadEvent=page.waitForEvent("download");await page.locator(`li[data-recording-id="${take}"]`).getByRole("link",{name:"Download WAV"}).click();const download=await downloadEvent;const downloaded=await download.path();assert.deepEqual(readFileSync(downloaded),readFileSync(app.rig.recPath));
  await page.screenshot({path:`../docs/p2-recordings${live?"-live":""}.png`,fullPage:true});
  await send("project.edit",{label:"Rename after recording",edits:[{type:"project.rename",name:"Kept recording"}]});await send("project.undo");assert.equal(app.recordings.get(take).state,"ready");
  await page.reload();await page.getByRole("button",{name:"Recordings",exact:true}).click();await audio.waitFor();
  if(live) {
    mkdirSync("../recordings/p2-validation",{recursive:true});copyFileSync(app.rig.recPath,"../recordings/p2-validation/journey.wav");
    console.log("P2 LIVE journey recording:",JSON.stringify(entry.audio));
    await send("pause");await send("preview.stop");await new Promise(r=>setTimeout(r,2000));
    // Capture physical bus 0 after the preview group as a simultaneous probe,
    // while the application recorder captures only the pre-preview mix tap.
    const physical=path.join(dir,"physical.wav").replace(/\\/g,"/");
    await engine.sclang.evalRoutine(`~probeBuf = Buffer.alloc(s,65536,2); s.sync; ~probeBuf.write("${physical}","wav","int16",0,0,true); s.sync; ~probeSynth = Synth.tail(RootNode(s), \\diskrec, [\\buf,~probeBuf.bufnum,\\bus,0]); s.sync;`,"physical-probe");
    await send("record.start");const exclusion=app.projectState().recordingState.id;
    // Switch before these samples finish, including mono and stereo synth paths.
    const kick=app.sounds().find(s=>s.bank==="bd");assert.ok(kick);
    const auditionKeys=[kick.key,choices[0].key,choice.key,kick.key,choice.key,choices[0].key];
    for(const key of auditionKeys){await send("preview.play",{value:key});await new Promise(r=>setTimeout(r,50));}
    await send("preview.stop");await send("record.stop",{value:exclusion});
    await engine.sclang.evalRoutine("~probeSynth.free; s.sync; ~probeBuf.close; s.sync; ~probeBuf.free; s.sync;","physical-finalize");
    const excluded=app.recordings.get(exclusion).audio, audible=validateWav(physical);
    assert.ok(audible.peak>100,"preview must reach physical output");assert.equal(excluded.peak,0,"preview must be completely absent from application recording");
    copyFileSync(physical,"../recordings/p2-validation/preview-output.wav");copyFileSync(app.rig.recPath,"../recordings/p2-validation/preview-excluded.wav");
    writeFileSync("../docs/p2-audio-measurements.json",JSON.stringify({journey:entry.audio,previewPhysical:audible,previewExcluded:excluded,auditionKeys,device:engine.currentDevice},null,2)+"\n");
    console.log("P2 LIVE preview output / excluded recording:",JSON.stringify({audible,excluded}));
  }
  assert.deepEqual(errors,[]);assert.equal(engine.error,null);
  console.log(`P2 ${live?"LIVE":"FAKE"} BROWSER PASS: starter -> rhythm -> Preview -> Replace -> Undo/Redo -> Save -> reopen -> frontend reconnect -> Record/Preview -> finalize -> playback/download -> catalog after Undo/reload; three desktop widths; no JS/CSP errors.`);
} catch(e) {if(page)await page.screenshot({path:"../docs/p2-failure.png",fullPage:true});console.error("P2 state:",JSON.stringify(state()));throw e;}
finally {await browser?.close();server.close();server.closeAllConnections();meter?.stop();engine.stop();if(live){const {assertAudioPortsFree}=await import("./dist/engine.js");await assertAudioPortsFree();}rmSync(dir,{recursive:true,force:true});}
