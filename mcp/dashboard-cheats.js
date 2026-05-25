// dashboard-cheats.js — cheat sheet + sample browser (window.AbxCheats).
// The "get code into the rig" surface: clickable Tidal snippets and the drag-drop sample
// browser. Loaded AFTER dashboard.js; reaches dashboard.js globals at call time.
(function(){
  var esc=Abx.esc;   // consume the shared core surface (nextFreeSlot reads Abx.state())
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
    for(var k in (Abx.state().slots||{})) used[k]=1;
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
  // delegates called by dashboard.js's single click/input dispatchers
  function handleClick(e){
    var chip=e.target.closest(".chip"); if(chip){ dropToConsole(nextFreeSlot()+' $ s "'+chip.dataset.sample+'*4"'); return true; }
    var cheat=e.target.closest(".cheat"); if(cheat){ dropToConsole(cheat.dataset.code); return true; }
    var b=e.target.closest("button"); if(b){ if(b.dataset.act==="cheats"){ openCheats(); return true; } if(b.dataset.act==="samples"){ openSamples(); return true; } }
    return false;
  }
  function handleInput(e){ var el=e.target;
    if(el.id==="sampleFilter"){ var q=el.value.toLowerCase(); var chips=document.querySelectorAll("#sampleList .chip");
      chips.forEach(function(c){ c.style.display=c.dataset.sample.indexOf(q)>=0?"":"none"; }); return true; }
    return false;
  }
  window.AbxCheats={ openCheats:openCheats, openSamples:openSamples, dropToConsole:dropToConsole, nextFreeSlot:nextFreeSlot, handleClick:handleClick, handleInput:handleInput };
})();
