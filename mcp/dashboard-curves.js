// dashboard-curves.js — per-channel modulation curves (window.AbxCurves).
// Draw a curve on a lane and it drives a Tidal param over N bars. Owns its own paint pointer
// listeners. Loaded AFTER dashboard.js; reaches dashboard.js globals at call time.
(function(){
  var send=Abx.send, poll=Abx.poll, chanColor=Abx.color.chan, chanColorA=Abx.color.chanA;   // shared core surface

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
  function applyCurve(dn){ var c=curves[dn]; if(!c)return; var base=Abx.state().slots[dn]; if(!base)return;
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
    var keys=Object.keys(Abx.state().slots||{}).sort(function(a,b){return parseInt(a.slice(1))-parseInt(b.slice(1));});
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

  // delegates called by dashboard.js's single click/change dispatchers + render loop
  function handleClick(b){
    if(b.dataset.act==="curves"){ openCurves(); return true; }
    if(b.dataset.curve==="toggle"){ var cd=curveOf(b.dataset.dn); cd.on=!cd.on; b.classList.toggle("on",cd.on); b.textContent=cd.on?"ON":"OFF"; var cvt=document.querySelector('.curvecv[data-dn="'+b.dataset.dn+'"]'); if(cvt)drawCurve(cvt); applyCurve(b.dataset.dn); return true; }
    if(b.dataset.curve==="preset"){ curvePreset(b.dataset.dn,b.dataset.shape); var cvp=document.querySelector('.curvecv[data-dn="'+b.dataset.dn+'"]'); if(cvp)drawCurve(cvp); applyCurveD(b.dataset.dn); return true; }
    return false;
  }
  function handleChange(e){
    if(e.target.classList&&e.target.classList.contains("curveparam")){ var dn=e.target.dataset.dn,c=curveOf(dn),oldp=c.param; c.param=e.target.value;
      var base=Abx.state().slots[dn]; if(base) send({cmd:"eval",value:dn+" $ "+stripParam(stripParam(base,oldp),c.param)});
      setTimeout(function(){applyCurve(dn);},160); return true; }
    if(e.target.classList&&e.target.classList.contains("curvebars")){ curveOf(e.target.dataset.dn).bars=+e.target.value; applyCurveD(e.target.dataset.dn); return true; }
    return false;
  }
  // re-render the lanes when the live slot set changes (called from dashboard.js render())
  function maybeRerender(keys){ if(!painting && document.getElementById("curvewrap").style.display==="block" && keys.join(",")!==lastCurveKeys) curveRender(); }

  // draw modulation curves by dragging on a lane
  document.addEventListener("pointerdown",function(e){ var cv=e.target.closest&&e.target.closest(".curvecv"); if(!cv)return;
    painting={dn:cv.dataset.dn,cv:cv,lastCol:null,lastVal:null}; paintCurve(cv,e.clientX,e.clientY); e.preventDefault(); });
  document.addEventListener("pointermove",function(e){ if(painting)paintCurve(painting.cv,e.clientX,e.clientY); });
  document.addEventListener("pointerup",function(){ if(painting){ var dn=painting.dn; painting=null; applyCurve(dn); } });

  window.AbxCurves={ openCurves:openCurves, curveRender:curveRender, handleClick:handleClick, handleChange:handleChange, maybeRerender:maybeRerender };
})();
