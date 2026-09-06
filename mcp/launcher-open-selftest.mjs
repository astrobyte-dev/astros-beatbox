// Exercise the actual Windows URL association, not Playwright or --no-open.
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runtimeKey, RUNTIME_PROTOCOL } from "./dist/runtime.js";

assert.equal(process.platform,"win32");
const dir=mkdtempSync(path.join(tmpdir(),"abx-launch-open-")), stop=path.join(dir,"stop"), trace=path.join(dir,"windows.tsv");
let visit, watcher, launcher, timer;
const visited=new Promise(resolve=>{visit=resolve;});
const server=http.createServer((req,res)=>{
  if(req.url==="/runtime") {res.setHeader("content-type","application/json");res.end(JSON.stringify({kind:"astros-beatbox-runtime",protocol:RUNTIME_PROTOCOL,key:runtimeKey,ready:true,sessionId:randomUUID(),pid:process.pid}));return;}
  if(req.url==="/studio?alreadyRunning=1") {
    visit({url:req.url,userAgent:req.headers["user-agent"]});
    if(process.env.ABX_LAUNCH_TARGET){res.writeHead(302,{location:process.env.ABX_LAUNCH_TARGET});res.end();}
    else {res.setHeader("content-type","text/html");res.end("<title>Beatbox launch check passed</title><h1>Beatbox launch check passed</h1><p>Your default browser opened successfully. You can close this test tab.</p>");}
    return;
  }
  res.writeHead(404);res.end();
});
const report={browserVisit:null,consoleShows:[]};
try {
  server.listen(0,"127.0.0.1");await once(server,"listening");
  watcher=spawn("powershell.exe",["-NoProfile","-NonInteractive","-File",path.resolve("watch-windows.ps1"),"-OutputFile",trace,"-StopFile",stop],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
  assert.match(String((await once(watcher.stdout,"data"))[0]),/WATCH_READY/);
  launcher=spawn("wscript.exe",[path.resolve("../Launch Beatbox.vbs")],{env:{...process.env,TIDAL_DASH_PORT:String(server.address().port)},windowsHide:true,stdio:"ignore"});
  const exited=once(launcher,"exit");
  report.browserVisit=await Promise.race([visited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Default browser did not request Studio")),25000);})]);
  assert.equal((await exited)[0],0);
  await new Promise(r=>setTimeout(r,1000));
} finally {
  clearTimeout(timer);server.close();server.closeAllConnections();
  if(launcher?.exitCode===null)launcher.kill();
  if(watcher){const exited=once(watcher,"exit");writeFileSync(stop,"stop");await exited;}
  const events=readFileSync(trace,"utf8").trim().split(/\r?\n/).filter(Boolean);
  report.consoleShows=events.filter(line=>/ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS|\t(?:cmd|powershell|cscript|node|conhost)\t/i.test(line));
  writeFileSync("../docs/p25-browser-launch-measurements.json",JSON.stringify(report,null,2)+"\n");
  rmSync(dir,{recursive:true,force:true});
}
assert.ok(report.browserVisit);assert.deepEqual(report.consoleShows,[]);
console.log("DEFAULT BROWSER LAUNCH PASS:",JSON.stringify(report));
