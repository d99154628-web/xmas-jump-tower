/*
 * audio.js — Web Audio 로 직접 연주하는 8비트 음악·효과음.
 * 배경음악: 저작권이 끝난(퍼블릭 도메인) 크리스마스 캐럴 5곡을 칩튠으로 편곡해 번갈아 연주.
 *  Jingle Bells(1857) · We Wish You a Merry Christmas(영국 전래) · Deck the Halls(웨일스 전래)
 *  Joy to the World(1719/1839) · Good King Wenceslas(1853)
 * 녹음 파일이 아니라 코드로 연주하므로 음원 저작권 문제가 없고, 다운로드 용량도 0.
 */
(function (root) {
  'use strict';
  let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
  let musicOn = true, timer = null, nextTime = 0, step = 0, songIdx = 0, playlist = [];

  const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const midi = (n) => { if (n === 'R') return null; const m = n.match(/^([A-G]#?)(\d)$/); return 12 * (Number(m[2]) + 1) + NOTE[m[1]]; };
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const parse = (s) => s.split(',').map((t) => { const [n, d] = t.trim().split(/\s+/); return [midi(n), Number(d)]; });
  const ROOT = { C: 48, D: 50, E: 52, F: 53, G: 43, A: 45, B: 47 };

  // [이름, 빠르기, 한 마디 박 수, 멜로디("음 박자"), 마디마다 화음 근음]
  const SONGS = [
    ['Jingle Bells', 152, 4,
      'G4 1,E5 1,D5 1,C5 1,G4 3,G4 .5,G4 .5,G4 1,E5 1,D5 1,C5 1,A4 4,A4 1,F5 1,E5 1,D5 1,B4 4,G5 1,G5 1,F5 1,D5 1,E5 4,' +
      'G4 1,E5 1,D5 1,C5 1,G4 4,G4 1,E5 1,D5 1,C5 1,A4 3,A4 1,A4 1,F5 1,E5 1,D5 1,G5 1,G5 1,G5 1,G5 1,A5 1,G5 1,F5 1,D5 1,C5 2,G5 2,' +
      'E5 1,E5 1,E5 2,E5 1,E5 1,E5 2,E5 1,G5 1,C5 1.5,D5 .5,E5 4,F5 1,F5 1,F5 1.5,F5 .5,F5 1,E5 1,E5 1,E5 .5,E5 .5,E5 1,D5 1,D5 1,E5 1,D5 2,G5 2,' +
      'E5 1,E5 1,E5 2,E5 1,E5 1,E5 2,E5 1,G5 1,C5 1.5,D5 .5,E5 4,F5 1,F5 1,F5 1.5,F5 .5,F5 1,E5 1,E5 1,E5 .5,E5 .5,G5 1,G5 1,F5 1,D5 1,C5 4',
      'C C C F F G G C C C C F F G G G C C C C F C D G C C C C F C G C'],
    ['We Wish You a Merry Christmas', 168, 3,
      'R 2,D5 1,G5 1,G5 .5,A5 .5,G5 .5,F#5 .5,E5 1,E5 1,E5 1,A5 1,A5 .5,B5 .5,A5 .5,G5 .5,F#5 1,D5 1,D5 1,' +
      'B5 1,B5 .5,C6 .5,B5 .5,A5 .5,G5 1,E5 1,D5 .5,D5 .5,E5 1,A5 1,F#5 1,G5 2,D5 1,' +
      'G5 1,G5 1,G5 1,F#5 2,F#5 1,G5 1,F#5 1,E5 1,D5 2,A5 1,B5 1,A5 1,G5 1,D6 1,D5 1,D5 .5,D5 .5,E5 1,A5 1,F#5 1,G5 3',
      'G G C A D B C D G G D D D G G D G'],
    ['Deck the Halls', 138, 4,
      'G5 1.5,F5 .5,E5 1,D5 1,C5 1,D5 1,E5 1,C5 1,D5 .5,E5 .5,F5 .5,D5 .5,E5 1.5,D5 .5,C5 1,B4 1,C5 2,' +
      'G5 1.5,F5 .5,E5 1,D5 1,C5 1,D5 1,E5 1,C5 1,D5 .5,E5 .5,F5 .5,D5 .5,E5 1.5,D5 .5,C5 1,B4 1,C5 2,' +
      'D5 1.5,E5 .5,F5 1,D5 1,E5 1.5,F5 .5,G5 1,D5 1,E5 .5,F#5 .5,G5 1,A5 .5,B5 .5,C6 1,B5 1,A5 1,G5 2,' +
      'G5 1.5,F5 .5,E5 1,D5 1,C5 1,D5 1,E5 1,C5 1,A5 .5,A5 .5,A5 .5,A5 .5,G5 1.5,F5 .5,E5 1,D5 1,C5 2',
      'C C G C C C G C G C D G C C F C'],
    ['Joy to the World', 132, 4,
      'C6 1,B5 .75,A5 .25,G5 1.5,F5 .5,E5 1,D5 1,C5 1.5,G5 .5,A5 1.5,A5 .5,B5 1.5,B5 .5,C6 3.5,C6 .5,' +
      'C6 .5,B5 .5,A5 .5,G5 .5,G5 .75,F5 .25,E5 .5,C6 .5,C6 .5,B5 .5,A5 .5,G5 .5,G5 .75,F5 .25,E5 .5,E5 .5,' +
      'E5 .5,E5 .5,E5 .5,E5 .5,E5 .25,F5 .25,G5 1.5,F5 .25,E5 .25,D5 .5,D5 .5,D5 .5,D5 .25,E5 .25,F5 1.5,' +
      'E5 .25,D5 .25,C5 .5,C6 .5,A5 .5,G5 .75,F5 .25,E5 .5,F5 .5,E5 1,D5 1,C5 2',
      'C C F C C C C G F C'],
    ['Good King Wenceslas', 150, 4,
      'G5 1,G5 1,G5 1,A5 1,G5 1,G5 1,D5 2,E5 1,D5 1,E5 1,F#5 1,G5 2,G5 2,' +
      'G5 1,G5 1,G5 1,A5 1,G5 1,G5 1,D5 2,E5 1,D5 1,E5 1,F#5 1,G5 2,G5 2,' +
      'D6 1,C6 1,B5 1,A5 1,B5 1,A5 1,G5 2,E5 1,D5 1,E5 1,F#5 1,G5 2,G5 2,' +
      'D5 1,D5 1,E5 1,F#5 1,G5 1,G5 1,A5 2,D6 1,C6 1,B5 1,A5 1,G5 2,C6 2,G5 4',
      'G G C G G G C G D G C G D D D C G'],
  ];

  // 곡마다 멜로디·베이스·방울 소리를 시간순 이벤트로 펼친다
  const BUILT = SONGS.map(([name, bpm, meter, mel, chords]) => {
    const notes = parse(mel);
    const len = notes.reduce((a, [, d]) => a + d, 0);
    const bars = Math.ceil(len / meter);
    const reps = (len * 60) / bpm < 35 ? 2 : 1;      // 짧은 곡은 두 번 연주
    const ch = chords.split(' ');
    const ev = [];
    for (let rep = 0; rep < reps; rep++) {
      const off = rep * bars * meter;
      let t = off;
      for (const [m, d] of notes) { if (m != null) ev.push({ t, type: 'mel', m, d }); t += d; }
      for (let bar = 0; bar < bars; bar++) {
        const r = ROOT[ch[Math.min(bar, ch.length - 1)]];
        for (let b = 0; b < meter; b++) ev.push({ t: off + bar * meter + b, type: 'bass', m: b === 0 || (meter === 4 && b === 2) ? r : r + 7, d: 0.45 });
        for (let h = 0; h < meter * 2; h++) ev.push({ t: off + bar * meter + h * 0.5, type: 'bell', acc: h % 2 === 1 });
      }
    }
    ev.sort((a, b) => a.t - b.t);
    return { name, beat: 60 / bpm, ev, total: reps * bars * meter + 1 };   // 곡 사이 1박 쉼
  });

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

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function nextSong() {
    if (!playlist.length) playlist = shuffle(BUILT.map((_, i) => i).filter((i) => i !== songIdx));
    songIdx = playlist.shift();
    step = 0;
    if (root.AUDIO && root.AUDIO.onSong) root.AUDIO.onSong(BUILT[songIdx].name);
  }

  function schedule() {
    const ahead = ctx.currentTime + 0.15;
    while (nextTime < ahead) {
      const song = BUILT[songIdx], EV = song.ev, BEAT = song.beat;
      const ev = EV[step];
      const at = nextTime;
      if (ev.type === 'mel') { tone(musicBus, 'square', freq(ev.m), at, ev.d * BEAT * 0.9, 0.16); tone(musicBus, 'square', freq(ev.m + 12), at, 0.05, 0.03); }
      else if (ev.type === 'bass') tone(musicBus, 'triangle', freq(ev.m), at, ev.d * BEAT, 0.35);
      else noise(musicBus, at, ev.acc ? 0.09 : 0.05, ev.acc ? 0.22 : 0.12, 'highpass', 7500);
      step++;
      if (step < EV.length) nextTime += Math.max(0, EV[step].t - ev.t) * BEAT;
      else { nextTime += Math.max(0, song.total - ev.t) * BEAT; nextSong(); }   // 곡이 끝나면 다음 캐럴
    }
  }

  function startMusic() {
    if (!ctx || timer || !musicOn) return;
    nextTime = ctx.currentTime + 0.1;
    if (step === 0 && !playlist.length && songIdx === 0) { songIdx = Math.floor(Math.random() * BUILT.length); if (root.AUDIO && root.AUDIO.onSong) root.AUDIO.onSong(BUILT[songIdx].name); }
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
    fall: (t) => { tone(sfxBus, 'square', 1400, t, 1.4, 0.1, 120); noise(sfxBus, t, 1.4, 0.35, 'bandpass', 3000, 300); },
    thud: (t) => { tone(sfxBus, 'sine', 120, t, 0.45, 0.6, 40); noise(sfxBus, t, 0.3, 0.5, 'lowpass', 600); },
    heal: (t) => [880, 1175, 1568, 2093].forEach((f, i) => tone(sfxBus, 'triangle', f, t + i * 0.06, 0.2, 0.12)),
        pop: (t) => tone(sfxBus, 'triangle', 660, t, 0.08, 0.15, 990),
  };

  root.AUDIO = {
    unlock() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); startMusic(); },
    sfx(name) { if (ctx && SFX[name]) SFX[name](ctx.currentTime + 0.005); },
    toggleMusic() { musicOn = !musicOn; if (musicOn) startMusic(); else stopMusic(); return musicOn; },
    skip() { if (!ctx) return; stopMusic(); nextSong(); musicOn = true; startMusic(); },
    songs: SONGS.map((x) => x[0]),
    onSong: null,
    get musicOn() { return musicOn; },
  };
})(typeof self !== 'undefined' ? self : this);
