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

  // ---- per-channel live scope (synth board): a triggered, pitch-adaptive oscilloscope ----
  // SC streams a wide raw window per orbit (cur.scopes[dN].wave). The DSP is here:
  //  * trigger  — align to a rising zero-crossing so the trace stops jittering (phase-lock)
  //  * zoom     — measure the period from evenly-spaced crossings, show ~2 cycles
  //  * classify — irregular/too-fast crossings => transient/noise => show the raw window
  //  * auto-gain— amplify quiet (keep dynamics), auto-range loud (always readable)
  //  * ease     — morph the displayed trace smoothly between the 20Hz data updates
  // Falls back to the Strategy A scrolling envelope if no waveform data is present.
  var scopeHist={}, scopeDisp={}, SCOPE_HN=64, SDISP=128, scopeLastPush=performance.now(), SCOPE_PUSH_MS=45;
  function scopeLevel(k){ var sc=(cur.scopes||{})[k]; return sc?Math.min(1,sc.peak||0):0; }
  function scopeWaveOf(k){ var sc=(cur.scopes||{})[k]; return (sc&&sc.wave&&sc.wave.length)?sc.wave:null; }
  function envY(v,H){ return H-1.5-Math.min(1,Math.sqrt(v)*1.55)*(H-3); }
  // returns {seg:[..],mx} — a phase-locked ~2-cycle slice when tonal, else the raw window; null when silent
  function stabilize(wave){ var n=wave.length,i,mean=0; for(i=0;i<n;i++)mean+=wave[i]; mean/=n;
    var w=new Array(n),mx=0; for(i=0;i<n;i++){ w[i]=wave[i]-mean; var a=w[i]<0?-w[i]:w[i]; if(a>mx)mx=a; }
    if(mx<0.0009) return null;
    var cross=[]; for(i=1;i<n;i++){ if(w[i-1]<=0 && w[i]>0) cross.push(i); }
    if(cross.length>=3){ var iv=[]; for(i=1;i<cross.length;i++) iv.push(cross[i]-cross[i-1]);
      var P=iv.slice().sort(function(a,b){return a-b;})[Math.floor(iv.length/2)];
      var ok=0; for(i=0;i<iv.length;i++){ if(iv[i]>=0.6*P && iv[i]<=1.5*P) ok++; } ok/=iv.length;
      if(P>=4 && P<=n/2 && ok>=0.7){ var start=cross[0], span=Math.min(2*P, n-start);
        if(span>=P) return { seg:w.slice(start,start+span), mx:mx }; } }
    return { seg:w, mx:mx };
  }
  function resample(seg,D){ var L=seg.length,out=new Array(D),j; if(L<2){ for(j=0;j<D;j++)out[j]=seg[0]||0; return out; }
    for(j=0;j<D;j++){ var t=j/(D-1)*(L-1),i0=t|0,f=t-i0,b=seg[i0+1<L?i0+1:L-1]; out[j]=seg[i0]*(1-f)+b*f; } return out; }
  function drawScope(cv,k){ var W=cv.clientWidth||320; if(cv.width!==W)cv.width=W; var H=cv.height,ctx=cv.getContext("2d"),col=chanColor(k),mid=H/2,amp=H*0.44;
    ctx.clearRect(0,0,W,H);
    var wave=scopeWaveOf(k);
    if(!wave){ var h=scopeHist[k]; if(!h)return; var n2=h.length,step2=W/(n2-1); // Strategy A envelope fallback
      ctx.beginPath(); ctx.moveTo(0,H); for(var a=0;a<n2;a++) ctx.lineTo(a*step2,envY(h[a],H)); ctx.lineTo(W,H); ctx.closePath(); ctx.fillStyle=chanColorA(k,0.16); ctx.fill();
      ctx.beginPath(); for(var b=0;b<n2;b++){ var x2=b*step2,y2=envY(h[b],H); if(b===0)ctx.moveTo(x2,y2); else ctx.lineTo(x2,y2); } ctx.strokeStyle=col; ctx.lineWidth=1.6; ctx.shadowColor=col; ctx.shadowBlur=4; ctx.stroke(); ctx.shadowBlur=0;
      return; }
    var disp=scopeDisp[k]||(scopeDisp[k]=new Array(SDISP).fill(0)), st=stabilize(wave), target=null;
    if(st){ var gain=Math.min(6,0.92/Math.max(st.mx,1e-4)), rs=resample(st.seg,SDISP); target=new Array(SDISP);
      for(var t=0;t<SDISP;t++){ var v=rs[t]*gain; target[t]=v>1.25?1.25:(v<-1.25?-1.25:v); } }
    for(var i=0;i<SDISP;i++){ disp[i]+=((target?target[i]:0)-disp[i])*0.3; }
    ctx.strokeStyle="rgba(22,64,31,.45)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,mid); ctx.lineTo(W,mid); ctx.stroke();
    var step=W/(SDISP-1);
    ctx.beginPath(); for(var j=0;j<SDISP;j++){ var x=j*step,y=mid-disp[j]*amp; if(j===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }
    ctx.strokeStyle=col; ctx.lineWidth=1.7; ctx.shadowColor=col; ctx.shadowBlur=6; ctx.stroke(); ctx.shadowBlur=0;
  }
  function scopeTick(){ var now=performance.now(),push=(now-scopeLastPush)>=SCOPE_PUSH_MS; if(push)scopeLastPush=now;
    var live={}; for(var sk in (cur.slots||{}))live[sk]=1;
    for(var hk in scopeHist){ if(!live[hk]) delete scopeHist[hk]; }
    for(var dk in scopeDisp){ if(!live[dk]) delete scopeDisp[dk]; }
    var cvs=document.querySelectorAll(".scope");
    for(var i=0;i<cvs.length;i++){ var cv=cvs[i],k=cv.dataset.slot,h=scopeHist[k]||(scopeHist[k]=new Array(SCOPE_HN).fill(0));
      if(push){ h.push(scopeLevel(k)); if(h.length>SCOPE_HN)h.shift(); }
      drawScope(cv,k); }
    requestAnimationFrame(scopeTick); }
  requestAnimationFrame(scopeTick);

  // ---- audio clock (SSE): phase-lock the loop bar + step playhead to Tidal's real cycle ----
  // The playhead used to free-run off performance.now() and drift away from the audio.
  // Now it derives phase from Tidal's actual `cycle` (pushed over /clock at 30Hz),
  // extrapolated with the real `cps` between pushes. `age` compensates push latency.
  // Falls back to free-run if SSE is unavailable; EventSource auto-reconnects to re-lock.
  var clk={cycle:0,cps:0,recvAt:0,have:false,lead:0};
  (function(){ try{ var es=new EventSource("/clock");
    es.onmessage=function(e){ try{ var c=JSON.parse(e.data); if(c&&c.cps>0){ clk.cycle=c.cycle; clk.cps=c.cps; clk.lead=c.lead||0; clk.recvAt=performance.now()-(c.age||0); clk.have=true; } }catch(_){ } };
  }catch(_){ } })();
  // subtract `lead` (Tidal scheduling latency, ~0.25s) so the displayed phase tracks the
  // actual SOUND, not the event tap that fires earlier — this is what lands the playhead on the beat.
  function audioPhase(){ if(!clk.have||!(clk.cps>0)) return null; var cyc=clk.cycle+(((performance.now()-clk.recvAt)/1000)-(clk.lead||0))*clk.cps; return cyc-Math.floor(cyc); }

  // ---- loop progression bar (sweeps once per cycle at tempo) + track timer ----
  var lphase=0,lpT=performance.now(),sessStart=0,recStart=0,wasRec=false,wasHas=false,lastClk="",seqCurStep=-1;
  function fmtT(ms){ var s=Math.floor(ms/1000),m=Math.floor(s/60); s=s%60; return (m<10?"0":"")+m+":"+(s<10?"0":"")+s; }
  function loopTick(){ var now=performance.now(),dt=(now-lpT)/1000; lpT=now;
    var has=Object.keys(cur.slots||{}).length>0, cps=(cur.tempoBpm||0)/240;
    var ap=audioPhase();
    if(has&&ap!=null){ lphase=ap; }                                       // LOCKED to audio cycle
    else if(has&&cps>0){ lphase+=dt*cps; lphase-=Math.floor(lphase); }    // free-run fallback (no clock)
    else lphase=0;
    // song mode: advance to the next pattern in the chain when the cycle wraps (new bar)
    if(songMode && songChain.length){ var sp=(ap!=null?ap:lphase);
      if(sp < songLastPh-0.5){ songPos=(songPos+1)%songChain.length; if(songChain[songPos]!==curPat) selectPat(songChain[songPos],true);
        var pn=document.getElementById("patnow"); if(pn) pn.textContent="▶ "+songChain.map(function(x,i){return i===songPos?"["+x+"]":x;}).join(" "); }
      songLastPh=sp; }
    var lf=document.getElementById("loopfill"); if(lf) lf.style.width=(lphase*100).toFixed(2)+"%";
    if(has&&!wasHas) sessStart=Date.now(); if(!has) sessStart=0; wasHas=has;
    if(cur.recording&&!wasRec) recStart=Date.now(); wasRec=!!cur.recording;
    var ms=cur.recording?(Date.now()-recStart):(sessStart?Date.now()-sessStart:0);
    var txt=(cur.recording?"● ":"")+fmtT(ms);
    if(txt!==lastClk){ var ck=document.getElementById("clock"); if(ck)ck.textContent=txt;
      var tp=document.getElementById("timerPill"); if(tp)tp.classList.toggle("rec",!!cur.recording); lastClk=txt; }
    var sw=document.getElementById("seqwrap");
    if(sw&&sw.style.display==="block"){ var pstep=-1;
      if(has&&(ap!=null||cps>0)){ var stepF=lphase*SEQSTEPS,si=Math.floor(stepF)%SEQSTEPS,sfrac=stepF-Math.floor(stepF);
        if(seqSwing>0 && (si%2===1) && sfrac < (seqSwing/100)*(SEQSTEPS/8)) si=(si+SEQSTEPS-1)%SEQSTEPS;   // odd pads land late by swingBy amt (measured: 0.3 -> 0.6 step)
        pstep=si; }
      if(pstep!==seqCurStep){ var old=document.querySelectorAll(".pad.now"); for(var oi=0;oi<old.length;oi++)old[oi].classList.remove("now");
        if(pstep>=0){ var nw=document.querySelectorAll('.pad[data-step="'+pstep+'"]'); for(var ni=0;ni<nw.length;ni++)nw[ni].classList.add("now"); } seqCurStep=pstep; } }
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
  function openSamples(){ var w=document.getElementById("samplewrap");
    if(w.style.display==="block"){ w.style.display="none"; return; }
    document.getElementById("cheatwrap").style.display="none";
    w.style.display="block";
    fetch("/samples").then(function(r){return r.json();}).then(function(list){
      document.getElementById("sampleList").innerHTML=list.map(function(s){return '<span class="chip" draggable="true" data-sample="'+esc(s)+'" title="click = drop to console · drag onto a step-grid row to set its sound">'+esc(s)+'</span>';}).join("");
    }).catch(function(){});
  }

  // ---- cheat sheet: click a line to drop it in the console ----
  var CHEATS=[
   {cat:"🥁 Drums — drop a whole layer",items:[
     {c:'d1 $ s "bd*4"',d:"four-on-the-floor kick"},
     {c:'d1 $ s "bd ~ ~ bd ~ ~ bd ~"',d:"broken / syncopated kick"},
     {c:'d1 $ s "bd sn bd sn"',d:"basic rock beat"},
     {c:'d1 $ s "bd ~ sn ~ ~ bd sn ~"',d:"breakbeat feel"},
     {c:'d2 $ s "~ cp"',d:"clap on the offbeat"},
     {c:'d2 $ s "~ sn ~ sn"',d:"backbeat snare"},
     {c:'d3 $ s "hh*8" # gain 0.5',d:"straight hi-hats"},
     {c:'d3 $ s "hh*16" # gain 0.4',d:"fast trap hats"},
     {c:'d3 $ s "[hh*3]*4" # gain 0.5',d:"triplet hats"}
   ]},
   {cat:"🔊 Bass — heavy / wobble / neuro",items:[
     {c:'d4 $ note "c2 ~ c2 ~" # s "supersaw" # cutoff 500',d:"simple sub bass"},
     {c:'d4 $ note "c2*4" # s "supersaw" # cutoff (range 200 3000 sine) # shape 0.4',d:"WOBBLE bass (filter sweeps)"},
     {c:'d4 $ note "<c2 af1 g1 bf1>" # s "superhoover" # cutoff 700 # legato 1',d:"rave hoover bass (moves each bar)"},
     {c:'d4 $ note "c2 c2 ef2 g2" # s "supersquare" # cutoff 600 # shape 0.3',d:"acid-style line"}
   ]},
   {cat:"🎵 Melody & chords",items:[
     {c:'d5 $ n "0 3 5 7" # s "arpy"',d:"plucky arpeggio"},
     {c:'d5 $ note "c4 e4 g4 b4" # s "superpiano"',d:"piano arpeggio"},
     {c:'d5 $ note "c\'maj ~ a\'min ~" # s "superpiano"',d:"chords (maj / min)"},
     {c:'d6 $ s "wind" # room 0.7 # gain 0.7',d:"atmospheric pad / texture"}
   ]},
   {cat:"✨ Effects — tack onto your current line",items:[
     {c:'# gain 1.1',d:"louder (keep around 1.2 max)"},
     {c:'# cutoff 600',d:"low-pass filter — darker"},
     {c:'# room 0.4',d:"reverb / space"},
     {c:'# shape 0.4',d:"distortion / grit"},
     {c:'# pan rand',d:"random stereo placement"},
     {c:'# speed 0.5',d:"pitch down (deeper)"},
     {c:'# delay 0.4 # delaytime 0.25',d:"echo"},
     {c:'# crush 4',d:"bit-crush (lo-fi)"},
     {c:'# vowel "a"',d:"vocal formant (a/e/i/o/u)"}
   ]},
   {cat:"🌀 Pattern tricks — wrap a pattern, e.g.  d1 $ TRICK $ s \"bd*4\"",items:[
     {c:'fast 2 $',d:"twice as fast"},
     {c:'slow 2 $',d:"half speed / stretched"},
     {c:'rev $',d:"play it backwards"},
     {c:'jux rev $',d:"normal one ear, reversed the other"},
     {c:'every 4 (# crush 4) $',d:"crush every 4th bar"},
     {c:'sometimesBy 0.3 (# speed 2) $',d:"randomly pitch up 30% of hits"},
     {c:'chunk 4 (hurry 2) $',d:"roll through the bar in 4 chunks"},
     {c:'degradeBy 0.2 $',d:"drop 20% of hits (looser, human)"}
   ]},
   {cat:"🎚 Full beats — click, then press Enter",items:[
     {c:'do { setcps (140/60/4); d1 $ s "bd*4" # gain 1.1; d2 $ s "~ cp" # room 0.2; d3 $ s "hh*16" # gain 0.4 # pan rand; d4 $ note "<c2 af1 g1 bf1>" # s "supersaw" # cutoff 600 # shape 0.3 # legato 1 }',d:"PSY-TRANCE"},
     {c:'do { setcps (140/60/4); d1 $ s "bd ~ ~ bd ~ ~ bd ~" # gain 1.1; d2 $ s "~ ~ cp ~" # room 0.3; d3 $ s "hh*16" # gain 0.45 # pan rand; d4 $ note "c1*2" # s "supersaw" # cutoff 400 }',d:"TRAP"},
     {c:'do { setcps (75/60/4); d1 $ s "bd ~ ~ ~ ~ ~ sn ~" # gain 1.15 # shape 0.3; d3 $ s "hh*8?" # gain 0.4; d4 $ note "c1 ~ ~ ef1 ~ ~ ~ ~" # s "supersaw" # cutoff (range 200 1500 sine) # shape 0.5 # legato 2 }',d:"SLUDGE / wonky downtempo"},
     {c:'do { setcps (110/60/4); d1 $ s "bd ~ ~ bd ~ ~ ~ ~"; d2 $ s "~ ~ ~ ~ sn ~ ~ ~" # room 0.4; d5 $ note "c4 e4 g4 b4 a4 g4 e4 c4" # s "superpiano" # room 0.5 # gain 0.8; d6 $ s "wind" # room 0.8 # gain 0.6 }',d:"PSYBIENT / chill"}
   ]},
   {cat:"🔁 Longer loops & variation",items:[
     {c:'d5 $ note "<c2 ef2 g2 bf2>" # s "supersaw" # cutoff 700',d:"4-bar bassline (one note per bar)"},
     {c:'d1 $ s "<bd*4 [bd ~ bd bd] bd*2 [bd*4]>"',d:"kick changes every bar, loops every 4"},
     {c:'d1 $ slowcat [s "bd*4", s "bd ~ bd ~", s "bd*2", s "bd ~ ~ bd"]',d:"stitch 4 different bars into one loop"},
     {c:'d3 $ slow 4 $ s "hh*8 hh*16 [hh*4] hh*8"',d:"stretch a phrase over 4 bars"},
     {c:'d1 $ every 4 (fast 2) $ s "bd sn hh cp"',d:"normal 3 bars, double-time on the 4th"},
     {c:'d5 $ slow 2 $ note "<c2 ef2 g2 bf2 c3 bf2 g2 ef2>" # s "superpiano" # room 0.3',d:"evolving 8-bar melody"}
   ]},
   {cat:"📈 Build-ups & risers",items:[
     {c:'d2 $ s "sn*<2 4 8 16>" # gain 0.9',d:"accelerating snare roll (4-bar build)"},
     {c:'d2 $ s "sn*16" # gain (slow 4 $ range 0.5 1.1 saw)',d:"snare roll swelling louder"},
     {c:'d6 $ note "c4" # s "supersaw" # cutoff (slow 8 $ range 300 8000 saw) # gain 0.6 # legato 1',d:"filter riser opening over 8 bars"},
     {c:'d6 $ s "wind" # speed (slow 8 $ range 1 3 saw) # gain 0.6 # room 0.5',d:"rising whoosh / noise riser"},
     {c:'d7 $ note "c5" # s "supersaw" # gain (slow 8 $ range 0.2 0.8 saw) # room 0.6 # legato 1',d:"pad swelling in"}
   ]},
   {cat:"💥 Drops & impacts",items:[
     {c:'d1 $ mask "<1 1 1 0>" $ s "bd*4"',d:"cut the bar before the drop (silence = tension)"},
     {c:'d9 $ s "<cr ~ ~ ~>" # gain 1 # room 0.5',d:"crash cymbal on the downbeat"},
     {c:'once $ s "bd" # speed 0.4 # gain 1.2 # shape 0.3',d:"sub-drop boom (fire once AT the drop)"},
     {c:'d1 $ s "bd*4" # gain 1.2 # shape 0.4',d:"slam the kick back in = the drop"},
     {c:'d4 $ note "c1*8" # s "supersaw" # cutoff 500 # shape 0.5 # gain 1.1',d:"heavy bass for the drop"}
   ]},
   {cat:"🥁 Fills & transitions",items:[
     {c:'d1 $ every 4 (const $ s "sn*8 cp") $ s "bd*4"',d:"drum fill on every 4th bar"},
     {c:'d3 $ every 8 (stut 4 0.5 0.05) $ s "hh*8" # gain 0.5',d:"stutter/echo hat fill every 8 bars"},
     {c:'d2 $ every 4 (# crush 4) $ s "~ cp"',d:"crushed clap fill every 4 bars"},
     {c:'d3 $ striate 8 $ s "breaks125" # gain 0.8',d:"chopped breakbeat fill"},
     {c:'d8 $ every 2 rev $ s "perc*4" # gain 0.6',d:"reversing perc transition"}
   ]},
   {cat:"🎛 Song sections — A / B parts",items:[
     {c:'d1 $ whenmod 16 8 (# crush 6) $ s "bd*4"',d:"bars 8-15 get a different (crushed) flavour"},
     {c:'d4 $ whenmod 16 8 (# cutoff 400) $ note "c2*4" # s "supersaw"',d:"darker bass in the B-section"},
     {c:'d5 $ whenmod 16 8 (const $ note "c4 e4 g4 b4" # s "superpiano") $ silence',d:"lead ONLY plays in bars 8-15"},
     {c:'d3 $ whenmod 32 24 (fast 2) $ s "hh*8" # gain 0.5',d:"hats double-time for the last 8 of 32"}
   ]},
   {cat:"🎚 Layering, mix & movement",items:[
     {c:'d4 $ superimpose ((# speed 2) . (# gain 0.5)) $ note "c2*4" # s "supersaw"',d:"add an octave-up layer on top"},
     {c:'d5 $ off 0.125 (# gain 0.6 # speed 2) $ note "c4 e4 g4" # s "superpiano"',d:"echo / ghost layer (delay feel)"},
     {c:'d5 $ jux rev $ note "c4 e4 g4 b4" # s "arpy"',d:"wide stereo (reversed in one ear)"},
     {c:'d3 $ s "hh*8" # pan (slow 4 $ range 0 1 sine) # gain 0.5',d:"hats sweeping across the stereo field"},
     {c:'d3 $ swingBy (1/3) 4 $ s "hh*8" # gain 0.5',d:"swing the hats (off-grid groove)"}
   ]}
  ];
  function dropToConsole(code){ var ta=document.getElementById("consoleIn"),cur=ta.value;
    if(code.charAt(0)==="#"){ ta.value=(cur.trim()?cur.replace(/\s+$/,"")+" ":"")+code; }
    else { ta.value=(cur.trim()?cur.replace(/\s+$/,"")+"\n":"")+code; }
    ta.style.height="auto"; ta.style.height=Math.min(150,ta.scrollHeight)+"px";
    ta.focus(); ta.selectionStart=ta.selectionEnd=ta.value.length;
    var out=document.getElementById("consoleOut"); out.textContent="dropped into console — edit if you like, then press Enter to play ▶"; out.className="";
  }
  // smallest dN not already playing or already drafted in the console
  function nextFreeSlot(){ var el=document.getElementById("consoleIn"),ta=el?el.value:"",used={};
    for(var k in (cur.slots||{})) used[k]=1;
    var re=/\bd(\d{1,2})\b/g,m; while((m=re.exec(ta))) used["d"+m[1]]=1;
    for(var i=1;i<=16;i++){ if(!used["d"+i]) return "d"+i; } return "d1"; }
  function openCheats(){ var w=document.getElementById("cheatwrap");
    if(w.style.display==="block"){ w.style.display="none"; return; }
    document.getElementById("samplewrap").style.display="none";
    w.style.display="block";
    if(w.dataset.built) return;
    var h='<div class="cheathint">Click any line to drop it into the console below — then edit it &amp; press <b>Enter</b> to play. <b>Effects</b> (# …) tack onto your current line; <b>tricks</b> wrap a pattern.'
      +'<br><br><b>🎬 Making a full song?</b> Layers by convention: <b>d1</b> kick · <b>d2</b> snare/clap · <b>d3</b> hats · <b>d4</b> bass · <b>d5</b> lead · <b>d6</b> riser · <b>d7</b> pad · <b>d8</b> perc · <b>d9</b> crash.'
      +'<br>1) Build your sections. 2) Hit <b>● Rec</b>. 3) Perform it: start sparse, bring layers in (each <b>M</b> / keys 1-9), run a <b>📈 build-up</b>, hit <b>🔇 All off</b> for a beat, then <b>💥 slam the drop</b> back in. 4) Hit <b>● Rec</b> again to save the .wav.</div>';
    for(var i=0;i<CHEATS.length;i++){ var g=CHEATS[i]; h+='<div class="cheatcat">'+g.cat+'</div><div class="cheatgrid">';
      for(var j=0;j<g.items.length;j++){ var it=g.items[j];
        h+='<div class="cheat" data-code="'+esc(it.c)+'"><span class="cc">'+esc(it.c)+'</span><span class="cd">'+esc(it.d)+'</span></div>'; }
      h+='</div>'; }
    w.innerHTML=h; w.dataset.built="1";
  }

  // ---- step sequencer ----
  var SEQSTEPS=16, seqSwing=0, SEQVEL=1.0;   // SEQVEL = default velocity a freshly-painted step gets
  // each row.steps[i] = velocity 0..1.5 (0 = off). name = sample, slot = dN, gain = row volume.
  var seq=[{name:"bd",gain:1},{name:"sn",gain:0.95},{name:"hh",gain:0.5},{name:"cp",gain:0.9}].map(function(r,i){ return {name:r.name,slot:"d"+(i+1),gain:r.gain,mute:false,steps:Array(SEQSTEPS).fill(0)}; });
  var SEQLABEL={bd:"kick",sn:"snare",sd:"snare",hh:"hat",hc:"closed hat",ho:"open hat",cp:"clap",cr:"crash",rim:"rim",perc:"perc",click:"click",arpy:"pluck",jvbass:"bass",bass:"bass","808":"808",wind:"atmos",yeah:"vox",voodoo:"vox",east:"tabla"};
  function seqLabel(n){ return SEQLABEL[n]||n; }
  function padBg(slot,v){ return chanColorA(slot, 0.32+0.5*Math.min(1,v/1.5)); }   // velocity -> fill brightness
  function seqRowCode(r){ if(r.mute||!r.steps.some(function(v){return v>0;}))return null;
    var toks=r.steps.map(function(v){return v>0?r.name:"~";}).join(" ");
    var gains=r.steps.map(function(v){return v>0?(r.gain*v).toFixed(2):"0";}).join(" ");   // per-step velocity * row volume
    var body='s "'+toks+'" # gain "'+gains+'"';
    if(seqSwing>0) body='swingBy '+(seqSwing/100).toFixed(2)+' 8 $ '+body;
    return r.slot+' $ '+body; }
  function seqApply(r){ var code=seqRowCode(r); if(code) send({cmd:"eval",value:code}); else send({cmd:"silence",slot:r.slot}); }
  function seqApplyAll(){ seq.forEach(seqApply); setTimeout(poll,160); }
  function seqRender(){
    var h='<div class="seqruler"><span class="rlead"></span><span class="rpads">';
    for(var s=0;s<SEQSTEPS;s++){ h+='<span class="rstep'+(s%4===0?" beat":"")+'">'+(s%4===0?(s/4+1):"")+'</span>'; }
    h+='</span><span class="rtrail"></span></div>';
    for(var i=0;i<seq.length;i++){ var r=seq[i],col=chanColor(r.slot);
      h+='<div class="seqrow" data-row="'+i+'" style="--rc:'+col+'">'
       +'<span class="seqgrip" data-row="'+i+'" draggable="true" title="drag to reorder">☰</span>'
       +'<input class="seqname" data-row="'+i+'" value="'+esc(r.name)+'" spellcheck="false" title="sample name — type, or drag one from Samples">'
       +'<span class="seqtag">'+esc(seqLabel(r.name))+'</span>'
       +'<span class="seqctl"><button class="'+(r.mute?"on":"")+'" data-seq="mute" data-row="'+i+'" title="mute row">M</button>'
       +'<button data-seq="rowclear" data-row="'+i+'" title="clear row">&times;</button></span>'
       +'<span class="seqslot" style="color:'+col+'">'+r.slot+'</span><div class="seqpads" data-row="'+i+'">';
      for(var s2=0;s2<SEQSTEPS;s2++){ var v=r.steps[s2],on=v>0;
        h+='<span class="pad'+(on?" on":"")+(s2%4===0?" beat":"")+'" data-row="'+i+'" data-step="'+s2+'"'+(on?' style="background:'+padBg(r.slot,v)+'"':'')+'></span>'; }
      h+='</div><input type="range" class="seqvol" data-seqvol="'+i+'" min="0" max="1.5" step="0.05" value="'+r.gain+'" title="row volume"></div>';
    }
    document.getElementById("seqrows").innerHTML=h; }
  // set one pad's velocity + update its DOM in place (no full re-render), then schedule the row eval
  function setPad(ri,si,v){ var r=seq[ri]; if(!r)return; r.steps[si]=v;
    var pad=document.querySelector('.pad[data-row="'+ri+'"][data-step="'+si+'"]');
    if(pad){ if(v>0){ pad.classList.add("on"); pad.style.background=padBg(r.slot,v); } else { pad.classList.remove("on"); pad.style.background=""; } }
    pendingSeq[r.slot]=r; }
  // ---- pattern slots (A/B/C/D) + song chaining ----
  // Channels (names/slots/volumes) stay global; each pattern stores only its step matrix.
  var PNAMES=["A","B","C","D"], curPat="A", patSteps={}, songMode=false, songChain=[], songPos=0, songLastPh=0;
  function snapshotSteps(){ return seq.map(function(r){return r.steps.slice();}); }
  function loadSteps(snap){ for(var i=0;i<seq.length;i++){ seq[i].steps=(snap&&snap[i])?snap[i].slice():Array(SEQSTEPS).fill(0); } }
  function patFilled(n){ if(n===curPat) return seq.some(function(r){return r.steps.some(function(v){return v>0;});}); var s=patSteps[n]; return !!(s&&s.some(function(a){return a.some(function(v){return v>0;});})); }
  function patRender(){ var h=""; for(var i=0;i<PNAMES.length;i++){ var n=PNAMES[i]; h+='<button class="patslot'+(n===curPat?" on":"")+(patFilled(n)?" filled":"")+'" data-pat="'+n+'" title="pattern '+n+'">'+n+'</button>'; } var el=document.getElementById("patslots"); if(el)el.innerHTML=h; }
  function selectPat(n,apply){ if(n===curPat)return; patSteps[curPat]=snapshotSteps(); curPat=n; loadSteps(patSteps[n]); patRender(); seqRender(); if(apply!==false) seqApplyAll(); }
  function toggleSong(){ songMode=!songMode; var b=document.getElementById("songBtn");
    if(songMode){ var raw=((document.getElementById("songChain").value||"").toUpperCase().match(/[A-D]/g))||[]; if(!raw.length)raw=PNAMES.filter(patFilled); if(!raw.length)raw=[curPat];
      songChain=raw; songPos=0; if(songChain[0]!==curPat)selectPat(songChain[0],true); if(b){b.classList.add("on");b.textContent="■ Song";} }
    else { if(b){b.classList.remove("on");b.textContent="▶ Song";} var pn=document.getElementById("patnow"); if(pn)pn.textContent=""; } }
  function openSteps(){ var w=document.getElementById("seqwrap");
    if(w.style.display==="block"){ w.style.display="none"; return; }
    document.getElementById("samplewrap").style.display="none"; document.getElementById("cheatwrap").style.display="none"; document.getElementById("curvewrap").style.display="none";
    w.style.display="block"; seqRender(); patRender(); }

  // ---- per-channel modulation curves: draw a curve, it drives a param over N bars ----
  var CURVEPARAMS={cutoff:{lo:150,hi:9000,fmt:function(v){return Math.round(v);}},
    gain:{lo:0,hi:1.5,fmt:function(v){return v.toFixed(2);}},
    pan:{lo:0,hi:1,fmt:function(v){return v.toFixed(2);}},
    speed:{lo:0.25,hi:2,fmt:function(v){return v.toFixed(2);}},
    shape:{lo:0,hi:0.85,fmt:function(v){return v.toFixed(2);}},
    room:{lo:0,hi:1,fmt:function(v){return v.toFixed(2);}}};
  var CURVEN=16, curves={}, curveT={}, painting=null, lastCurveKeys="";
  function curveOf(dn){ if(!curves[dn]) curves[dn]={param:"cutoff",bars:1,on:false,vals:new Array(CURVEN).fill(0.5)}; return curves[dn]; }
  function stripParam(code,p){ return code.replace(new RegExp('#\\s*'+p+'\\s+(\\([^)]*\\)|"[^"]*"|[^#]+)','g'),'').replace(/\s+/g,' ').trim(); }
  function applyCurve(dn){ var c=curves[dn]; if(!c)return; var base=cur.slots[dn]; if(!base)return;
    var stripped=stripParam(base,c.param);
    if(!c.on){ send({cmd:"eval",value:dn+" $ "+stripped}); setTimeout(poll,170); return; }
    var pr=CURVEPARAMS[c.param]; var str=c.vals.map(function(v){return pr.fmt(pr.lo+v*(pr.hi-pr.lo));}).join(" ");
    var term=c.bars>1?'(slow '+c.bars+' "'+str+'")':'"'+str+'"';
    send({cmd:"eval",value:dn+" $ "+stripped+" # "+c.param+" "+term}); setTimeout(poll,170); }
  function applyCurveD(dn){ clearTimeout(curveT[dn]); curveT[dn]=setTimeout(function(){applyCurve(dn);},130); }
  function drawCurve(cv){ var dn=cv.dataset.dn,c=curves[dn]; if(!c)return;
    var W=cv.clientWidth||600; if(cv.width!==W)cv.width=W; var H=cv.height,ctx=cv.getContext("2d"),n=c.vals.length,bw=W/n;
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle="rgba(22,64,31,.55)"; ctx.lineWidth=1;
    for(var g=1;g<4;g++){ var y=H*g/4; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    for(var i=0;i<n;i++){ var bh=c.vals[i]*H; ctx.fillStyle=c.on?chanColorA(dn,0.30):"rgba(78,122,93,.20)"; ctx.fillRect(i*bw+1,H-bh,Math.max(1,bw-2),bh); }
    ctx.strokeStyle=c.on?chanColor(dn):"#5f9d72"; ctx.lineWidth=2; ctx.beginPath();
    for(var j=0;j<n;j++){ var x=j*bw+bw/2,yy=H-c.vals[j]*H; if(j===0)ctx.moveTo(x,yy); else ctx.lineTo(x,yy); } ctx.stroke(); }
  function curveRender(){ var list=document.getElementById("curvelist");
    var keys=Object.keys(cur.slots||{}).sort(function(a,b){return parseInt(a.slice(1))-parseInt(b.slice(1));});
    lastCurveKeys=keys.join(",");
    if(!keys.length){ list.innerHTML='<div class="seqhint" style="padding:8px 0">no layers yet — make a beat first, then draw curves to modulate it.</div>'; return; }
    var pnames=["cutoff","gain","pan","speed","shape","room"],h="";
    keys.forEach(function(k){ var c=curveOf(k);
      h+='<div class="curverow"><div class="curvehd"><span class="slot">'+k+'</span>'
       +'<select class="curveparam" data-dn="'+k+'">'+pnames.map(function(p){return '<option'+(c.param===p?" selected":"")+'>'+p+'</option>';}).join("")+'</select>'
       +'<select class="curvebars" data-dn="'+k+'">'+[1,2,4,8].map(function(b){return '<option value="'+b+'"'+(c.bars===b?" selected":"")+'>'+b+' bar'+(b>1?"s":"")+'</option>';}).join("")+'</select>'
       +'<button class="curveon'+(c.on?" on":"")+'" data-curve="toggle" data-dn="'+k+'">'+(c.on?"ON":"OFF")+'</button>'
       +'<span class="curvepreset">presets</span>'
       +'<button data-curve="preset" data-shape="sine" data-dn="'+k+'" title="sine">&#8767;</button>'
       +'<button data-curve="preset" data-shape="up" data-dn="'+k+'" title="ramp up">/</button>'
       +'<button data-curve="preset" data-shape="down" data-dn="'+k+'" title="ramp down">\\</button>'
       +'<button data-curve="preset" data-shape="rand" data-dn="'+k+'" title="random">rnd</button>'
       +'<button data-curve="preset" data-shape="flat" data-dn="'+k+'" title="flat">flat</button></div>'
       +'<canvas class="curvecv" data-dn="'+k+'" height="70"></canvas></div>';
    });
    list.innerHTML=h;
    document.querySelectorAll(".curvecv").forEach(function(cv){ drawCurve(cv); }); }
  function openCurves(){ var w=document.getElementById("curvewrap");
    if(w.style.display==="block"){ w.style.display="none"; return; }
    document.getElementById("samplewrap").style.display="none"; document.getElementById("cheatwrap").style.display="none"; document.getElementById("seqwrap").style.display="none";
    w.style.display="block"; curveRender(); }
  function curvePreset(dn,shape){ var c=curveOf(dn),n=CURVEN;
    for(var i=0;i<n;i++){ var t=i/(n-1);
      c.vals[i]= shape==="sine"?(0.5+0.5*Math.sin(t*2*Math.PI)) : shape==="up"?t : shape==="down"?(1-t) : shape==="rand"?Math.random() : 0.5; } }
  function paintCurve(cv,cx,cy){ var dn=cv.dataset.dn,c=curves[dn]; if(!c)return; var r=cv.getBoundingClientRect(),n=c.vals.length;
    var col=Math.max(0,Math.min(n-1,Math.floor((cx-r.left)/r.width*n)));
    var val=Math.max(0,Math.min(1,1-(cy-r.top)/r.height));
    if(painting&&painting.lastCol!=null&&Math.abs(col-painting.lastCol)>1){ var a=painting.lastCol,b=col,va=painting.lastVal,st=a<b?1:-1;
      for(var cc=a;cc!==b;cc+=st){ var tt=(cc-a)/(b-a); c.vals[cc]=va+(val-va)*tt; } }
    c.vals[col]=val; if(painting){painting.lastCol=col;painting.lastVal=val;}
    drawCurve(cv); applyCurveD(dn); }

  document.addEventListener("input",function(e){ var el=e.target;
    if(el.id==="consoleIn"){ el.style.height="auto"; el.style.height=Math.min(150,el.scrollHeight)+"px"; return; }
    if(el.id==="sampleFilter"){ var q=el.value.toLowerCase(); var chips=document.querySelectorAll("#sampleList .chip");
      chips.forEach(function(c){ c.style.display=c.dataset.sample.indexOf(q)>=0?"":"none"; }); return; }
    if(el.classList&&el.classList.contains("seqname")){ var sri=+el.dataset.row; seq[sri].name=el.value.trim()||"bd"; clearTimeout(seqNameT[sri]); seqNameT[sri]=setTimeout(function(){ seqApply(seq[sri]); setTimeout(poll,140); },250); return; }
    if(el.type!=="range")return; lastInput=Date.now();
    if(el.dataset.seqvol!==undefined){ var rv=seq[+el.dataset.seqvol]; rv.gain=+el.value; pendingSeq[rv.slot]=rv; return; }
    if(el.id==="seqSwing"){ seqSwing=+el.value; document.getElementById("seqSwingV").textContent=el.value; pendingSwing=true; return; }
    if(el.dataset.tempo!==undefined){ document.getElementById("bpm").textContent=el.value; pendingTempo=+el.value; return; }
    if(el.dataset.slot){ var vb=document.getElementById("v-"+el.dataset.slot+"-"+el.dataset.param); if(vb)vb.textContent=el.value;
      pending[el.dataset.slot+"|"+el.dataset.param]={slot:el.dataset.slot,param:el.dataset.param,value:+el.value}; }
  });
  var lastInput=0,pending={},pendingTempo=null,pendingSeq={},pendingSwing=false,seqNameT={};
  setInterval(function(){ for(var key in pending){ var x=pending[key]; delete pending[key]; send({cmd:"set",slot:x.slot,param:x.param,value:x.value}); }
    if(pendingTempo!=null){ send({cmd:"tempo",value:pendingTempo}); pendingTempo=null; }
    for(var sk in pendingSeq){ var rr=pendingSeq[sk]; delete pendingSeq[sk]; seqApply(rr); }
    if(pendingSwing){ pendingSwing=false; seqApplyAll(); } },80);

  document.addEventListener("click",function(e){ var b=e.target.closest("button"); var chip=e.target.closest(".chip"); var cheat=e.target.closest(".cheat"); var pad=e.target.closest(".pad");
    if(chip){ dropToConsole(nextFreeSlot()+' $ s "'+chip.dataset.sample+'*4"'); return; }
    if(cheat){ dropToConsole(cheat.dataset.code); return; }
    // step pads are handled by the pointer/wheel/contextmenu paint listeners below
    if(!b)return;
    if(b.dataset.act==="run"){ runCode(); return; }
    if(b.dataset.act==="boot"){ var o=document.getElementById("consoleOut"); o.textContent="booting the sound engine… (~30-40s) — watch the status light top-left"; o.className=""; send({cmd:"boot"}).then(function(){poll();}); return; }
    if(b.dataset.act==="cheats"){ openCheats(); return; }
    if(b.dataset.act==="steps"){ openSteps(); return; }
    if(b.dataset.pat){ selectPat(b.dataset.pat,true); setTimeout(poll,160); return; }
    if(b.dataset.act==="songtoggle"){ toggleSong(); return; }
    if(b.dataset.act==="curves"){ openCurves(); return; }
    if(b.dataset.curve==="toggle"){ var cd=curveOf(b.dataset.dn); cd.on=!cd.on; b.classList.toggle("on",cd.on); b.textContent=cd.on?"ON":"OFF"; var cvt=document.querySelector('.curvecv[data-dn="'+b.dataset.dn+'"]'); if(cvt)drawCurve(cvt); applyCurve(b.dataset.dn); return; }
    if(b.dataset.curve==="preset"){ curvePreset(b.dataset.dn,b.dataset.shape); var cvp=document.querySelector('.curvecv[data-dn="'+b.dataset.dn+'"]'); if(cvp)drawCurve(cvp); applyCurveD(b.dataset.dn); return; }
    if(b.dataset.act==="seqadd"){ if(seq.length<12){ seq.push({name:"perc",slot:"d"+(seq.length+1),gain:0.7,mute:false,steps:Array(SEQSTEPS).fill(0)}); seqRender(); } return; }
    if(b.dataset.act==="seqclear"){ seq.forEach(function(r){ r.steps=Array(SEQSTEPS).fill(0); send({cmd:"silence",slot:r.slot}); }); seqRender(); setTimeout(poll,180); return; }
    if(b.dataset.seq==="mute"){ var rm=seq[+b.dataset.row]; rm.mute=!rm.mute; b.classList.toggle("on",rm.mute); seqApply(rm); setTimeout(poll,140); return; }
    if(b.dataset.seq==="rowclear"){ var rc=seq[+b.dataset.row]; rc.steps=Array(SEQSTEPS).fill(0); send({cmd:"silence",slot:rc.slot}); seqRender(); setTimeout(poll,140); return; }
    if(b.dataset.act==="reset"){ if(confirm("Reboot the engine? Wipes everything, fresh start (~30s).")) cmd("reset"); return; }
    if(b.dataset.act==="record"){ cmd("record"); return; }
    if(b.dataset.act==="surprise"){ surprise(); return; }
    if(b.dataset.act==="setloop"){ setLoop(); return; }
    if(b.dataset.act==="samples"){ openSamples(); return; }
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
    if(e.target.classList&&e.target.classList.contains("curveparam")){ var dn=e.target.dataset.dn,c=curveOf(dn),oldp=c.param; c.param=e.target.value;
      var base=cur.slots[dn]; if(base) send({cmd:"eval",value:dn+" $ "+stripParam(stripParam(base,oldp),c.param)});
      setTimeout(function(){applyCurve(dn);},160); return; }
    if(e.target.classList&&e.target.classList.contains("curvebars")){ curveOf(e.target.dataset.dn).bars=+e.target.value; applyCurveD(e.target.dataset.dn); return; }
    if(e.target.id!=="audioSelect")return;
    var d=e.target.value; if(!d){ return; }
    var label=d==="SYSTEM"?"System default":d.replace(/^Windows WASAPI : /,"");
    if(confirm("Switch audio output to:\n  "+label+"\n\nThis restarts the engine (~30s). Your current beat will resume automatically.")){
      var o=document.getElementById("consoleOut"); o.textContent="switching audio → "+label+" … engine rebooting (~30s), your beat will resume"; o.className="";
      send({cmd:"setdevice",value:d}).then(function(){ setTimeout(poll,600); });
    } else { poll(); }
  });

  // draw modulation curves by dragging on a lane
  document.addEventListener("pointerdown",function(e){ var cv=e.target.closest&&e.target.closest(".curvecv"); if(!cv)return;
    painting={dn:cv.dataset.dn,cv:cv,lastCol:null,lastVal:null}; paintCurve(cv,e.clientX,e.clientY); e.preventDefault(); });
  document.addEventListener("pointermove",function(e){ if(painting)paintCurve(painting.cv,e.clientX,e.clientY); });
  document.addEventListener("pointerup",function(){ if(painting){ var dn=painting.dn; painting=null; applyCurve(dn); } });

  // ---- step grid: drag to paint, right-click to erase, scroll a pad for velocity ----
  var seqPaint=null;   // {on:bool} while a left-drag is painting
  document.addEventListener("pointerdown",function(e){ var pad=e.target.closest&&e.target.closest(".pad"); if(!pad||e.button!==0)return;
    var ri=+pad.dataset.row,si=+pad.dataset.step; seqPaint={on:!(seq[ri].steps[si]>0)};   // first pad decides paint-on vs erase
    setPad(ri,si, seqPaint.on?SEQVEL:0); e.preventDefault(); });
  document.addEventListener("pointerover",function(e){ if(!seqPaint)return; var pad=e.target.closest&&e.target.closest(".pad"); if(!pad)return;
    setPad(+pad.dataset.row,+pad.dataset.step, seqPaint.on?SEQVEL:0); });
  document.addEventListener("pointerup",function(){ if(seqPaint){ seqPaint=null; setTimeout(poll,160); } });
  document.addEventListener("contextmenu",function(e){ var pad=e.target.closest&&e.target.closest(".pad"); if(!pad)return; e.preventDefault(); setPad(+pad.dataset.row,+pad.dataset.step,0); setTimeout(poll,160); });
  document.addEventListener("wheel",function(e){ var pad=e.target.closest&&e.target.closest(".pad"); if(!pad)return; var ri=+pad.dataset.row,si=+pad.dataset.step,v=seq[ri].steps[si]; if(!(v>0))return; e.preventDefault();
    setPad(ri,si, +Math.max(0.1,Math.min(1.5, v+(e.deltaY<0?0.1:-0.1))).toFixed(2)); },{passive:false});

  // ---- drag & drop: sample chip -> channel row (set its sound); grip -> reorder rows ----
  document.addEventListener("dragstart",function(e){ var chip=e.target.closest&&e.target.closest(".chip"); var grip=e.target.closest&&e.target.closest(".seqgrip");
    if(chip){ try{ e.dataTransfer.setData("text/sample",chip.dataset.sample); e.dataTransfer.effectAllowed="copy"; }catch(_){} }
    else if(grip){ try{ e.dataTransfer.setData("text/row",grip.dataset.row); e.dataTransfer.effectAllowed="move"; }catch(_){} } });
  document.addEventListener("dragover",function(e){ var row=e.target.closest&&e.target.closest(".seqrow"); if(!row)return; e.preventDefault();
    var prev=document.querySelector(".seqrow.dragover"); if(prev&&prev!==row)prev.classList.remove("dragover"); row.classList.add("dragover"); });
  document.addEventListener("dragend",function(){ var p=document.querySelector(".seqrow.dragover"); if(p)p.classList.remove("dragover"); });
  document.addEventListener("drop",function(e){ var row=e.target.closest&&e.target.closest(".seqrow"); if(!row)return; e.preventDefault(); row.classList.remove("dragover");
    var ti=+row.dataset.row, samp=e.dataTransfer.getData("text/sample"), rw=e.dataTransfer.getData("text/row");
    if(samp){ seq[ti].name=samp; seqRender(); seqApply(seq[ti]); setTimeout(poll,160); }
    else if(rw!==""){ var from=+rw; if(from!==ti && seq[from]){ var moved=seq.splice(from,1)[0]; seq.splice(ti,0,moved); seqRender(); } } });

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
    if(e.key==="c"||e.key==="C"){ openCheats(); return; }
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
    if(!painting && document.getElementById("curvewrap").style.display==="block" && keys.join(",")!==lastCurveKeys) curveRender();
  }
  function poll(){ fetch("/state").then(function(r){return r.json();}).then(render).catch(function(){
    document.getElementById("engstate").textContent="disconnected"; document.getElementById("engdot").className="dot error"; }); }
  setInterval(poll,90); poll(); loadSetList();

  // deep-link: open a panel straight from the URL hash (e.g. .../#steps, #cheats, #curves)
  (function(){ var h=(location.hash||"").slice(1).toLowerCase();
    if(h==="cheats") openCheats();
    else if(h==="samples") openSamples();
    else if(h==="curves") openCurves();
    else if(h==="steps"){
      var on=function(a,ix){ if(a) ix.forEach(function(i){ a.steps[i]=1; }); };
      on(seq[0],[0,4,8,12]); on(seq[1],[4,12]); on(seq[2],[0,2,4,6,8,10,12,14]); on(seq[3],[2,10]);
      openSteps();
    }
  })();
