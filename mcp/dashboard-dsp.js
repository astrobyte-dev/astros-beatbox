// Single-source DSP for the per-channel oscilloscope and the audio-clock playhead.
// One implementation, two consumers: the browser loads this as a classic <script>
// (window.AbxDsp); the Node test imports it for side-effect and reads globalThis.AbxDsp.
// Keep this pure: no DOM, no globals, no I/O. The stateful clk object + EventSource stay
// in dashboard.js; only the math lives here so it can be unit-tested. See dashboard-dsp.d.ts.

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
// subtract `lead` (Tidal scheduling latency, ~0.25s) so the phase tracks the actual SOUND,
// not the event tap that fires earlier — this is what lands the playhead on the beat.
// Pure: the caller passes performance.now() as nowMs (the stateful clk lives in dashboard.js).
function audioPhase(clk,nowMs){ if(!clk.have||!(clk.cps>0)) return null; var cyc=clk.cycle+(((nowMs-clk.recvAt)/1000)-(clk.lead||0))*clk.cps; return cyc-Math.floor(cyc); }

// universal module footer: window in the browser, globalThis under Node. No `export`, so
// this stays a valid classic <script>; `typeof window` never throws on an undeclared name.
(typeof window!=="undefined"?window:globalThis).AbxDsp={ stabilize:stabilize, resample:resample, audioPhase:audioPhase };
