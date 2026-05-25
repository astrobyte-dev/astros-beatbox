// dashboard-scope.js — per-channel live oscilloscope (window.AbxScope).
// Self-driving: owns its own requestAnimationFrame loop, reads live state + channel colours
// from dashboard.js globals and the pure DSP from dashboard-dsp.js. Loaded AFTER dashboard.js
// so those globals (cur, chanColor, chanColorA, AbxDsp) already exist.
//
// ---- per-channel live scope (synth board): a triggered, pitch-adaptive oscilloscope ----
// SC streams a wide raw window per orbit (cur.scopes[dN].wave). The DSP pipeline:
//  * trigger  — align to a rising zero-crossing so the trace stops jittering (AbxDsp.stabilize)
//  * zoom     — measure the period from evenly-spaced crossings, show ~2 cycles (AbxDsp.stabilize)
//  * classify — irregular/too-fast crossings => transient/noise => raw window (AbxDsp.stabilize)
//  * auto-gain— amplify quiet (keep dynamics), auto-range loud (always readable)
//  * ease     — morph the displayed trace smoothly between the 20Hz data updates
// Falls back to the Strategy A scrolling envelope if no waveform data is present.
(function(){
  var chanColor=Abx.color.chan, chanColorA=Abx.color.chanA;   // consume the shared core surface
  var scopeHist={}, scopeDisp={}, SCOPE_HN=64, SDISP=128, scopeLastPush=performance.now(), SCOPE_PUSH_MS=45;
  function scopeLevel(k){ var sc=(Abx.state().scopes||{})[k]; return sc?Math.min(1,sc.peak||0):0; }
  function scopeWaveOf(k){ var sc=(Abx.state().scopes||{})[k]; return (sc&&sc.wave&&sc.wave.length)?sc.wave:null; }
  function envY(v,H){ return H-1.5-Math.min(1,Math.sqrt(v)*1.55)*(H-3); }
  function drawScope(cv,k){ var W=cv.clientWidth||320; if(cv.width!==W)cv.width=W; var H=cv.height,ctx=cv.getContext("2d"),col=chanColor(k),mid=H/2,amp=H*0.44;
    ctx.clearRect(0,0,W,H);
    var wave=scopeWaveOf(k);
    if(!wave){ var h=scopeHist[k]; if(!h)return; var n2=h.length,step2=W/(n2-1); // Strategy A envelope fallback
      ctx.beginPath(); ctx.moveTo(0,H); for(var a=0;a<n2;a++) ctx.lineTo(a*step2,envY(h[a],H)); ctx.lineTo(W,H); ctx.closePath(); ctx.fillStyle=chanColorA(k,0.16); ctx.fill();
      ctx.beginPath(); for(var b=0;b<n2;b++){ var x2=b*step2,y2=envY(h[b],H); if(b===0)ctx.moveTo(x2,y2); else ctx.lineTo(x2,y2); } ctx.strokeStyle=col; ctx.lineWidth=1.6; ctx.shadowColor=col; ctx.shadowBlur=4; ctx.stroke(); ctx.shadowBlur=0;
      return; }
    var disp=scopeDisp[k]||(scopeDisp[k]=new Array(SDISP).fill(0)), st=AbxDsp.stabilize(wave), target=null;
    if(st){ var gain=Math.min(6,0.92/Math.max(st.mx,1e-4)), rs=AbxDsp.resample(st.seg,SDISP); target=new Array(SDISP);
      for(var t=0;t<SDISP;t++){ var v=rs[t]*gain; target[t]=v>1.25?1.25:(v<-1.25?-1.25:v); } }
    for(var i=0;i<SDISP;i++){ disp[i]+=((target?target[i]:0)-disp[i])*0.3; }
    ctx.strokeStyle="rgba(22,64,31,.45)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,mid); ctx.lineTo(W,mid); ctx.stroke();
    var step=W/(SDISP-1);
    ctx.beginPath(); for(var j=0;j<SDISP;j++){ var x=j*step,y=mid-disp[j]*amp; if(j===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }
    ctx.strokeStyle=col; ctx.lineWidth=1.7; ctx.shadowColor=col; ctx.shadowBlur=6; ctx.stroke(); ctx.shadowBlur=0;
  }
  function scopeTick(){ var now=performance.now(),push=(now-scopeLastPush)>=SCOPE_PUSH_MS; if(push)scopeLastPush=now;
    var live={}; for(var sk in (Abx.state().slots||{}))live[sk]=1;
    for(var hk in scopeHist){ if(!live[hk]) delete scopeHist[hk]; }
    for(var dk in scopeDisp){ if(!live[dk]) delete scopeDisp[dk]; }
    var cvs=document.querySelectorAll(".scope");
    for(var i=0;i<cvs.length;i++){ var cv=cvs[i],k=cv.dataset.slot,h=scopeHist[k]||(scopeHist[k]=new Array(SCOPE_HN).fill(0));
      if(push){ h.push(scopeLevel(k)); if(h.length>SCOPE_HN)h.shift(); }
      drawScope(cv,k); }
    requestAnimationFrame(scopeTick); }
  requestAnimationFrame(scopeTick);
  window.AbxScope = { draw: drawScope, tick: scopeTick };
})();
