// P2.5 investigation: start takes immediately after acknowledged transitions.
// Deliberately no wait-for-nonzero precondition: that would conceal ordering bugs.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Application } from "./dist/application.js";
import { Engine, assertAudioPortsFree } from "./dist/engine.js";
import { Meter } from "./dist/meter.js";
import { pocketGroove } from "./dist/studio-starter.js";
import { DIRT_SAMPLES_DIR, METER_UDP_PORT } from "./dist/config.js";

const dir=mkdtempSync(path.join(tmpdir(),"abx-record-ordering-")), engine=new Engine(), meter=new Meter();
const app=new Application(engine,{sets:dir,recordings:path.join(dir,"recordings"),projects:path.join(dir,"projects"),recovery:path.join(dir,"recovery"),device:path.join(dir,"device"),samples:DIRT_SAMPLES_DIR});
const telemetry=[], logs=[], results=[];
app.lifecycleHooks.log=(source,message)=>logs.push({at:Date.now(),source,message});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const send=async(cmd,args={})=>{const p=app.project.document;const r=await app.dispatchExternal({cmd,projectId:p.id,revision:p.revision,...args});assert.ok(r.ok,JSON.stringify(r));return r;};
const sample=setInterval(()=>{telemetry.push({at:Date.now(),generation:engine.generation,revision:app.project.document.revision,recording:app.rig.recording,left:meter.l,right:meter.r,meterAt:meter.lastUpdate,cycle:meter.cycle,cycleAt:meter.cycleAt,hits:{...meter.hits},scopes:structuredClone(meter.scopes)});if(telemetry.length>4000)telemetry.shift();},25);
const record=async(label,expectedSignal=true,during=async()=>{})=>{
  const at=Date.now(); await send("record.start"); const id=app.projectState().recordingState.id;
  await during(); await delay(expectedSignal?2500:600); await send("record.stop",{value:id});
  const entry=app.recordings.get(id); results.push({label,expectedSignal,entry});
  assert.equal(entry.state,"ready"); assert.equal(entry.diagnostics.probe,"captured");
  assert.ok(entry.diagnostics.input.seconds>0.4,"audio DSP must advance even for intentional silence");
  if(expectedSignal){
    assert.ok(entry.audio.peak>100,`${label}: structurally valid silence is not musical success`);
    assert.ok(entry.diagnostics.input.peak>100/32768,`${label}: recorder input must contain music`);
    assert.ok(telemetry.some(x=>x.at>=at&&x.meterAt>=at&&Math.max(x.left,x.right)>0.001),`${label}: independent project master must contain music`);
  } else {assert.equal(entry.audio.peak,0);assert.equal(entry.diagnostics.input.peak,0);assert.ok(entry.warning);}
  console.log(label,JSON.stringify({peak:entry.audio.peak,input:entry.diagnostics.input,generation:engine.generation}));
};
try {
  await meter.start(METER_UDP_PORT);
  await send("pause");await send("project.edit",{label:"Starter",edits:pocketGroove(app.project.document)});await send("project.save",{value:"ordering"});
  // Cold preparation is not a promise of nonzero music: recording before Play is legitimate silence.
  await record("cold preparation while stopped",false);
  await send("resume");await record("immediate first Play");
  const preview=app.sounds().find(s=>s.bank==="sd").key;
  for(let i=0;i<4;i++){
    await send("project.new");await delay([0,17,63,177][i]);await send("project.load",{value:"ordering"});
    await record(`project switch ${i+1}`,true,async()=>{await send("preview.play",{value:preview});await send("preview.stop");});
    await send("solo",{slot:"d2"});await send("mute",{slot:"d2"});await send("unmute",{slot:"d2"});await send("unsolo");
    await record(`mixer restore ${i+1}`);
  }
  const restart=app.dispatch({cmd:"audio.restart",sessionId:app.sessionId,expectedGeneration:engine.generation});
  const blocked=await app.dispatch({cmd:"record.start"});assert.ok(!blocked.ok&&blocked.code==="BUSY");assert.ok((await restart).ok);
  await record("immediate audio restart");
  await send("pause");await send("preview.stop");await delay(2000);await record("intentional stopped silence",false);
  await send("resume");for(const slot of ["d1","d2","d3","d4"])await send("mute",{slot});await delay(2000);await record("intentional all-muted silence",false);
  assert.equal(engine.error,null);
  mkdirSync("../recordings/p25-investigation",{recursive:true});
  const report={at:new Date().toISOString(),device:engine.currentDevice,results,telemetry,logs};
  writeFileSync(`../recordings/p25-investigation/ordering-${Date.now()}.json`,JSON.stringify(report,null,2));
  writeFileSync("../docs/p25-recording-ordering.json",JSON.stringify({...report,telemetry:undefined},null,2)+"\n");
  console.log(`RECORDING ORDERING PASS: ${results.length} takes; immediate transitions, Preview teardown, mute/solo, lifecycle admission, intentional silence.`);
} catch(e) {
  const evidence=`../recordings/p25-investigation/ordering-failure-${Date.now()}`;cpSync(dir,evidence,{recursive:true});
  writeFileSync(path.join(evidence,"diagnostics.json"),JSON.stringify({state:app.projectState(),rig:app.rig,results,telemetry,logs,tidal:engine.tidal.tail(64000),supercollider:engine.sclang.tail(64000)},null,2));
  console.error("Preserved failure:",path.resolve(evidence));throw e;
} finally {clearInterval(sample);meter.stop();engine.stop();await assertAudioPortsFree();rmSync(dir,{recursive:true,force:true});}
