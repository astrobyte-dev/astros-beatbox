// dashboard-mixer.js — mixer drawer (window.AbxMixer): vertical channel strips with a fader,
// pan, two FX sends (reverb/delay), mute/solo, a meter, and a mini-scope.
//
// CONSTRAINT: 12 strips, not 16. Driven by the SuperDirt boot config (numOrbits = 12 in
// sc/superdirt_startup.scd). d13-d16 exist in Tidal but have NO orbit, so no per-channel
// reverb/delay (room/delay are per-orbit effects) and no scope. Do NOT raise MIX_CH to 16
// without first raising SuperDirt's numOrbits, or you get four dead strips.
//
// The pure math (faderToGain/gainToFader/pan*) is single-sourced here and unit-tested via
// mixer.test.ts (which imports this file under Node). The DOM/UI is guarded by `typeof document`
// so that Node import stays clean. The browser loads this as a classic <script> AFTER dashboard.js
// (consumes Abx.*) and dashboard-scope.js (reuses AbxScope.draw).
(function(){
  // ---------------- pure math (single source; tested by mixer.test.ts) ----------------
  // Top of travel is a true doubling (+6.02 dB) so the fader top equals the card gain knob's max (2.0).
  var TOP_DB = 20 * Math.log10(2);
  function faderToGain(p){
    // Deadband: the bottom 2% is HARD silence, not -54 dB bleeding through. A fader resting near
    // the bottom should be silent. (This makes the round-trip lossy below 0.02 by design; see below.)
    if (p <= 0.02) return 0;
    var dB = p <= 0.75 ? (p / 0.75) * 60 - 60 : (p - 0.75) / 0.25 * TOP_DB;
    return Math.pow(10, dB / 20);
  }
  function gainToFader(g){
    // Inverse of faderToGain. The deadband is lossy by design: gainToFader(faderToGain(0.01)) === 0,
    // NOT 0.01 -- do not "fix" the round-trip below the deadband, or you reintroduce the silent-leak bug.
    // Out-of-range gains park at the nearest valid end: gain is never < 0 in valid Tidal, and the fader
    // cannot represent > max, so clamping (NaN included -> bottom) is the right answer, not a junk position.
    if (!(g > 0)) return 0;
    var dB = 20 * Math.log10(g);
    var f = dB <= 0 ? (dB + 60) / 60 * 0.75 : 0.75 + (dB / TOP_DB) * 0.25;
    return Math.max(0, Math.min(1, f));
  }
  function clamp01(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }
  function panPositionToString(p){ return clamp01(p).toFixed(2); }
  // garbage-in-centred-out: an unparseable pan defaults to centre (0.5); left or right would surprise.
  function panStringToPosition(s){ var v = parseFloat(s); return isNaN(v) ? 0.5 : clamp01(v); }

  // ---------------- UI (browser only) ----------------
  var MIX_CH = 12;   // see CONSTRAINT above
  var GAIN_DP = 4;   // gain is written with this many decimals (clean code; the wiring test mirrors it)
  var LABEL = { bd:"kick", sn:"snare", sd:"snare", hh:"hat", hc:"hat", ho:"hat", cp:"clap", cr:"crash", rim:"rim", perc:"perc", arpy:"pluck", jvbass:"bass", bass:"bass", wind:"atmos", "808":"808" };
  var mdisp = {};    // eased meter level per slot (matches the master meter's feel)

  function labelFor(code){
    if (!code) return "";
    var syn = code.match(/(?:s|sound)\s+"(super\w+|default)"/);  // a synth (noteful layer)
    if (syn) return syn[1].replace(/^super/, "");
    var sm = code.match(/(?:s|sound)\s+"([a-z0-9]+)/i);          // first sample token
    if (sm) return LABEL[sm[1]] || sm[1];
    return "";
  }
  function meterVal(slot){ var sc = (Abx.state().scopes || {})[slot]; return sc ? Math.min(1, sc.peak || 0) : 0; }

  function stripHTML(slot){
    var st = Abx.state(), code = (st.slots || {})[slot], active = !!code, col = Abx.color.chan(slot);
    var muted = (st.muted || []).indexOf(slot) >= 0, solo = st.solo === slot;
    var gain = active ? Abx.fnum(code, "gain") : null;   if (gain == null) gain = 1;
    var pan  = active ? Abx.fnum(code, "pan")  : null;   if (pan == null)  pan = 0.5;
    var room = active ? Abx.fnum(code, "room") : null;   if (room == null) room = 0;
    var dly  = active ? Abx.fnum(code, "delay"): null;   if (dly == null)  dly = 0;
    var dis = active ? "" : " disabled";   // ghost strips render the layout but their controls are inert
    return '<div class="strip' + (active ? "" : " empty") + (muted ? " muted" : "") + (solo ? " solo" : "") + '" data-slot="' + slot + '" style="--rc:' + col + '">'
      + '<div class="striphd"><span class="slot" style="color:' + col + '">' + slot + '</span><span class="lbl">' + Abx.esc(labelFor(code)) + '</span></div>'
      + '<canvas class="mixscope" data-slot="' + slot + '" height="40"></canvas>'
      + '<div class="sends">'
        + '<label class="send">FX1<input type="range" class="fx1" data-slot="' + slot + '" min="0" max="1" step="0.02" value="' + room + '"' + dis + ' title="reverb send (room)"></label>'
        + '<label class="send">FX2<input type="range" class="fx2" data-slot="' + slot + '" min="0" max="1" step="0.02" value="' + dly + '"' + dis + ' title="delay send"></label>'
      + '</div>'
      + '<div class="panrow"><input type="range" class="pan" data-slot="' + slot + '" min="0" max="1" step="0.02" value="' + panPositionToString(pan) + '"' + dis + ' title="pan (0.5 = centre)"></div>'
      + '<div class="fadarea"><span class="vmeter"><i></i></span>'
        + '<input type="range" class="fader" data-slot="' + slot + '" min="0" max="1" step="0.005" value="' + gainToFader(gain) + '"' + dis + ' title="volume (dB fader, unity at 75%)"></div>'
      + '<div class="msbtns">'
        + '<button class="ms' + (muted ? " on" : "") + '" data-cmd="' + (muted ? "unmute" : "mute") + '" data-slot="' + slot + '"' + dis + ' title="mute">M</button>'
        + '<button class="ms' + (solo ? " on" : "") + '" data-cmd="' + (solo ? "unsolo" : "solo") + '" data-slot="' + slot + '"' + dis + ' title="solo">S</button>'
      + '</div></div>';
  }
  function render(){
    var wrap = document.getElementById("mixrows"); if (!wrap) return;
    var h = ""; for (var i = 1; i <= MIX_CH; i++) h += stripHTML("d" + i);
    wrap.innerHTML = h;
  }
  function isOpen(){ var w = document.getElementById("mixwrap"); return !!(w && w.classList.contains("open")); }
  function openMixer(){
    var w = document.getElementById("mixwrap"); if (!w) return;
    var nowOpen = !w.classList.contains("open");
    w.classList.toggle("open", nowOpen);
    var b = document.getElementById("mixBtn"); if (b) b.classList.toggle("on", nowOpen);
    if (nowOpen) render();   // CSS handles the slide; we only build the strips on open
  }

  // write a param via the same cmd:set path the card knobs use; ghost strips have nothing to write to.
  function setParam(slot, param, value){
    if (!((Abx.state().slots || {})[slot])) return;
    Abx.send({ cmd: "set", slot: slot, param: param, value: value });
  }
  // delegates (mirror the AbxSeq/AbxCurves contract). M/S go through the core data-cmd dispatcher
  // (shared with the cards), so mute/solo stay in sync both ways for free.
  function handleInput(e){
    var el = e.target, slot = el.dataset && el.dataset.slot; if (!slot) return false;
    if (el.classList.contains("fader")) { setParam(slot, "gain", +faderToGain(+el.value).toFixed(GAIN_DP)); return true; }
    if (el.classList.contains("pan"))   { setParam(slot, "pan",  panStringToPosition(el.value)); return true; }
    if (el.classList.contains("fx1"))   { setParam(slot, "room", +(+el.value).toFixed(2)); return true; }
    if (el.classList.contains("fx2"))   { setParam(slot, "delay", +(+el.value).toFixed(2)); return true; }
    return false;
  }
  function handleClick(b){ if (b.dataset.act === "mixer") { openMixer(); return true; } return false; }

  // re-render strips when the live slot set / mute / solo changes (called from dashboard.js render()).
  // Keyed on structure only (not per-value), so dragging a fader does not yank itself mid-gesture.
  var lastSig = "";
  function maybeRerender(){
    if (!isOpen()) return;
    var st = Abx.state();
    var sig = JSON.stringify({ s: Object.keys(st.slots || {}), m: st.muted, so: st.solo });
    if (sig !== lastSig) { lastSig = sig; render(); }
  }
  // animate meters + mini-scopes while the drawer is open (reuses AbxScope.draw; own rAF, idle when shut)
  function tick(){
    if (isOpen()) {
      var strips = document.querySelectorAll("#mixrows .strip");
      for (var i = 0; i < strips.length; i++) {
        var slot = strips[i].dataset.slot;
        var tgt = meterVal(slot);
        mdisp[slot] = (mdisp[slot] || 0) + (tgt - (mdisp[slot] || 0)) * 0.4;   // master-meter feel
        var bar = strips[i].querySelector(".vmeter i"); if (bar) bar.style.height = (Math.sqrt(mdisp[slot]) * 100).toFixed(1) + "%";
        var cv = strips[i].querySelector(".mixscope"); if (cv) AbxScope.draw(cv, slot);
      }
    }
    requestAnimationFrame(tick);
  }

  if (typeof document !== "undefined") {   // DOM wiring only in the browser; the Node test imports the math
    requestAnimationFrame(tick);
  }
  (typeof window !== "undefined" ? window : globalThis).AbxMixer = {
    faderToGain: faderToGain, gainToFader: gainToFader, panPositionToString: panPositionToString, panStringToPosition: panStringToPosition,
    openMixer: openMixer, render: render, handleInput: handleInput, handleClick: handleClick, maybeRerender: maybeRerender
  };
})();
