  var cur={slots:{},muted:[],solo:null,paused:false,status:"idle",hits:{},tempoBpm:0,spectrum:[],recording:false,scope:false,scopes:{}};
  var collapsed={};
  function applyExpl(){ var s=cur.slots||{}; for(var k in s){ var el=document.getElementById("expl-"+k); if(el) el.classList.toggle("hidden", !!collapsed[k]); } }

  // ---- digital rain ----
  (function(){ var cv=document.getElementById("rain"); var ctx=cv.getContext("2d"); var cols,drops,fs=14;
    var chars="ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃ0123456789ABCDEFｦ".split("");
    function resize(){ cv.width=innerWidth; cv.height=innerHeight; cols=Math.floor(cv.width/fs); drops=[]; for(var i=0;i<cols;i++)drops[i]=Math.random()*cv.height/fs; }
    resize(); addEventListener("resize",resize);
    setInterval(function(){ ctx.fillStyle="rgba(4,7,10,.18)"; ctx.fillRect(0,0,cv.width,cv.height);
      ctx.fillStyle="#00ff5e"; ctx.font=fs+"px monospace";
      for(var i=0;i<cols;i++){ ctx.fillText(chars[Math.floor(Math.random()*chars.length)], i*fs, drops[i]*fs);
        if(drops[i]*fs>cv.height && Math.random()>0.975) drops[i]=0; drops[i]++; } }, 55);
  })();

  var SAMP={bd:"kick drum",sn:"snare",sd:"snare",hh:"hi-hat",hc:"closed hat",ho:"open hi-hat",cp:"clap",cr:"crash",rim:"rimshot",perc:"percussion",east:"tabla / hand drum",click:"click",tink:"tink",metal:"metallic hit",arpy:"plucky synth",jvbass:"bass",bass:"bass","808":"808 drum",wind:"wind / atmosphere",yeah:"vocal 'yeah'",voodoo:"vocal"};
  var SYNTH={supersaw:"a buzzy saw synth",superpiano:"a piano / Rhodes",superhoover:"a rave 'hoover' synth",supersquare:"a square synth","default":"a basic synth"};
  function joinNice(a){ return a.length<=1?a.join(""):a.slice(0,-1).join(", ")+" and "+a[a.length-1]; }
  function fnum(code,p){ var m=code.match(new RegExp("#\\s*"+p+"\\s+([-\\d.]+)")); return m?parseFloat(m[1]):null; }
  function explain(code){ try{
    var sm=code.match(/(?:^|[^a-z])(?:s|sound)\s+"([^"]+)"/),nm=code.match(/(?:^|[^a-z])(?:note|n)\s+"([^"]+)"/),
        syn=code.match(/(?:s|sound)\s+"(super\w+|default)"/),head,lead="";
    if(nm){ var oct=(nm[1].match(/[a-g][sf]?(-?\d)/i)||[])[1], sy=syn?(SYNTH[syn[1]]||"a synth"):"a synth";
      if(/'(min|maj|dom|sus|aug|dim)/.test(nm[1])){ head="🎹 Chords"; lead="musical chords on "+sy; }
      else if(oct!=null&&oct<=2){ head="🔊 Bassline"; lead="deep low notes on "+sy; }
      else if(oct!=null&&oct>=5){ head="🎵 Lead melody"; lead="high notes on "+sy; }
      else { head="🎵 Melody"; lead="notes on "+sy; }
    } else if(sm){ var toks=sm[1].replace(/[~\[\]<>*.()!0-9:]/g," ").split(/\s+/).filter(Boolean),uniq=[];
      toks.forEach(function(t){if(uniq.indexOf(t)<0)uniq.push(t);});
      head="🥁 "+((SAMP[uniq[0]]||uniq[0]||"Drums")); head=head.charAt(0)+head.slice(1);
      lead="plays "+uniq.map(function(t){return SAMP[t]||t;}).join(", "); } else head="⚙ Pattern";
    var d=[];
    if(/swingBy/.test(code)) d.push("a swung, off-grid groove");
    if(/degradeBy|sometimesBy/.test(code)) d.push("random hits dropped (loose &amp; human)");
    if(/stut/.test(code)) d.push("stutter-glitches");
    if(/\bslow\b/.test(code)) d.push("slowed &amp; stretched out");
    if(/<[^>]+>/.test(code)) d.push("changing a little each bar");
    var g=fnum(code,"gain"); if(g!=null){ if(g>=1.1)d.push("turned up loud"); else if(g<=0.55)d.push("kept low in the mix"); }
    if(/cutoff\s*\(\s*range/.test(code)) d.push("a filter slowly opening &amp; closing");
    else { var cut=fnum(code,"cutoff"); if(cut!=null){ if(cut<=800)d.push("filtered dark &amp; muffled"); else if(cut>=4000)d.push("bright &amp; open"); } }
    if(fnum(code,"shape")!=null||fnum(code,"crush")!=null) d.push("dirtied up &amp; distorted");
    var rm=fnum(code,"room"); if(rm!=null&&rm>=0.3) d.push("spacious with reverb");
    if(fnum(code,"delay")!=null) d.push("echoing");
    if(/vowel/.test(code)) d.push("shaped like a voice (ooh/aah)");
    if(/speed\s*\(\s*range/.test(code)) d.push("with random pitch-wobble");
    else { var sp=fnum(code,"speed"); if(sp!=null){ if(sp<0.95)d.push("pitched down (deeper)"); else if(sp>1.05)d.push("pitched up"); } }
    if(/pan\s+rand/.test(code)) d.push("bouncing left/right");
    return "<b>"+head+"</b>"+(lead?" — "+lead:"")+(d.length?('.<br><span class="fx">It\'s '+joinNice(d)+'.</span>'):".");
  }catch(e){ return ""; } }

  var KNOBS=[{p:"gain",l:"vol",min:0,max:2,step:0.05,def:1},{p:"cutoff",l:"lpf",min:200,max:9000,step:50,def:9000},
    {p:"shape",l:"dist",min:0,max:0.8,step:0.02,def:0},{p:"room",l:"verb",min:0,max:1,step:0.02,def:0},{p:"pan",l:"pan",min:0,max:1,step:0.02,def:0.5}];

  var dispL=0,dispR=0,tgtL=0,tgtR=0;
  function anim(){ tgtL*=0.86;tgtR*=0.86;dispL+=(tgtL-dispL)*0.4;dispR+=(tgtR-dispR)*0.4;
    document.getElementById("mL").style.width=(Math.sqrt(dispL)*100).toFixed(1)+"%";
    document.getElementById("mR").style.width=(Math.sqrt(dispR)*100).toFixed(1)+"%"; requestAnimationFrame(anim); }
  requestAnimationFrame(anim);
  function flashLoop(){ var s=cur.slots||{},h=cur.hits||{};
    for(var k in s){ var el=document.getElementById("dot-"+k); if(!el||el.classList.contains("off"))continue;
      var v=Math.max(0,1-(Date.now()-(h[k]||0))/220); el.style.opacity=(0.25+v*0.75).toFixed(2);
      el.style.transform="scale("+(1+v*0.8).toFixed(2)+")"; el.style.boxShadow=(v>0.06)?("0 0 "+(3+v*11).toFixed(0)+"px var(--green)"):"none"; }
    requestAnimationFrame(flashLoop); }
  requestAnimationFrame(flashLoop);
  var sdisp=[];
  function drawSpec(){ var cv=document.getElementById("spectrum");
    if(cv){ var W=cv.clientWidth||600; if(cv.width!==W)cv.width=W; var H=cv.height; var ctx=cv.getContext("2d");
      var data=cur.spectrum||[],n=Math.max(1,data.length),bw=W/n; ctx.clearRect(0,0,W,H);
      for(var i=0;i<n;i++){ sdisp[i]=(sdisp[i]||0)*0.78+(data[i]||0)*0.22;
        var v=Math.min(1,Math.sqrt(sdisp[i])*1.7),bh=Math.max(1,v*(H-3));
        var wl=645-(n>1?(i/(n-1)):0)*(645-470),rc=wlRGB(wl);
        var g=ctx.createLinearGradient(0,H,0,H-bh); g.addColorStop(0,"rgba("+rc[0]+","+rc[1]+","+rc[2]+",0.35)"); g.addColorStop(1,"rgb("+rc[0]+","+rc[1]+","+rc[2]+")");
        ctx.fillStyle=g; ctx.fillRect(i*bw+1.5,H-bh,Math.max(1,bw-3),bh); } }
    requestAnimationFrame(drawSpec); }
  requestAnimationFrame(drawSpec);

  // ---- per-channel live scope now lives in dashboard-scope.js (window.AbxScope) ----

  // ---- audio clock (SSE): phase-lock the loop bar + step playhead to Tidal's real cycle ----
  // The playhead used to free-run off performance.now() and drift away from the audio.
  // Now it derives phase from Tidal's actual `cycle` (pushed over /clock at 30Hz),
  // extrapolated with the real `cps` between pushes. `age` compensates push latency.
  // Falls back to free-run if SSE is unavailable; EventSource auto-reconnects to re-lock.
  var clk={cycle:0,cps:0,recvAt:0,have:false,lead:0};
  (function(){ try{ var es=new EventSource("/clock");
    es.onmessage=function(e){ try{ var c=JSON.parse(e.data); if(c&&c.cps>0){ clk.cycle=c.cycle; clk.cps=c.cps; clk.lead=c.lead||0; clk.recvAt=performance.now()-(c.age||0); clk.have=true; } }catch(_){ } };
  }catch(_){ } })();
  // audioPhase() now lives in dashboard-dsp.js (AbxDsp); the stateful clk + EventSource stay here.

  // ---- loop progression bar (sweeps once per cycle at tempo) + track timer ----
  var lphase=0,lpT=performance.now(),sessStart=0,recStart=0,wasRec=false,wasHas=false,lastClk="";
  function fmtT(ms){ var s=Math.floor(ms/1000),m=Math.floor(s/60); s=s%60; return (m<10?"0":"")+m+":"+(s<10?"0":"")+s; }
  function loopTick(){ var now=performance.now(),dt=(now-lpT)/1000; lpT=now;
    var has=Object.keys(cur.slots||{}).length>0, cps=(cur.tempoBpm||0)/240;
    var ap=Abx.clock.phase();   // audio-cycle phase (pure math in AbxDsp; stateful clk lives here)
    if(has&&ap!=null){ lphase=ap; }                                       // LOCKED to audio cycle
    else if(has&&cps>0){ lphase+=dt*cps; lphase-=Math.floor(lphase); }    // free-run fallback (no clock)
    else lphase=0;
    // guard window.AbxSeq / AbxCurves below: this core loop can start before the later feature
    // scripts finish parsing (inter-script fetch gap), and stays resilient if a module fails to load.
    if(window.AbxSeq) AbxSeq.songAdvance(ap!=null?ap:lphase);             // pattern-chain bar advance (song mode)
    var lf=document.getElementById("loopfill"); if(lf) lf.style.width=(lphase*100).toFixed(2)+"%";
    if(has&&!wasHas) sessStart=Date.now(); if(!has) sessStart=0; wasHas=has;
    if(cur.recording&&!wasRec) recStart=Date.now(); wasRec=!!cur.recording;
    var ms=cur.recording?(Date.now()-recStart):(sessStart?Date.now()-sessStart:0);
    var txt=(cur.recording?"● ":"")+fmtT(ms);
    if(txt!==lastClk){ var ck=document.getElementById("clock"); if(ck)ck.textContent=txt;
      var tp=document.getElementById("timerPill"); if(tp)tp.classList.toggle("rec",!!cur.recording); lastClk=txt; }
    if(window.AbxSeq) AbxSeq.renderPlayhead(lphase, has&&(ap!=null||cps>0)); // step-grid playhead (when grid open)
    requestAnimationFrame(loopTick); }
  requestAnimationFrame(loopTick);

  function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  // <colorfns> wavelength -> rgb; one colour per channel across the spectrum, band 470-645nm (NO purple)
  function wlRGB(wl){ var r=0,g=0,b=0,a;
    if(wl<440){ r=-(wl-440)/60; g=0; b=1; }
    else if(wl<490){ r=0; g=(wl-440)/50; b=1; }
    else if(wl<510){ r=0; g=1; b=-(wl-510)/20; }
    else if(wl<580){ r=(wl-510)/70; g=1; b=0; }
    else if(wl<645){ r=1; g=-(wl-645)/65; b=0; }
    else { r=1; g=0; b=0; }
    a = wl<420 ? 0.3+0.7*(wl-380)/40 : wl>700 ? 0.3+0.7*(780-wl)/80 : 1;
    return [Math.round(255*Math.pow(Math.max(0,r)*a,0.8)), Math.round(255*Math.pow(Math.max(0,g)*a,0.8)), Math.round(255*Math.pow(Math.max(0,b)*a,0.8))]; }
  function chanWL(dn){ var i=((parseInt((dn||"d1").slice(1),10)||1)-1)%16; var lo=470,hi=645; return hi-(i/15)*(hi-lo); }
  function chanRGB(dn){ return wlRGB(chanWL(dn)); }
  function chanColor(dn){ var c=chanRGB(dn); return "rgb("+c[0]+","+c[1]+","+c[2]+")"; }
  function chanColorA(dn,al){ var c=chanRGB(dn); return "rgba("+c[0]+","+c[1]+","+c[2]+","+al+")"; }
  // </colorfns>
  function send(o){ return fetch("/cmd",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(o)}).then(function(r){return r.json();}).catch(function(){return{};}); }
  function cmd(c,slot){ send({cmd:c,slot:slot}); setTimeout(poll,60); }
  // ---- Abx: the shared core surface the dashboard-*.js feature modules consume (instead of
  // reaching for bare globals). state() returns the live polled state; the clock wrapper is one
  // line over AbxDsp so the phase math stays pure + unit-tested. ----
  window.Abx={ state:function(){return cur;}, send:send, cmd:cmd, poll:poll,
    color:{chan:chanColor, chanA:chanColorA, wlRGB:wlRGB}, esc:esc, fnum:fnum,
    clock:{ phase:function(){ return AbxDsp.audioPhase(clk, performance.now()); } } };
  // mixer: "all off" mutes every layer individually (so each card stays toggleable),
  // "all on" unmutes everything. Per-layer M buttons / keys 1-9 flip one at a time.
  function allMuted(){ var ks=Object.keys(cur.slots||{}); return ks.length>0 && ks.every(function(k){return (cur.muted||[]).indexOf(k)>=0;}); }
  function toggleAll(){ var ks=Object.keys(cur.slots||{}); if(!ks.length)return;
    if(allMuted()){ send({cmd:"resume"}); } else { ks.forEach(function(k){ send({cmd:"mute",slot:k}); }); }
    setTimeout(poll,140); }
  function transport(){ if(Object.keys(cur.slots).length===0)return"stopped"; return allMuted()?"paused":"playing"; }

  function surprise(){
    var R=function(a){return a[Math.floor(Math.random()*a.length)];}, RI=function(a,b){return Math.floor(a+Math.random()*(b-a));};
    var bpm=R([90,120,128,140,150,75,160]);
    var code='do { setcps ('+bpm+'/60/4); '
      +'d1 $ s "'+R(['bd*4','bd ~ ~ bd ~ ~ bd ~','bd ~ bd ~','bd ~ ~ ~ bd ~ ~ ~'])+'" # gain 1.1 # shape '+(Math.random()*0.3).toFixed(2)+'; '
      +'d2 $ s "'+R(['~ cp','~ ~ sn ~','~ ~ ~ ~ sn ~ ~ ~','~ cp ~ [cp cp]'])+'" # gain 0.9 # room '+(0.1+Math.random()*0.3).toFixed(2)+'; '
      +'d3 $ s "'+R(['hh*8','hh*16','[hh*3]*4','hh*8 [hh*4]'])+'" # gain 0.45 # pan rand; '
      +'d4 $ note "'+R(['<c2 af1 g1 bf1>','c2 ~ ef2 ~','e1 ~ ~ e1 g1 ~ ~ ~','<a1 f1 c2 g1>'])+'" # s "'+R(['supersaw','superhoover'])+'" # cutoff '+RI(300,1100)+' # shape '+(Math.random()*0.4).toFixed(2)+' # legato 1 }';
    send({cmd:"eval",value:code}); setTimeout(poll,400);
  }

  // freeze the live layers into one LOOP_ channel (a stack) so the live slots free up
  function setLoop(){ var slots=cur.slots||{},out=document.getElementById("consoleOut");
    var live=Object.keys(slots).filter(function(k){ return !/^\s*stack\s*\[/.test(slots[k]); });
    if(!live.length){ out.textContent="nothing live to loop — play a beat first"; out.className="err"; return; }
    live.sort(function(a,b){return parseInt(a.slice(1))-parseInt(b.slice(1));});
    var used={}; Object.keys(slots).forEach(function(k){used[k]=1;});
    var target=""; for(var i=12;i>=1;i--){ if(!used["d"+i]){ target="d"+i; break; } }
    if(!target){ out.textContent="no free channel for a loop (12 max) — silence one first"; out.className="err"; return; }
    var n=parseInt(target.slice(1),10);
    var bodies=live.map(function(k){ return slots[k]; });
    var sil=live.map(function(k){ return k+" silence"; }).join("; ");
    send({cmd:"eval",value:"do { d"+n+" $ stack ["+bodies.join(", ")+"]; "+sil+" }"});
    out.textContent="committed "+live.length+" layer(s) -> LOOP on "+target+" — live channels free, build on top!"; out.className="ok";
    setTimeout(poll,220);
  }

  var lastDevSig="";
  function updateAudio(st){ var sel=document.getElementById("audioSelect"); if(!sel)return;
    var devs=st.devices||[],sig=devs.join("|");
    if(sig!==lastDevSig){ lastDevSig=sig;
      sel.innerHTML='<option value="">audio out…</option><option value="SYSTEM">System default</option>'
        +devs.filter(function(d){ return !/microphone|line in/i.test(d); }).map(function(d){ return '<option value="'+esc(d)+'">'+esc(d.replace(/^Windows WASAPI : /,""))+'</option>'; }).join(""); }
    if(document.activeElement!==sel){ var want=st.device||""; if(want==="System default")want="SYSTEM"; sel.value=want; }
  }
  function loadSetList(){ fetch("/sets").then(function(r){return r.json();}).then(function(sets){
    var sel=document.getElementById("setSelect"); var v=sel.value;
    sel.innerHTML='<option value="">— saved sets —</option>'+sets.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join("");
    sel.value=v;
  }).catch(function(){}); }
  // ---- cheat sheet + sample browser now live in dashboard-cheats.js (window.AbxCheats) ----

  // ---- step sequencer + patterns + song now live in dashboard-seq.js (window.AbxSeq) ----

  // ---- per-channel modulation curves now live in dashboard-curves.js (window.AbxCurves) ----

  document.addEventListener("input",function(e){ var el=e.target;
    if(el.id==="consoleIn"){ el.style.height="auto"; el.style.height=Math.min(150,el.scrollHeight)+"px"; return; }
    if(window.AbxCheats && AbxCheats.handleInput(e)) return;   // #sampleFilter
    if(el.type==="range") lastInput=Date.now();   // suppress card re-render while dragging any slider
    if(window.AbxSeq && AbxSeq.handleInput(e)) return;      // seqname / seqvol / seqSwing
    if(el.type!=="range")return;
    if(el.dataset.tempo!==undefined){ document.getElementById("bpm").textContent=el.value; pendingTempo=+el.value; return; }
    if(el.dataset.slot){ var vb=document.getElementById("v-"+el.dataset.slot+"-"+el.dataset.param); if(vb)vb.textContent=el.value;
      pending[el.dataset.slot+"|"+el.dataset.param]={slot:el.dataset.slot,param:el.dataset.param,value:+el.value}; }
  });
  var lastInput=0,pending={},pendingTempo=null;
  setInterval(function(){ for(var key in pending){ var x=pending[key]; delete pending[key]; send({cmd:"set",slot:x.slot,param:x.param,value:x.value}); }
    if(pendingTempo!=null){ send({cmd:"tempo",value:pendingTempo}); pendingTempo=null; }
    if(window.AbxSeq) AbxSeq.flushPending(); },80);

  document.addEventListener("click",function(e){
    if(window.AbxCheats && AbxCheats.handleClick(e)) return;   // chip / cheat line / cheats + samples buttons
    var b=e.target.closest("button");
    // step pads are handled by the pointer/wheel/contextmenu paint listeners below
    if(!b)return;
    if(window.AbxSeq && AbxSeq.handleClick(b)) return;       // steps / seqadd / seqclear / row mute+clear / pattern / song
    if(window.AbxCurves && AbxCurves.handleClick(b)) return;    // curves panel / curve toggle+preset
    if(b.dataset.act==="run"){ runCode(); return; }
    if(b.dataset.act==="boot"){ var o=document.getElementById("consoleOut"); o.textContent="booting the sound engine… (~30-40s) — watch the status light top-left"; o.className=""; send({cmd:"boot"}).then(function(){poll();}); return; }
    if(b.dataset.act==="reset"){ if(confirm("Reboot the engine? Wipes everything, fresh start (~30s).")) cmd("reset"); return; }
    if(b.dataset.act==="record"){ cmd("record"); return; }
    if(b.dataset.act==="surprise"){ surprise(); return; }
    if(b.dataset.act==="setloop"){ setLoop(); return; }
    if(b.dataset.act==="save"){ var n=document.getElementById("setName").value.trim(); if(n){ send({cmd:"save",value:n}).then(loadSetList); document.getElementById("setName").value=""; } return; }
    if(b.dataset.act==="load"){ var s=document.getElementById("setSelect").value; if(s){ send({cmd:"load",value:s}).then(function(){setTimeout(poll,300);}); } return; }
    if(b.dataset.act==="info"){ var ik=b.dataset.slot; collapsed[ik]=!collapsed[ik]; applyExpl(); return; }
    if(b.dataset.act==="infoall"){ var ks=Object.keys(cur.slots); var anyOpen=ks.some(function(x){return !collapsed[x];}); ks.forEach(function(x){collapsed[x]=anyOpen;}); applyExpl(); return; }
    if(b.dataset.act==="help"){ var l=document.getElementById("legend"); l.style.display=(l.style.display==="block")?"none":"block"; return; }
    if(b.dataset.act==="stop"){ cmd("stop"); return; }
    if(b.dataset.act==="toggle"){ toggleAll(); return; }
    if(b.dataset.cmd){ cmd(b.dataset.cmd,b.dataset.slot); return; }
  });

  // audio output device switch (restarts the engine; beat resumes)
  document.addEventListener("change",function(e){
    if(window.AbxCurves && AbxCurves.handleChange(e)) return;
    if(e.target.id!=="audioSelect")return;
    var d=e.target.value; if(!d){ return; }
    var label=d==="SYSTEM"?"System default":d.replace(/^Windows WASAPI : /,"");
    if(confirm("Switch audio output to:\n  "+label+"\n\nThis restarts the engine (~30s). Your current beat will resume automatically.")){
      var o=document.getElementById("consoleOut"); o.textContent="switching audio → "+label+" … engine rebooting (~30s), your beat will resume"; o.className="";
      send({cmd:"setdevice",value:d}).then(function(){ setTimeout(poll,600); });
    } else { poll(); }
  });

  // ---- modulation-curve paint listeners now live in dashboard-curves.js ----

  // ---- step-grid paint + drag-drop listeners now live in dashboard-seq.js ----

  // keyboard shortcuts (ignored while typing in a field)
  document.addEventListener("keydown",function(e){ var t=(e.target.tagName||"").toLowerCase();
    if(t==="input"||t==="textarea"){
      if(e.target.id==="consoleIn"){
        if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); runCode(); }
        else if(e.key==="ArrowUp"&&e.target.selectionStart===0&&hist.length){ if(histIdx>0)histIdx--; e.target.value=hist[histIdx]||""; e.preventDefault(); }
        else if(e.key==="ArrowDown"&&e.target.selectionStart===e.target.value.length&&hist.length){ if(histIdx<hist.length-1){histIdx++;e.target.value=hist[histIdx];}else{histIdx=hist.length;e.target.value="";} e.preventDefault(); }
      }
      return;
    }
    if(e.key===" "){ e.preventDefault(); toggleAll(); return; }
    if(e.key>="1"&&e.key<="9"){ var k="d"+e.key; if(cur.slots[k]){ var m=(cur.muted||[]).indexOf(k)>=0; cmd(m?"unmute":"mute",k); } return; }
    if(e.key==="?"){ var l=document.getElementById("legend"); l.style.display=(l.style.display==="block")?"none":"block"; return; }
    if(e.key==="c"||e.key==="C"){ if(window.AbxCheats) AbxCheats.openCheats(); return; }
  });

  // ---- console ----
  var hist=[],histIdx=0;
  // Make typed code runnable: a bare pattern (s "…", note "…", jux/every … $ s "…")
  // gets a free "dN $" prefix so it actually connects & loops; multiple dN lines
  // fold into a do-block (several separate statements aren't valid in one :{ :}).
  function toRunnable(code){ var t=code.replace(/\r\n/g,"\n").trim(); if(!t)return t;
    var cmdre=/^(d\d{1,2}\b|do\b|hush\b|setcps\b|once\b|mute\b|unmute\b|solo\b|unsolo\b|unmuteAll\b|unsoloAll\b|panic\b|mapM_\b|all\b|let\b|import\b|\(|:)/;
    var patre=/(^|[^a-zA-Z])(s|sound|n|note)\s*"/;
    var lines=t.split("\n").map(function(s){return s.trim();}).filter(Boolean);
    var used={},k; for(k in (cur.slots||{}))used[k]=1;
    lines.forEach(function(l){ var m=l.match(/^d(\d{1,2})\b/); if(m)used["d"+m[1]]=1; });
    function freeSlot(){ for(var i=1;i<=16;i++){ if(!used["d"+i]){ used["d"+i]=1; return "d"+i; } } return "d1"; }
    var out=lines.map(function(l){ if(cmdre.test(l))return l; if(patre.test(l))return freeSlot()+" $ "+l; return l; });
    var allStmts=out.every(function(l){return /^(d\d{1,2}\b|setcps\b|once\b|hush\b)/.test(l);});
    return (out.length>1&&allStmts)?("do { "+out.join("; ")+" }"):out.join("\n");
  }
  function runCode(){ var ta=document.getElementById("consoleIn"),code=ta.value.trim(); if(!code)return;
    if(hist[hist.length-1]!==code) hist.push(code); histIdx=hist.length;
    var runnable=toRunnable(code);
    var out=document.getElementById("consoleOut"); out.textContent="running…"; out.className="";
    send({cmd:"eval",value:runnable}).then(function(j){ var m=j.msg||"ok";
      if(runnable!==code && !/error/i.test(m)) m="▶ "+runnable;
      out.textContent=m; out.className=/error/i.test(m)?"err":"ok"; poll(); });
    ta.value=""; ta.style.height="34px";
  }

  var lastSig="";
  function render(st){ cur=st;
    document.getElementById("engdot").className="dot "+(st.status||"");
    document.getElementById("engstate").textContent=st.status||"idle";
    var dragging=Date.now()-lastInput<700;
    if(!dragging){ document.getElementById("bpm").textContent=st.tempoBpm?Math.round(st.tempoBpm):"--"; if(st.tempoBpm)document.getElementById("tempoSlider").value=Math.round(st.tempoBpm); }
    var tr=transport(); document.getElementById("trdot").className="dot "+tr; document.getElementById("trstate").textContent=tr.toUpperCase();
    var bb=document.getElementById("btnBoot"); bb.style.display=(st.status==="ready")?"none":"";
    var bp=document.getElementById("btnPlay"); bp.innerHTML=allMuted()?"&#128266; All on":"&#128263; All off"; bp.style.display=(tr==="stopped")?"none":"";
    var rb=document.getElementById("recBtn"); rb.classList.toggle("on",!!st.recording); rb.innerHTML=st.recording?"&#9632; Rec":"&#9679; Rec";
    updateAudio(st);
    if(Date.now()-(st.meterAge||0)<450){ tgtL=Math.max(tgtL,st.meterL||0); tgtR=Math.max(tgtR,st.meterR||0); }
    var sig=JSON.stringify({s:st.slots,m:st.muted,so:st.solo,p:st.paused});
    if(sig===lastSig||dragging) return; lastSig=sig;
    var muted=st.muted||[],solo=st.solo,keys=Object.keys(st.slots||{}).sort(function(a,b){return parseInt(a.slice(1))-parseInt(b.slice(1));});
    var grid=document.getElementById("grid");
    if(keys.length===0){ grid.innerHTML='<div class="empty">no patterns playing &mdash; <b>type a beat below</b> or hit Surprise me</div>'; return; }
    var loopNames={}; keys.filter(function(k){return /^\s*stack\s*\[/.test(st.slots[k]);}).sort(function(a,b){return parseInt(b.slice(1))-parseInt(a.slice(1));}).forEach(function(k,ix){ loopNames[k]="LOOP_"+(ix+1); });
    var h="";
    for(var i=0;i<keys.length;i++){ var k=keys[i],isM=muted.indexOf(k)>=0,isS=(solo===k),dim=(solo&&!isS)||isM,c=st.slots[k],isLoop=!!loopNames[k],knobs="";
      if(!isLoop) for(var j=0;j<KNOBS.length;j++){ var kn=KNOBS[j],val=fnum(c,kn.p); if(val==null)val=kn.def;
        knobs+='<div class="knob"><span>'+kn.l+'</span><input type="range" min="'+kn.min+'" max="'+kn.max+'" step="'+kn.step+'" value="'+val+'" data-slot="'+k+'" data-param="'+kn.p+'"><b id="v-'+k+'-'+kn.p+'">'+val+'</b></div>'; }
      h+='<div class="card'+(isM?" muted":"")+(isS?" solo":"")+(isLoop?" loop":"")+'">'
       + '<div class="crow"><span class="live'+(dim?" off":"")+'" id="dot-'+k+'"></span><span class="slot">'+(isLoop?"&#128274; "+loopNames[k]:k)+'</span>'
       + (isM?'<span class="tag">muted</span>':'')+(isS?'<span class="tag" style="color:var(--green);border-color:var(--green)">solo</span>':'')
       + '<span class="cbtns"><button class="'+(isM?"on":"")+'" data-cmd="'+(isM?"unmute":"mute")+'" data-slot="'+k+'">M</button>'
       + '<button class="'+(isS?"on":"")+'" data-cmd="'+(isS?"unsolo":"solo")+'" data-slot="'+k+'">S</button>'
       + '<button class="info" data-act="info" data-slot="'+k+'" title="hide/show explanation">&#9432;</button>'
       + '<button data-cmd="silence" data-slot="'+k+'" title="remove">&times;</button></span></div>'
       + '<code>'+esc(c)+'</code>'+(cur.scope?'<canvas class="scope" data-slot="'+k+'" data-orbit="'+(parseInt(k.slice(1),10)-1)+'" height="56"></canvas>':'')+'<div class="knobs">'+knobs+'</div>'
       + '<div class="expl'+(collapsed[k]?" hidden":"")+'" id="expl-'+k+'">'+(isLoop?'<b>&#128274; '+loopNames[k]+'</b> &mdash; committed loop (frozen layers). Build new channels, then Set Loop again to stack them.':explain(c))+'</div></div>';
    }
    grid.innerHTML=h;
    if(window.AbxCurves) AbxCurves.maybeRerender(keys);
  }
  function poll(){ fetch("/state").then(function(r){return r.json();}).then(render).catch(function(){
    document.getElementById("engstate").textContent="disconnected"; document.getElementById("engdot").className="dot error"; }); }
  setInterval(poll,90); poll(); loadSetList();

  // deep-link: open a panel straight from the URL hash (e.g. .../#steps, #cheats, #curves).
  // Deferred to DOMContentLoaded: the dashboard scripts load in sequence and the openX() calls
  // here now reach across files (AbxCheats etc.), which only exist after their file has parsed.
  window.addEventListener("DOMContentLoaded",function(){ var h=(location.hash||"").slice(1).toLowerCase();
    if(h==="cheats"){ if(window.AbxCheats) AbxCheats.openCheats(); }
    else if(h==="samples"){ if(window.AbxCheats) AbxCheats.openSamples(); }
    else if(h==="curves"){ if(window.AbxCurves) AbxCurves.openCurves(); }
    else if(h==="steps"){ if(window.AbxSeq){ AbxSeq.seedDemo(); AbxSeq.openSteps(); } }
  });
