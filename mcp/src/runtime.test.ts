import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("P2 fixed-port runtime survives MCP/frontend reconnect, shares revision/deduplication and recovers stopped after explicit restart", { timeout: 30000 }, async () => {
  const reserve = http.createServer(); reserve.listen(0,"127.0.0.1"); await once(reserve,"listening"); const port=(reserve.address() as {port:number}).port; await new Promise<void>(r=>reserve.close(()=>r()));
  const dir=mkdtempSync(path.join(tmpdir(),"abx-runtime-test-")), url=`http://127.0.0.1:${port}`;
  const env={...process.env as Record<string,string>,TIDAL_DASH_PORT:String(port),TIDAL_METER_PORT:"0",TIDAL_PROJECTS_DIR:path.join(dir,"projects"),TIDAL_RECOVERY_DIR:path.join(dir,"recovery"),TIDAL_RECORDINGS_DIR:path.join(dir,"recordings")};
  const clients: Client[]=[];
  const connect=async()=>{ const c=new Client({name:"p2-reconnect",version:"1"}); clients.push(c); await c.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL("server.js",import.meta.url))],env,stderr:"pipe"})); return c; };
  const status=async(c:Client)=>JSON.parse(((await c.callTool({name:"status",arguments:{}})).content as {text:string}[])[0].text);
  const stop=async()=>{ try { const info=await(await fetch(url+"/runtime")).json(); const r=await fetch(url+"/runtime/stop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:info.sessionId})}); assert.equal(r.status,200); for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,20));try{await fetch(url+"/runtime");}catch{return;}} throw new Error("Runtime did not close"); } catch(e){if(!(e instanceof TypeError))throw e;} };
  try {
    const a=await connect(), initial=await status(a);
    mkdirSync(env.TIDAL_RECORDINGS_DIR,{recursive:true});
    const sidecar=path.join(env.TIDAL_RECORDINGS_DIR,"12345678-1234-4234-8234-123456789012.recording.json");
    const ongoing=JSON.stringify({id:"12345678-1234-4234-8234-123456789012",projectId:initial.project.id,name:"Ongoing",createdAt:new Date().toISOString(),state:"recording"});
    writeFileSync(sidecar,ongoing);
    const loser=spawn(process.execPath,[fileURLToPath(new URL("runtime.js",import.meta.url))],{env,windowsHide:true,stdio:"ignore"});
    assert.equal((await once(loser,"exit"))[0],1);assert.equal(readFileSync(sidecar,"utf8"),ongoing,"failed port owner cannot reconcile another runtime's recordings");
    const request={cmd:"project.edit",projectId:initial.project.id,revision:initial.project.revision,label:"Keep me",edits:[{type:"project.rename",name:"Persistent jam"}],operationId:"reconnect-intention",sessionId:initial.sessionId,issuedAt:Date.now()};
    const response=await(await fetch(url+"/cmd",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)})).json(); assert.equal(response.ok,true);
    await a.close();
    const frontend=await(await fetch(url+"/state")).json(); assert.equal(frontend.sessionId,initial.sessionId); assert.equal(frontend.project.name,"Persistent jam");
    const b=await connect(), c=await connect(); const reconnected=await status(b); assert.equal(reconnected.sessionId,initial.sessionId); assert.equal(reconnected.generation,initial.generation); assert.equal((await status(c)).history.undo,1);
    const retry=await(await fetch(url+"/cmd",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)})).json(); assert.deepEqual(retry,response);
    await b.close(); await c.close(); await stop();
    const d=await connect(), restarted=await status(d); assert.notEqual(restarted.sessionId,initial.sessionId); assert.equal(restarted.project.name,"Persistent jam"); assert.equal(restarted.stopped,true); assert.equal(restarted.state,"idle");
    const stale=await(await fetch(url+"/cmd",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)})).json(); assert.equal(stale.code,"STALE_SESSION");
  } finally { for(const c of clients) await c.close(); await stop(); rmSync(dir,{recursive:true,force:true}); }
});
