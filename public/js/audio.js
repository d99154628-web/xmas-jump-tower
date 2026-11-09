/*
 * audio.js — Web Audio 로 직접 연주하는 8비트 음악·효과음.
 * 배경음악: "Jingle Bells"(James Lord Pierpont, 1857 — 퍼블릭 도메인) 신나는 칩튠 편곡.
 * 녹음 파일이 아니라 코드로 연주하므로 음원 저작권 문제가 없고, 다운로드 용량도 0.
 */
(function (root) {
  'use strict';
  let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
  let musicOn = true, timer = null, nextTime = 0, step = 0;
  const BPM = 152;
  const BEAT = 60 / BPM;

  const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const midi = (n) => { const m = n.match(/^([A-G]#?)(\d)$/); return 12 * (Number(m[2]) + 1) + NOTE[m[1]]; };
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // [음, 박자] — 한 옥타브 올려서 밝게
  const VERSE = 'G4 1,E5 1,D5 1,C5 1,G4 3,G4 .5,G4 .5,G4 1,E5 1,D5 1,C5 1,A4 4,A4 1,F5 1,E5 1,D5 1,B4 4,G5 1,G5 1,F5 1,D5 1,E5 4,' +
    'G4 1,E5 1,D5 1,C5 1,G4 4,G4 1,E5 1,D5 1,C5 1,A4 3,A4 1,A4 1,F5 1,E5 1,D5 1,G5 1,G5 1,G5 1,G5 1,A5 1,G5 1,F5 1,D5 1,C5 2,G5 2';
  const CHORUS = 'E5 1,E5 1,E5 2,E5 1,E5 1,E5 2,E5 1,G5 1,C5 1.5,D5 .5,E5 4,F5 1,F5 1,F5 1.5,F5 .5,F5 1,E5 1,E5 1,E5 .5,E5 .5,E5 1,D5 1,D5 1,E5 1,D5 2,G5 2,' +
    'E5 1,E5 1,E5 2,E5 1,E5 1,E5 2,E5 1,G5 1,C5 1.5,D5 .5,E5 4,F5 1,F5 1,F5 1.5,F5 .5,F5 1,E5 1,E5 1,E5 .5,E5 .5,G5 1,G5 1,F5 1,D5 1,C5 4';
  const parse = (s) => s.split(',').map((t) => { const [n, d] = t.trim().split(' '); return [midi(n), Number(d)]; });
  const MELODY = parse(VERSE).concat(parse(CHORUS));
  // 마디(4박)마다 화음 근음
  const CHORDS = 'C C C F F G G C C C C F F G G G C C C C F C D G C C C C F C G C'.split(' ');
  const ROOT = { C: 48, D: 50, F: 53, G: 43 };

  // 멜로디를 8분음표 격자의 이벤트로 펼친다
  const EVENTS = [];
  (function build() {
    let t = 0;
    for (const [m, d] of MELODY) { EVENTS.push({ t, type: 'mel', m, d }); t += d; }
    const total = t;
    for (let bar = 0; bar * 4 < total; bar++) {
      const r = ROOT[CHORDS[bar % CHORDS.length]];
      for (let b = 0; b < 4; b++) EVENTS.push({ t: bar * 4 + b, type: 'bass', m: b % 2 === 0 ? r : r + 7, d: 0.45 });
      for (let h = 0; h < 8; h++) EVENTS.push({ t: bar * 4 + h * 0.5, type: 'bell', acc: h % 2 === 1 });
    }
    EVENTS.sort((a, b) => a.t - b.t);
    EVENTS.total = total;
  })();

  function init() {
    if (ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(bus, type, f, t, dur, vol, slideTo) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(bus, t, dur, vol, type, f0, f1) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f0, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    flt.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.02);
  }

  function schedule() {
    const ahead = ctx.currentTime + 0.15;
    while (nextTime < ahead) {
      const ev = EVENTS[step];
      const at = nextTime;
      if (ev.type === 'mel') { tone(musicBus, 'square', freq(ev.m), at, ev.d * BEAT * 0.9, 0.16); tone(musicBus, 'square', freq(ev.m + 12), at, 0.05, 0.03); }
      else if (ev.type === 'bass') tone(musicBus, 'triangle', freq(ev.m), at, ev.d * BEAT, 0.35);
      else noise(musicBus, at, ev.acc ? 0.09 : 0.05, ev.acc ? 0.22 : 0.12, 'highpass', 7500);
      step++;
      const nt = step < EVENTS.length ? EVENTS[step].t : EVENTS.total;
      if (step >= EVENTS.length) step = 0;
      const dt = (step === 0 ? nt - ev.t : EVENTS[step].t - ev.t);
      nextTime += Math.max(0, dt) * BEAT;
    }
  }

  function startMusic() {
    if (!ctx || timer || !musicOn) return;
    nextTime = ctx.currentTime + 0.1;
    step = 0;
    timer = setInterval(schedule, 40);
  }
  function stopMusic() { clearInterval(timer); timer = null; }

  const SFX = {
    jump: (t) => tone(sfxBus, 'square', 420, t, 0.12, 0.12, 820),
    djump: (t) => { tone(sfxBus, 'square', 620, t, 0.1, 0.1, 1300); tone(sfxBus, 'triangle', 900, t + 0.04, 0.1, 0.1, 1600); },
    gift: (t) => [784, 1047, 1319].forEach((f, i) => tone(sfxBus, 'triangle', f, t + i * 0.05, 0.12, 0.18)),
    correct: (t) => [1047, 1319, 1568, 2093].forEach((f, i) => tone(sfxBus, 'square', f, t + i * 0.07, 0.14, 0.11)),
    wrong: (t) => tone(sfxBus, 'sawtooth', 300, t, 0.3, 0.12, 120),
    whoosh: (t) => noise(sfxBus, t, 0.9, 0.5, 'bandpass', 2400, 250),
    summit: (t) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(sfxBus, 'square', f, t + i * 0.1, 0.18, 0.12)),
    beep: (t) => tone(sfxBus, 'square', 880, t, 0.12, 0.12),
    go: (t) => tone(sfxBus, 'square', 1320, t, 0.35, 0.14),
    boing: (t) => { tone(sfxBus, 'triangle', 180, t, 0.35, 0.3, 720); tone(sfxBus, 'square', 360, t + 0.02, 0.18, 0.06, 1100); },
    land: (t) => noise(sfxBus, t, 0.08, 0.15, 'lowpass', 900),
    pop: (t) => tone(sfxBus, 'triangle', 660, t, 0.08, 0.15, 990),
  };

  root.AUDIO = {
    unlock() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); startMusic(); },
    sfx(name) { if (ctx && SFX[name]) SFX[name](ctx.currentTime + 0.005); },
    toggleMusic() { musicOn = !musicOn; if (musicOn) startMusic(); else stopMusic(); return musicOn; },
    get musicOn() { return musicOn; },
  };
})(typeof self !== 'undefined' ? self : this);
