// dashboard-seq.js — step sequencer + pattern slots (A/B/C/D) + song chaining (window.AbxSeq).
// Owns the step grid: per-step velocity, paint/erase/scroll, sample drag-drop, row reorder,
// pattern snapshots, and the bar-accurate song-advance + grid playhead (driven by dashboard.js
// loopTick). Loaded AFTER dashboard.js (and after dashboard-curves.js so the curve paint
// pointer listener still registers before this one, preserving the original listener order).
(function(){
  var send=Abx.send, poll=Abx.poll, esc=Abx.esc, chanColor=Abx.color.chan, chanColorA=Abx.color.chanA;   // shared core surface

  // ---- step sequencer ----
  var SEQSTEPS=16, seqSwing=0, SEQVEL=1.0;   // SEQVEL = default velocity a freshly-painted step gets
  var seqCurStep=-1;                          // last-lit playhead step (avoids redundant DOM writes)
  var pendingSeq={}, pendingSwing=false, seqNameT={};
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

  // ---- delegates called by dashboard.js's dispatchers, loop, and deep-link ----
  function handleClick(b){
    if(b.dataset.act==="steps"){ openSteps(); return true; }
    if(b.dataset.pat){ selectPat(b.dataset.pat,true); setTimeout(poll,160); return true; }
    if(b.dataset.act==="songtoggle"){ toggleSong(); return true; }
    if(b.dataset.act==="seqadd"){ if(seq.length<12){ seq.push({name:"perc",slot:"d"+(seq.length+1),gain:0.7,mute:false,steps:Array(SEQSTEPS).fill(0)}); seqRender(); } return true; }
    if(b.dataset.act==="seqclear"){ seq.forEach(function(r){ r.steps=Array(SEQSTEPS).fill(0); send({cmd:"silence",slot:r.slot}); }); seqRender(); setTimeout(poll,180); return true; }
    if(b.dataset.seq==="mute"){ var rm=seq[+b.dataset.row]; rm.mute=!rm.mute; b.classList.toggle("on",rm.mute); seqApply(rm); setTimeout(poll,140); return true; }
    if(b.dataset.seq==="rowclear"){ var rc=seq[+b.dataset.row]; rc.steps=Array(SEQSTEPS).fill(0); send({cmd:"silence",slot:rc.slot}); seqRender(); setTimeout(poll,140); return true; }
    return false;
  }
  function handleInput(e){ var el=e.target;
    if(el.classList&&el.classList.contains("seqname")){ var sri=+el.dataset.row; seq[sri].name=el.value.trim()||"bd"; clearTimeout(seqNameT[sri]); seqNameT[sri]=setTimeout(function(){ seqApply(seq[sri]); setTimeout(poll,140); },250); return true; }
    if(el.dataset.seqvol!==undefined){ var rv=seq[+el.dataset.seqvol]; rv.gain=+el.value; pendingSeq[rv.slot]=rv; return true; }
    if(el.id==="seqSwing"){ seqSwing=+el.value; document.getElementById("seqSwingV").textContent=el.value; pendingSwing=true; return true; }
    return false;
  }
  // drain queued row/swing edits (called by dashboard.js's 80ms debounce)
  function flushPending(){
    for(var sk in pendingSeq){ var rr=pendingSeq[sk]; delete pendingSeq[sk]; seqApply(rr); }
    if(pendingSwing){ pendingSwing=false; seqApplyAll(); }
  }
  // song mode: advance to the next pattern in the chain when the cycle wraps (new bar)
  function songAdvance(sp){
    if(!(songMode && songChain.length)) return;
    if(sp < songLastPh-0.5){ songPos=(songPos+1)%songChain.length; if(songChain[songPos]!==curPat) selectPat(songChain[songPos],true);
      var pn=document.getElementById("patnow"); if(pn) pn.textContent="▶ "+songChain.map(function(x,i){return i===songPos?"["+x+"]":x;}).join(" "); }
    songLastPh=sp;
  }
  // light the current step column when the grid is open (playing = has slots && a clock/tempo)
  function renderPlayhead(lphase, playing){
    var sw=document.getElementById("seqwrap"); if(!sw||sw.style.display!=="block") return;
    var pstep=-1;
    if(playing){ var stepF=lphase*SEQSTEPS,si=Math.floor(stepF)%SEQSTEPS,sfrac=stepF-Math.floor(stepF);
      if(seqSwing>0 && (si%2===1) && sfrac < (seqSwing/100)*(SEQSTEPS/8)) si=(si+SEQSTEPS-1)%SEQSTEPS;   // odd pads land late by swingBy amt (measured: 0.3 -> 0.6 step)
      pstep=si; }
    if(pstep!==seqCurStep){ var old=document.querySelectorAll(".pad.now"); for(var oi=0;oi<old.length;oi++)old[oi].classList.remove("now");
      if(pstep>=0){ var nw=document.querySelectorAll('.pad[data-step="'+pstep+'"]'); for(var ni=0;ni<nw.length;ni++)nw[ni].classList.add("now"); } seqCurStep=pstep; }
  }
  // deep-link #steps seeds a demo beat then opens the grid
  function seedDemo(){ var on=function(a,ix){ if(a) ix.forEach(function(i){ a.steps[i]=1; }); };
    on(seq[0],[0,4,8,12]); on(seq[1],[4,12]); on(seq[2],[0,2,4,6,8,10,12,14]); on(seq[3],[2,10]); }

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

  window.AbxSeq={ openSteps:openSteps, handleClick:handleClick, handleInput:handleInput, flushPending:flushPending, songAdvance:songAdvance, renderPlayhead:renderPlayhead, seedDemo:seedDemo };
})();
