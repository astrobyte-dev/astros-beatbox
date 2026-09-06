// Opt-in real Windows engine owned by the persistent runtime; MCP adapters can
// disappear while both the composition and recorder continue running.
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
import { pocketGroove } from "./dist/studio-starter.js";
import { assertAudioPortsFree } from "./dist/engine.js";
await assertAudioPortsFree();
const reserve=http.createServer();reserve.listen(0,"127.0.0.1");await once(reserve,"listening");const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const dir=mkdtempSync(path.join(tmpdir(),"abx-p2-runtime-live-")),url=`http://127.0.0.1:${port}`;
const env={...process.env,TIDAL_DASH_PORT:String(port),TIDAL_PROJECTS_DIR:path.join(dir,"projects"),TIDAL_RECOVERY_DIR:path.join(dir,"recovery"),TIDAL_RECORDINGS_DIR:path.join(dir,"recordings")};
const clients=[];
const connect=async()=>{const c=new Client({name:"p2-live-reconnect",version:"1"});clients.push(c);await c.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve("dist/server.js")],env,stderr:"pipe"}));return c;};
const status=async()=>{const r=await fetch(url+"/state");assert.ok(r.ok);return r.json();};
const send=async(cmd,args={})=>{const s=await status();const r=await(await fetch(url+"/cmd",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({cmd,projectId:s.project.id,revision:s.project.revision,sessionId:s.sessionId,...args})})).json();assert.ok(r.ok,JSON.stringify(r));return r;};
const peak=async()=>{let max=0;for(let i=0;i<25;i++){const s=await status();max=Math.max(max,s.meterL+s.meterR);await new Promise(r=>setTimeout(r,100));}assert.ok(max>0.03,"music must remain audible");return max;};
let browser;
try {
  const a=await connect();let s=await status();await send("project.edit",{edits:pocketGroove(s.project),label:"Starter"});
  console.log("P2 reconnect: preparing the persistent Windows engine...");await send("resume");s=await status();const before=await peak();
  await send("record.start");const take=(await status()).recordingState.id;
  browser=await chromium.launch({headless:true,executablePath:process.env.ABX_CHROMIUM||undefined});const page=await browser.newPage();await page.goto(url+"/studio");await page.getByRole("button",{name:"Pause",exact:true}).waitFor();
  await a.close();await page.reload();await page.getByRole("button",{name:"Pause",exact:true}).waitFor();await page.close();
  const disconnected=await peak();const b=await connect();const result=await b.callTool({name:"status",arguments:{}});const after=JSON.parse(result.content[0].text);
  assert.equal(after.sessionId,s.sessionId);assert.equal(after.generation,s.generation);assert.equal(after.paused,false);assert.equal(after.recording,true);const reconnected=await peak();
  await send("record.stop",{value:take});const entry=(await status()).recordings.find(r=>r.id===take);assert.equal(entry.state,"ready");assert.ok(entry.audio.peak>100);assert.ok(entry.audio.duration>5);
  const download=await fetch(url+`/recordings/${take}.wav`);assert.equal(download.status,200);assert.equal((await download.arrayBuffer()).byteLength,entry.audio.bytes);
  writeFileSync("../docs/p2-runtime-measurements.json",JSON.stringify({before,disconnected,reconnected,generation:s.generation,recording:entry.audio},null,2)+"\n");
  console.log("P2 LIVE RECONNECT PASS:",JSON.stringify({before,disconnected,reconnected,recording:entry.audio}));
} finally {
  await browser?.close();for(const c of clients)await c.close();
  try {const info=await(await fetch(url+"/runtime")).json();const r=await fetch(url+"/runtime/stop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:info.sessionId})});assert.equal(r.status,200);for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,100));try{await fetch(url+"/runtime");}catch{break;}}}finally{await assertAudioPortsFree();rmSync(dir,{recursive:true,force:true});}
}
