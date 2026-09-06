// Optional real Chromium check of the legacy dashboard + real project service,
// with an acknowledged fake engine so this test never touches an audio device.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { Application } from './dist/application.js';

const dir=mkdtempSync(path.join(tmpdir(),'abx-browser-'));
process.env.TIDAL_PROJECTS_DIR=dir;
const {startDashboard}=await import('./dist/dashboard.js');
const {chromium}=await import(process.env.ABX_PLAYWRIGHT||'playwright');
const engine={generation:0,running:false,state:'idle',error:null,
  async ensureBooted(){this.running=true;this.state='ready';},async reboot(){this.generation++;await this.ensureBooted();},assertGeneration(g){assert.equal(g,this.generation);},
  tidal:{async eval(code,id){return {operationId:id,acknowledgement:'action',output:''};},async hush(id){return this.eval('hush',id);}},
  sclang:{async eval(code,id){return {operationId:id,acknowledgement:'action',output:''};},async evalRoutine(code,id){return this.eval(code,id);}}};
const app=new Application(engine,{sets:dir,projects:dir,recovery:path.join(dir,'recovery'),recordings:dir,device:path.join(dir,'device')});
const state=()=>({status:engine.state,error:null,faultVersion:0,sessionId:app.sessionId,generation:engine.generation,slots:app.rig.slots,muted:[...app.rig.muted],solo:app.rig.solo,paused:app.rig.paused,stopped:app.rig.stopped,tempoBpm:app.rig.tempoBpm,synchronized:app.rig.synchronized,recording:false,devices:[],scopes:{},hits:{},...app.projectState()});
const server=startDashboard(0,fileURLToPath(new URL('./dashboard.html',import.meta.url)),state,()=>({}),c=>app.dispatchExternal(c));
await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:process.env.ABX_CHROMIUM||undefined});
const page=await browser.newPage({viewport:{width:1440,height:1400}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
const wait=async predicate=>{for(let i=0;i<120;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out waiting for project state');};
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/#steps');
  await page.locator('[data-act="seqadd"]').click();await wait(()=>app.project.document.tracks.length===1);
  await page.locator('.seqname').fill('bd');await page.locator('.seqname').press('Tab');await wait(()=>app.project.document.assets.some(a=>a.name==='bd'));
  const tid=app.project.document.tracks[0].id,cid=app.project.document.tracks[0].activeClipId;
  const undoBefore=app.project.history.undo;
  const first=page.locator('.pad[data-step="0"]'),second=page.locator('.pad[data-step="1"]');
  await first.waitFor();const a=await first.boundingBox(),b=await second.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:6});await page.mouse.up();
  await wait(()=>app.project.document.clips.find(c=>c.id===cid).steps[1]===1);assert.equal(app.project.history.undo,undoBefore+1,'pad painting is one undo intention');
  await page.locator('#undoBtn').click();await wait(()=>app.project.document.clips.find(c=>c.id===cid).steps[0]===0);
  await page.locator('#redoBtn').click();await wait(()=>app.project.document.clips.find(c=>c.id===cid).steps[1]===1);
  await page.locator('[data-act="mixer"]').click();
  const fader=page.locator('.fader[data-slot="d1"]');await fader.hover();const f=await fader.boundingBox(),beforeFader=app.project.history.undo;
  await page.mouse.move(f.x+f.width/2,f.y+f.height*.5);await page.mouse.down();await page.mouse.move(f.x+f.width/2,f.y+f.height*.8,{steps:8});await page.mouse.up();
  await wait(()=>app.project.document.tracks[0].mixer.level!==1);assert.equal(app.project.history.undo,beforeFader+1,'fader drag groups server history');assert.deepEqual(app.project.document.clips.find(c=>c.id===cid).steps.slice(0,2),[1,1]);
  await page.locator('[data-act="mixer"]').click();
  await page.locator('[data-act="curves"]').click();await page.locator('[data-curve="preset"][data-shape="up"]').click();
  await wait(()=>app.project.document.automation.length===1);await page.locator('[data-curve="toggle"]').click();await wait(()=>app.project.document.automation[0].enabled);
  await page.locator('[data-act="steps"]').click();
  await page.getByRole('button',{name:'B',exact:true}).click();await wait(()=>app.project.workspace.selectedSceneId===app.project.document.sceneOrder[1]);
  await page.locator('.pad[data-step="4"]').click();await wait(()=>app.project.document.clips.some(c=>c.kind==='steps'&&c.steps[4]===1));
  await page.getByRole('button',{name:'A',exact:true}).click();await wait(()=>app.project.document.tracks[0].activeClipId===cid);
  assert.deepEqual(app.project.document.clips.find(c=>c.id===cid).steps.slice(0,2),[1,1]);
  await page.locator('[data-act="seqadd"]').click();await wait(()=>app.project.document.tracks.length===2);
  const originalOrder=app.project.document.tracks.map(t=>t.id),sceneRefs=app.project.document.scenes,automationRefs=app.project.document.automation;
  await page.locator('.seqgrip[data-track="'+originalOrder[0]+'"]').dragTo(page.locator('.seqrow[data-track="'+originalOrder[1]+'"]'));
  await wait(()=>app.project.document.tracks[0].id===originalOrder[1]);assert.deepEqual(app.project.document.scenes,sceneRefs);assert.deepEqual(app.project.document.automation,automationRefs);
  await page.locator('#projectName').fill('browser-roundtrip');await page.getByRole('button',{name:'Save project',exact:false}).click();
  await page.locator('#projectSelect option[value="browser-roundtrip"]').waitFor({state:'attached'});
  const saved=app.project.document;
  await page.getByRole('button',{name:'New project',exact:true}).click();await wait(()=>app.project.document.id!==saved.id);
  await page.locator('#projectSelect').selectOption('browser-roundtrip');await page.getByRole('button',{name:'Open project',exact:true}).click();await wait(()=>app.project.document.id===saved.id);
  assert.deepEqual(app.project.document.clips,saved.clips);assert.deepEqual(app.project.document.automation,saved.automation);assert.deepEqual(app.project.document.scenes,saved.scenes);
  // An external MCP-equivalent edit while a pointer draft is open must reject
  // the stale draft, including after locally acknowledged revisions in this tab.
  const target=page.locator('.pad[data-track="'+tid+'"][data-step="7"]');await target.hover();const box=await target.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  const current=app.project.document;const external=await app.dispatchExternal({cmd:'project.edit',projectId:current.id,revision:current.revision,label:'External edit',edits:[{type:'project.rename',name:'External name'}]});assert.equal(external.ok,true);
  await page.mouse.up();await page.locator('#consoleOut').filter({hasText:'Project changed'}).waitFor();assert.equal(app.project.document.clips.find(c=>c.id===cid).steps[7],0);
  await page.locator('[data-act="stop"]').click();await wait(()=>app.rig.stopped);assert.ok(app.project.document.tracks.some(t=>t.id===tid));
  await page.screenshot({path:fileURLToPath(new URL('../docs/p0b-dashboard-validation.png',import.meta.url)),fullPage:true});
  assert.deepEqual(errors,[]);console.log('BROWSER PASS: real pointer painting, fader grouping, automation, scene switching, undo/redo, complete save/reopen, Stop and no JavaScript errors.');
}catch(e){console.error('Browser error details:',errors,await page.locator('#consoleOut').textContent(),JSON.stringify(app.projectState()));await page.screenshot({path:fileURLToPath(new URL('../docs/p0b-dashboard-failure.png',import.meta.url)),fullPage:true});throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
