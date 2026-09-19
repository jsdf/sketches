/**
 * The instrument runs inside a single persistent WebView: the Web Audio synth
 * *and* the touch surfaces you play on.
 *
 * Keeping both in one JS context means a key press reaches the oscillator
 * without crossing the React Native bridge, which is the difference between an
 * instrument that feels playable and one that feels laggy. It also gives us real
 * multi-touch (pointer events) and cheap CSS transitions for the auto-shift.
 *
 * Networking deliberately stays on the React Native side: a WebView loaded from
 * an HTML string has a null origin, so CORS would block the agent's requests.
 */
export const INSTRUMENT_HTML = String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
  :root {
    --bg: #101117;
    --white-key: #f4f1ea;
    --white-key-down: #ffd479;
    --black-key: #24252e;
    --black-key-down: #d8a13c;
    --ink: #14151a;
    --dim: #6f7280;
    --accent: #ffbe4d;
    --root: #ff7a59;
    --pad: #1e2029;
    --pad-line: #2e3140;
  }
  * { -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%; overflow: hidden;
    background: var(--bg); touch-action: none; overscroll-behavior: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #stage { position: relative; width: 100%; height: 100%; }

  /* --- piano ------------------------------------------------------------ */
  #piano { position: absolute; inset: 0; overflow: hidden; }
  #scroller { position: absolute; top: 0; bottom: 0; left: 0; will-change: transform;
              transition: transform 280ms cubic-bezier(.22,.61,.36,1); }
  .wk { position: absolute; top: 0; bottom: 0; background: var(--white-key);
        border: 1px solid #c9c4b8; border-radius: 0 0 7px 7px; }
  .bk { position: absolute; top: 0; height: 62%; background: var(--black-key);
        border-radius: 0 0 5px 5px; box-shadow: 0 2px 4px rgba(0,0,0,.5); z-index: 2; }
  .wk.down { background: var(--white-key-down); }
  .bk.down { background: var(--black-key-down); }
  .wk.hl { background: #ffe9bd; }
  .bk.hl { background: #6b5a33; }
  .wk.root { background: #ffc9b8; }
  .bk.root { background: #7d4536; }
  .klabel { position: absolute; bottom: 5px; left: 0; right: 0; text-align: center;
            font-size: 10px; font-weight: 600; color: var(--dim); pointer-events: none; }
  .bk .klabel { bottom: 4px; color: #9a9db0; font-size: 9px; }
  .wk.hl .klabel, .wk.root .klabel { color: #6b4a1d; }
  .bk.hl .klabel, .bk.root .klabel { color: #ffe0a8; }
  .kdeg { position: absolute; top: 6px; left: 0; right: 0; text-align: center;
          font-size: 9px; font-weight: 700; color: #b07c2a; pointer-events: none; }
  .bk .kdeg { color: var(--accent); }

  /* --- pad grid --------------------------------------------------------- */
  #pads { position: absolute; inset: 0; display: none; padding: 6px; gap: 6px;
          flex-direction: column; }
  .prow { display: flex; flex: 1; gap: 6px; }
  .pad { flex: 1; background: var(--pad); border: 1px solid var(--pad-line); border-radius: 10px;
         display: flex; flex-direction: column; align-items: center; justify-content: center;
         color: #e8e8ef; position: relative; overflow: hidden; }
  .pad.down { background: var(--accent); border-color: var(--accent); color: #1a1405; }
  .pad.root { border-color: var(--root); }
  .pad.cue { box-shadow: inset 0 0 0 2px var(--accent); }
  .pname { font-size: 17px; font-weight: 700; letter-spacing: .2px; }
  .psub { font-size: 10px; color: var(--dim); margin-top: 2px; font-weight: 600; }
  .pad.down .psub { color: #5a4712; }
  #hint { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center;
          font-size: 10px; color: var(--dim); pointer-events: none; }
  #empty { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
           color: var(--dim); font-size: 12px; }
</style>
</head>
<body>
<div id="stage">
  <div id="piano"><div id="scroller"></div></div>
  <div id="pads"></div>
  <div id="empty">No instrument</div>
</div>
<script>
(function () {
  'use strict';

  /* ===================== audio engine ===================== */

  var LOOKAHEAD = 0.25, TICK_MS = 25, START_PAD = 0.08;
  var ctx = null, master = null, comp = null, verb = null, verbGain = null;
  var chans = {}, live = {};
  var CHANNELS = ['chords', 'melody', 'user', 'click'];

  function send(obj) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(obj));
  }
  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function makeImpulse(seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function initAudio() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    verb = ctx.createConvolver(); verb.buffer = makeImpulse(1.6, 3.2);
    verbGain = ctx.createGain(); verbGain.gain.value = 0.22;
    verb.connect(verbGain); verbGain.connect(comp);
    for (var i = 0; i < CHANNELS.length; i++) {
      var name = CHANNELS[i];
      var g = ctx.createGain(); g.gain.value = name === 'click' ? 0 : 1; g.connect(master);
      var s = ctx.createGain(); s.gain.value = name === 'click' ? 0 : 0.5;
      g.connect(s); s.connect(verb);
      chans[name] = {gain: g, send: s};
    }
    send({t: 'ready', rate: ctx.sampleRate});
  }
  function resume() { if (!ctx) initAudio(); if (ctx.state === 'suspended') ctx.resume(); }

  var TIMBRE = {
    chords: {waves: ['triangle','sine'], detune: 6, cut: 5.5, minCut: 700, maxCut: 4200, q: .6, a: .014, d: .28, s: .55, r: .34, gain: .17},
    melody: {waves: ['sawtooth','triangle'], detune: 4, cut: 7.5, minCut: 900, maxCut: 6000, q: .9, a: .008, d: .16, s: .62, r: .26, gain: .2},
    user:   {waves: ['sawtooth','sine'], detune: 5, cut: 8.5, minCut: 1000, maxCut: 7000, q: 1, a: .006, d: .18, s: .66, r: .42, gain: .23}
  };

  function makeVoice(chName, midi, vel) {
    var spec = TIMBRE[chName] || TIMBRE.user, f = freq(midi);
    var out = ctx.createGain(); out.gain.value = 0;
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = spec.q;
    filt.frequency.value = Math.max(spec.minCut, Math.min(spec.maxCut, f * spec.cut));
    filt.connect(out);
    var oscs = [];
    for (var i = 0; i < spec.waves.length; i++) {
      var o = ctx.createOscillator();
      o.type = spec.waves[i]; o.frequency.value = f;
      o.detune.value = i === 0 ? -spec.detune : spec.detune;
      var og = ctx.createGain(); og.gain.value = i === 0 ? 1 : .45;
      o.connect(og); og.connect(filt); oscs.push(o);
    }
    out.connect((chans[chName] || chans.user).gain);
    var tilt = 1 - (midi - 60) * .005;
    var peak = spec.gain * (vel == null ? 1 : vel) * Math.max(.55, Math.min(1.5, tilt));
    var stopped = false;
    return {
      start: function (t) {
        for (var i = 0; i < oscs.length; i++) oscs[i].start(t);
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(0.0001, t);
        out.gain.linearRampToValueAtTime(peak, t + spec.a);
        out.gain.setTargetAtTime(peak * spec.s, t + spec.a, spec.d / 3);
      },
      release: function (t) {
        if (stopped) return; stopped = true;
        var end = t + spec.r;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t);
        out.gain.exponentialRampToValueAtTime(0.0001, end);
        for (var i = 0; i < oscs.length; i++) oscs[i].stop(end + .03);
      }
    };
  }

  function click(t, accent) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = accent ? 1760 : 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? .5 : .28, t + .002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .05);
    o.connect(g); g.connect(chans.click.gain); o.start(t); o.stop(t + .07);
  }

  function oneShot(chName, midi, t, durSec, vel) {
    if (chName === 'click') { click(t, midi === 1); return; }
    var v = makeVoice(chName, midi, vel);
    v.start(t); v.release(t + Math.max(.05, durSec));
  }

  function noteOn(chName, midi, vel, silentReport) {
    resume();
    var key = chName + ':' + midi;
    if (live[key]) live[key].release(ctx.currentTime);
    var v = makeVoice(chName, midi, vel);
    v.start(ctx.currentTime);
    live[key] = v;
    if (!silentReport) send({t: 'note', on: true, m: midi});
  }
  function noteOff(chName, midi, silentReport) {
    var key = chName + ':' + midi;
    if (live[key]) { live[key].release(ctx.currentTime); delete live[key]; }
    if (!silentReport) send({t: 'note', on: false, m: midi});
  }
  function allOff() {
    for (var k in live) if (live.hasOwnProperty(k)) live[k].release(ctx.currentTime);
    live = {};
  }

  /* ===================== sequencer ===================== */

  var seq = {playing:false, events:[], tempo:100, spb:.6, loopStart:0, loopEnd:0,
             iterStart:0, nextIdx:0, loop:true, timer:null, lastPost:0};
  function loopBeats() { return Math.max(.001, seq.loopEnd - seq.loopStart); }

  function buildClicks(bpb, from, to, offset) {
    var out = [], b = Math.ceil(from - .0001);
    for (; b < to; b++) {
      var down = (((b - offset) % bpb) + bpb) % bpb === 0;
      out.push({b: b, d: .1, m: down ? 1 : 0, c: 'click', v: 1});
    }
    return out;
  }

  function play(msg) {
    resume(); allOff();
    seq.events = (msg.events || []).slice();
    if (msg.beatsPerBar) {
      seq.events = seq.events.concat(buildClicks(msg.beatsPerBar, msg.loopStart || 0, msg.loopEnd || 0, msg.barOffset || 0));
    }
    seq.events.sort(function (a, b) { return a.b - b.b; });
    seq.tempo = msg.tempo || 100; seq.spb = 60 / seq.tempo;
    seq.loop = !!msg.loop; seq.loopStart = msg.loopStart || 0; seq.loopEnd = msg.loopEnd || 0;
    var startBeat = msg.startBeat != null ? msg.startBeat : seq.loopStart;
    var now = ctx.currentTime + START_PAD;
    var countIn = msg.countIn || 0;
    if (countIn > 0) {
      var bpb = msg.beatsPerBar || 4;
      for (var i = 0; i < countIn; i++) click(now + i * seq.spb, i % bpb === 0);
      now += countIn * seq.spb;
    }
    seq.iterStart = now - (startBeat - seq.loopStart) * seq.spb;
    seq.nextIdx = 0;
    while (seq.nextIdx < seq.events.length && seq.events[seq.nextIdx].b < startBeat) seq.nextIdx++;
    seq.playing = true;
    if (seq.timer) clearInterval(seq.timer);
    seq.timer = setInterval(tick, TICK_MS);
    send({t: 'state', playing: true});
    tick();
  }

  function stopSeq(finished) {
    if (seq.timer) { clearInterval(seq.timer); seq.timer = null; }
    seq.playing = false; allOff();
    send({t: 'state', playing: false, finished: !!finished});
  }

  function position() {
    var raw = seq.loopStart + (ctx.currentTime - seq.iterStart) / seq.spb;
    if (seq.loop) {
      var len = loopBeats(), rel = (raw - seq.loopStart) % len;
      if (rel < 0) rel += len;
      return seq.loopStart + rel;
    }
    return Math.min(raw, seq.loopEnd);
  }

  function tick() {
    if (!seq.playing || !ctx) return;
    var horizon = ctx.currentTime + LOOKAHEAD, guard = 0;
    while (guard++ < 400) {
      if (seq.nextIdx >= seq.events.length) {
        if (!seq.loop) {
          if (ctx.currentTime > seq.iterStart + loopBeats() * seq.spb) { stopSeq(true); return; }
          break;
        }
        seq.iterStart += loopBeats() * seq.spb; seq.nextIdx = 0; continue;
      }
      var ev = seq.events[seq.nextIdx];
      var t = seq.iterStart + (ev.b - seq.loopStart) * seq.spb;
      if (t > horizon) break;
      if (t >= ctx.currentTime - .05) oneShot(ev.c, ev.m, t, (ev.d || 1) * seq.spb, ev.v == null ? 1 : ev.v);
      seq.nextIdx++;
    }
    var ms = Date.now();
    if (ms - seq.lastPost > 55) { seq.lastPost = ms; send({t: 'pos', beat: position()}); }
  }

  /* ===================== instrument surfaces ===================== */

  var pianoEl = document.getElementById('piano');
  var scroller = document.getElementById('scroller');
  var padsEl = document.getElementById('pads');
  var emptyEl = document.getElementById('empty');

  var mode = 'none';
  var keyEls = {};            // midi -> element (piano)
  var padList = [];           // pad descriptors
  var pointerTargets = {};    // pointerId -> {kind, midi|padIndex}
  var cfg = {low: 48, high: 84, labels: 'all', highlight: {}, keyWidth: 44};

  var WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
  var BLACK_OFFSET = {1: 0, 3: 1, 6: 3, 8: 4, 10: 5};
  function isBlack(m) { return BLACK_OFFSET[((m % 12) + 12) % 12] !== undefined; }
  var NAMES_S = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  var NAMES_F = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

  /**
   * Horizontal position of a note in white-key units from MIDI 0.
   * For a white note this is its own index; for a black note it is the count of
   * white keys below it, which lands exactly on the boundary it straddles.
   */
  function whiteIndex(m) {
    var oct = Math.floor(m / 12), pc = ((m % 12) + 12) % 12;
    var within = 0;
    for (var i = 0; i < WHITE_PC.length; i++) if (WHITE_PC[i] < pc) within++;
    if (!isBlack(m)) within = WHITE_PC.indexOf(pc);
    return oct * 7 + within;
  }

  function buildPiano(c) {
    scroller.innerHTML = '';
    keyEls = {};
    var kw = c.keyWidth || 44;
    var bw = Math.round(kw * 0.62);
    var baseWhite = whiteIndex(c.low);
    var whites = [], blacks = [];
    for (var m = c.low; m <= c.high; m++) (isBlack(m) ? blacks : whites).push(m);

    for (var i = 0; i < whites.length; i++) {
      var m2 = whites[i];
      var el = document.createElement('div');
      el.className = 'wk';
      el.style.left = ((whiteIndex(m2) - baseWhite) * kw) + 'px';
      el.style.width = kw + 'px';
      el.dataset.midi = String(m2);
      el.appendChild(labelNodes(m2, c));
      scroller.appendChild(el);
      keyEls[m2] = el;
    }
    for (var j = 0; j < blacks.length; j++) {
      var m3 = blacks[j];
      var el2 = document.createElement('div');
      el2.className = 'bk';
      // A black key sits on the boundary between its two neighbouring whites.
      el2.style.left = ((whiteIndex(m3) - baseWhite) * kw - bw / 2) + 'px';
      el2.style.width = bw + 'px';
      el2.dataset.midi = String(m3);
      el2.appendChild(labelNodes(m3, c));
      scroller.appendChild(el2);
      keyEls[m3] = el2;
    }
    scroller.style.width = ((whiteIndex(c.high) - baseWhite + 1) * kw) + 'px';
    applyHighlights(c);
  }

  function labelNodes(m, c) {
    var frag = document.createDocumentFragment();
    var names = c.flats ? NAMES_F : NAMES_S;
    var pc = ((m % 12) + 12) % 12;
    var show = c.labels === 'all' || (c.labels === 'c' && pc === 0) || (c.labels === 'white' && !isBlack(m));
    if (show) {
      var lab = document.createElement('div');
      lab.className = 'klabel';
      lab.textContent = names[pc] + (c.labels === 'c' || c.octaveLabels ? String(Math.floor(m / 12) - 1) : '');
      frag.appendChild(lab);
    }
    var deg = c.degrees && c.degrees[String(m)];
    if (deg) {
      var d = document.createElement('div');
      d.className = 'kdeg';
      d.textContent = deg;
      frag.appendChild(d);
    }
    return frag;
  }

  function applyHighlights(c) {
    for (var m in keyEls) {
      if (!keyEls.hasOwnProperty(m)) continue;
      var el = keyEls[m];
      el.classList.remove('hl', 'root');
      var h = c.highlight && c.highlight[m];
      if (h === 'root') el.classList.add('root');
      else if (h) el.classList.add('hl');
    }
  }

  function shiftTo(c) {
    // Centre the notes of interest, then clamp so the keybed edges stay put.
    var targets = c.focus || [];
    var viewW = pianoEl.clientWidth;
    var kw = c.keyWidth || 44;
    var contentW = parseFloat(scroller.style.width) || viewW;
    var x = 0;
    if (targets.length && contentW > viewW) {
      var lo = Math.min.apply(null, targets), hi = Math.max.apply(null, targets);
      var base = whiteIndex(c.low);
      var loX = (whiteIndex(lo) - base) * kw;
      var hiX = (whiteIndex(hi) - base + 1) * kw;
      x = (loX + hiX) / 2 - viewW / 2;
      x = Math.max(0, Math.min(contentW - viewW, x));
    }
    scroller.style.transform = 'translateX(' + (-Math.round(x)) + 'px)';
  }

  function buildPads(c) {
    padsEl.innerHTML = '';
    padList = (c.items || []).slice();
    var cols = c.cols || Math.min(4, Math.max(2, Math.ceil(Math.sqrt(padList.length))));
    var rows = Math.ceil(padList.length / cols) || 1;
    var idx = 0;
    for (var r = 0; r < rows; r++) {
      var row = document.createElement('div');
      row.className = 'prow';
      for (var col = 0; col < cols; col++) {
        if (idx >= padList.length) {
          var spacer = document.createElement('div');
          spacer.style.flex = '1';
          row.appendChild(spacer);
          idx++;
          continue;
        }
        var item = padList[idx];
        var pad = document.createElement('div');
        pad.className = 'pad' + (item.root ? ' root' : '');
        pad.dataset.pad = String(idx);
        var n = document.createElement('div');
        n.className = 'pname'; n.textContent = item.label || '';
        pad.appendChild(n);
        if (item.sub) {
          var s2 = document.createElement('div');
          s2.className = 'psub'; s2.textContent = item.sub;
          pad.appendChild(s2);
        }
        row.appendChild(pad);
        idx++;
      }
      padsEl.appendChild(row);
    }
  }

  function setInstrument(c) {
    mode = c.mode || 'none';
    releaseAllPointers();
    pianoEl.style.display = mode === 'piano' ? 'block' : 'none';
    padsEl.style.display = mode === 'pads' ? 'flex' : 'none';
    emptyEl.style.display = mode === 'none' ? 'flex' : 'none';
    if (mode === 'piano') {
      cfg = c;
      buildPiano(c);
      // Let layout settle before measuring for the shift.
      requestAnimationFrame(function () { shiftTo(c); });
    } else if (mode === 'pads') {
      cfg = c;
      buildPads(c);
    }
  }

  function updateInstrument(c) {
    if (mode === 'piano') {
      if (c.highlight) { cfg.highlight = c.highlight; applyHighlights(cfg); }
      if (c.degrees) { cfg.degrees = c.degrees; buildPiano(cfg); }
      if (c.focus) { cfg.focus = c.focus; shiftTo(cfg); }
    } else if (mode === 'pads' && c.items) {
      buildPads(c);
      cfg = c;
    }
    if (c.cue != null) setCue(c.cue);
  }

  var cueIndex = null;
  function setCue(i) {
    if (cueIndex != null) {
      var prev = padsEl.querySelector('[data-pad="' + cueIndex + '"]');
      if (prev) prev.classList.remove('cue');
    }
    cueIndex = i < 0 ? null : i;
    if (cueIndex != null) {
      var el = padsEl.querySelector('[data-pad="' + cueIndex + '"]');
      if (el) el.classList.add('cue');
    }
  }

  /* --- pointer handling (multi-touch) ----------------------------------- */

  function targetAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.midi != null) return {kind: 'key', midi: parseInt(el.dataset.midi, 10), el: el};
      if (el.dataset && el.dataset.pad != null) return {kind: 'pad', index: parseInt(el.dataset.pad, 10), el: el};
      el = el.parentElement;
    }
    return null;
  }

  function engage(target) {
    if (!target) return;
    target.el.classList.add('down');
    if (target.kind === 'key') {
      noteOn('user', target.midi, 1);
    } else {
      var item = padList[target.index];
      if (!item) return;
      resume();
      var notes = item.notes || [];
      if (item.hold) {
        // Sustains for as long as the pad is held, for noodling on a scale.
        for (var h = 0; h < notes.length; h++) noteOn('user', notes[h], 1, true);
      } else {
        var base = ctx.currentTime + .005;
        var strum = item.strum == null ? .012 : item.strum;
        for (var i = 0; i < notes.length; i++) {
          oneShot('user', notes[i], base + i * strum, item.dur || 1.1, 1);
        }
      }
      send({t: 'pad', index: target.index, notes: notes});
    }
  }

  function disengage(target) {
    if (!target) return;
    target.el.classList.remove('down');
    if (target.kind === 'key') {
      noteOff('user', target.midi);
      return;
    }
    var item = padList[target.index];
    if (item && item.hold) {
      var notes = item.notes || [];
      for (var i = 0; i < notes.length; i++) noteOff('user', notes[i], true);
    }
  }

  function sameTarget(a, b) {
    if (!a || !b) return false;
    return a.kind === b.kind && (a.kind === 'key' ? a.midi === b.midi : a.index === b.index);
  }

  function releaseAllPointers() {
    for (var id in pointerTargets) {
      if (pointerTargets.hasOwnProperty(id)) disengage(pointerTargets[id]);
    }
    pointerTargets = {};
  }

  document.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    resume();
    var t = targetAt(e.clientX, e.clientY);
    if (!t) return;
    pointerTargets[e.pointerId] = t;
    engage(t);
  }, {passive: false});

  document.addEventListener('pointermove', function (e) {
    var prev = pointerTargets[e.pointerId];
    if (!prev) return;
    var t = targetAt(e.clientX, e.clientY);
    if (sameTarget(prev, t)) return;
    disengage(prev);
    if (t) { pointerTargets[e.pointerId] = t; engage(t); }
    else delete pointerTargets[e.pointerId];
  }, {passive: false});

  function endPointer(e) {
    var t = pointerTargets[e.pointerId];
    if (!t) return;
    disengage(t);
    delete pointerTargets[e.pointerId];
  }
  document.addEventListener('pointerup', endPointer, {passive: false});
  document.addEventListener('pointercancel', endPointer, {passive: false});
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* --- playback highlighting -------------------------------------------- */

  var flashed = [];
  function flash(notes) {
    for (var i = 0; i < flashed.length; i++) {
      var old = keyEls[flashed[i]];
      if (old) old.classList.remove('down');
    }
    flashed = [];
    if (!notes) return;
    for (var j = 0; j < notes.length; j++) {
      var el = keyEls[notes[j]];
      if (el) { el.classList.add('down'); flashed.push(notes[j]); }
    }
  }

  /* ===================== command dispatch ===================== */

  function cmd(msg) {
    try {
      if (!ctx && msg.t !== 'inst' && msg.t !== 'update') initAudio();
      switch (msg.t) {
        case 'init': initAudio(); resume(); break;
        case 'resume': resume(); break;
        case 'inst': setInstrument(msg.cfg || {mode: 'none'}); break;
        case 'update': updateInstrument(msg.cfg || {}); break;
        case 'flash': flash(msg.notes); break;
        case 'on': noteOn(msg.c || 'user', msg.m, msg.v, true); break;
        case 'off': noteOff(msg.c || 'user', msg.m, true); break;
        case 'allOff': allOff(); releaseAllPointers(); flash(null); break;
        case 'hit':
          resume();
          var base = ctx.currentTime + .01;
          var notes = msg.notes || [msg.m];
          for (var i = 0; i < notes.length; i++) {
            oneShot(msg.c || 'user', notes[i], base + i * (msg.strum || 0), msg.dur || .7, msg.v == null ? 1 : msg.v);
          }
          break;
        case 'play': play(msg); break;
        case 'stop': stopSeq(false); flash(null); break;
        case 'tempo':
          if (seq.playing) {
            var at = position();
            seq.tempo = msg.tempo; seq.spb = 60 / seq.tempo;
            seq.iterStart = ctx.currentTime - (at - seq.loopStart) * seq.spb;
            seq.nextIdx = 0;
            while (seq.nextIdx < seq.events.length && seq.events[seq.nextIdx].b < at) seq.nextIdx++;
          } else { seq.tempo = msg.tempo; seq.spb = 60 / seq.tempo; }
          break;
        case 'gain':
          if (chans[msg.c]) {
            chans[msg.c].gain.gain.setTargetAtTime(msg.v, ctx.currentTime, .02);
            if (msg.c !== 'click') chans[msg.c].send.gain.setTargetAtTime(msg.v * .5, ctx.currentTime, .02);
          }
          break;
        case 'master': master.gain.setTargetAtTime(msg.v, ctx.currentTime, .02); break;
      }
    } catch (e) {
      send({t: 'err', msg: String(e && e.message ? e.message : e)});
    }
  }

  window.SP = {cmd: cmd};
  function onMessage(e) { try { cmd(JSON.parse(e.data)); } catch (err) {} }
  window.addEventListener('message', onMessage);
  document.addEventListener('message', onMessage);
  window.addEventListener('resize', function () {
    if (mode === 'piano' && cfg) { buildPiano(cfg); shiftTo(cfg); }
  });

  send({t: 'loaded'});
})();
</script>
</body>
</html>`;
