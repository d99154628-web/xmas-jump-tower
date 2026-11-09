/*
 * pixelart.js — 모든 그래픽을 코드로 그리는 도트(픽셀) 아트 생성기 (v2: 디테일 강화)
 *  - 캐릭터: 24x28, 4단계 음영 + 색 외곽선(셀아웃), 8프레임(대기2·달리기4·점프·낙하)
 *  - 발판: 구역별 질감 + 위쪽 장식(풀·산호·전구 등), 같은 폭도 3가지 변형
 *  - 배경: 480x900(2배 확대), 구역별 소품과 이어지는 하늘색
 * 이미지 파일이 없어서 로딩이 빠르고 저작권 걱정이 없다.
 */
(function (root) {
  'use strict';
  const S = root.SHARED;

  const FW = 24, FH = 28, FRAMES_N = 8;
  const hexToRgb = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const rgbToHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const shadeHex = (h, f) => { const c = hexToRgb(h); return f >= 1 ? rgbToHex(c.map((v) => v + (255 - v) * (f - 1))) : rgbToHex(c.map((v) => v * f)); };
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const rgbCache = new Map();
  const rgbOf = (h) => { let v = rgbCache.get(h); if (!v) { v = hexToRgb(h); rgbCache.set(h, v); } return v; };

  /* ---------- 스프라이트용 픽셀 버퍼 ---------- */
  function Buf(w, h) {
    const px = new Array(w * h).fill(null);
    const b = {
      w, h, px,
      get(x, y) { return x < 0 || y < 0 || x >= w || y >= h ? null : px[y * w + x]; },
      set(x, y, c) { x = Math.floor(x); y = Math.floor(y); if (!c || x < 0 || y < 0 || x >= w || y >= h) return; px[y * w + x] = c; },
      ellipse(cx, cy, rx, ry, col) {
        for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry); y++) {
          for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx); x++) {
            const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
            if (nx * nx + ny * ny <= 1) b.set(x, y, typeof col === 'function' ? col(nx, ny, x, y) : col);
          }
        }
      },
      line(x0, y0, x1, y1, col, thick = 1) {
        const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
          for (let t = 0; t < thick; t++) b.set(x + t, y, col);
        }
      },
      // 가장자리 픽셀을 자기 색의 어두운 버전으로 → 부드러운 색 외곽선
      outline(f = 0.5) {
        const copy = px.slice();
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const c = copy[y * w + x];
          if (!c) continue;
          const empty = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h || !copy[yy * w + xx];
          if (empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1)) px[y * w + x] = shadeHex(c, f);
        }
      },
      paint(g, ox = 0, oy = 0) {
        const id = g.createImageData(w, h);
        for (let i = 0; i < px.length; i++) {
          const c = px[i];
          if (!c) continue;
          const [r, gg, bb] = rgbOf(c);
          id.data[i * 4] = r; id.data[i * 4 + 1] = gg; id.data[i * 4 + 2] = bb; id.data[i * 4 + 3] = 255;
        }
        g.putImageData(id, ox, oy);
      },
    };
    return b;
  }
  function bufCanvas(b) { const c = makeCanvas(b.w, b.h); b.paint(c.getContext('2d')); return c; }

  /* ================= 캐릭터 ================= */
  const BODY = [
    ['#f4a259', '#fff1d6'], ['#f2d7a7', '#fffaf0'], ['#a8a8b8', '#ececf4'], ['#a0673c', '#f0d2b0'], ['#e4e4ec', '#ffffff'],
    ['#f7a1c4', '#ffe3ef'], ['#7fd8be', '#e2fff6'], ['#7ab8f5', '#e3f1ff'], ['#f5d94e', '#fff8d1'], ['#b79cf0', '#efe7ff'],
  ];
  const ACC = ['santa', 'antler', 'scarf'];
  const ACC_NAME = { santa: '산타 모자', antler: '루돌프', scarf: '목도리' };
  const skinInfo = (i) => ({ pal: BODY[i % 10], acc: ACC[Math.floor(i / 10) % 3] });

  function bodyPal(i) {
    const [b, l] = BODY[i % 10];
    return { hi: shadeHex(b, 1.25), base: b, mid: shadeHex(b, 0.86), lo: shadeHex(b, 0.72), belly: l, bellyLo: shadeHex(l, 0.9), foot: shadeHex(b, 0.62), ear: '#ff9eb5' };
  }
  const shadeFn = (p) => (nx, ny) => { const l = -(nx * 0.6 + ny * 0.8); return l > 0.5 ? p.hi : l > -0.15 ? p.base : l > -0.62 ? p.mid : p.lo; };

  // 0~1 대기(숨쉬기) · 2~5 달리기 · 6 점프(상승) · 7 낙하
  const CF = [
    { by: 0, rx: 9.2, ry: 8.4, feet: [[-3.6, 0], [3.6, 0]], arms: [[0, 0], [0, 0]] },
    { by: 0.7, rx: 9.7, ry: 7.8, feet: [[-3.6, 0], [3.6, 0]], arms: [[0, 0.5], [0, 0.5]] },
    { by: 0, rx: 9.2, ry: 8.4, feet: [[-5.2, 0], [2.6, -1]], arms: [[1, -1.2], [-1, 1]] },
    { by: -1, rx: 9, ry: 8.6, feet: [[-2.2, -1], [2.2, -0.4]], arms: [[0, 0], [0, 0]] },
    { by: 0, rx: 9.2, ry: 8.4, feet: [[-2.6, -1], [5.2, 0]], arms: [[-1, 1], [1, -1.2]] },
    { by: -1, rx: 9, ry: 8.6, feet: [[-2.2, -0.4], [2.2, -1]], arms: [[0, 0], [0, 0]] },
    { by: -1, rx: 8.6, ry: 9.0, feet: [[-3, 0.4], [3, 0.4]], arms: [[-0.5, -5.5], [0.5, -5.5]] },
    { by: -1, rx: 9.5, ry: 8.3, feet: [[-4.6, -0.8], [4.6, -0.8]], arms: [[-2, -3], [2, -3]] },
  ];

  function drawSanta(b, cx, cy) {
    const top = cy - 15.2, base = cy - 6.6;
    for (let y = Math.floor(top); y <= base; y++) {
      const t = (y - top) / (base - top);
      const hw = 0.8 + 5.8 * t, mx = cx + 4.6 - 4.6 * t;
      for (let x = Math.floor(mx - hw); x <= Math.ceil(mx + hw); x++) {
        const u = (x + 0.5 - (mx - hw)) / (2 * hw);
        if (u < 0 || u > 1) continue;
        b.set(x, y, u < 0.3 ? '#ff6464' : u < 0.75 ? '#e23a3a' : '#a8232a');
      }
    }
    b.ellipse(cx, cy - 6.3, 7.8, 1.8, (nx, ny) => (ny > 0.25 ? '#d6e6f5' : '#ffffff'));
    b.ellipse(cx + 4.9, top, 1.9, 1.9, (nx, ny) => (nx + ny > 0.6 ? '#d6e6f5' : '#ffffff'));
  }
  function drawAntlers(b, cx, cy) {
    const col = '#8a5a2b', hi = '#b47c46';
    for (const s of [-1, 1]) {
      b.line(cx + s * 5, cy - 6.5, cx + s * 7.5, cy - 13.5, col, 2);
      b.line(cx + s * 6.4, cy - 10.4, cx + s * 9.6, cy - 12, col);
      b.line(cx + s * 7.2, cy - 12.2, cx + s * 5.4, cy - 14.8, hi);
    }
  }
  function drawScarf(b, cx, cy) {
    const y0 = Math.round(cy + 3.4), y1 = Math.round(cy + 5.6);
    for (let y = y0; y <= y1; y++) for (let x = 0; x < b.w; x++) {
      if (!b.get(x, y)) continue;
      const red = ((x + y) >> 1) % 2 === 0;
      b.set(x, y, y === y1 ? (red ? '#a8232a' : '#1f6e37') : (red ? '#e23a3a' : '#2e9e4f'));
    }
    for (let y = y1; y <= Math.round(cy + 10.5); y++) for (let x = Math.round(cx + 3); x <= Math.round(cx + 5); x++) {
      const last = y === Math.round(cy + 10.5);
      if (last && x % 2) continue;
      b.set(x, y, (y >> 1) % 2 ? '#e23a3a' : '#2e9e4f');
    }
  }

  function drawChar(skin, f) {
    const p = bodyPal(skin), acc = skinInfo(skin).acc, F = CF[f];
    const b = Buf(FW, FH);
    const cx = 12, cy = 15.6 + F.by;
    const sh = shadeFn(p);
    if (acc === 'antler') drawAntlers(b, cx, cy);
    for (const s of [-1, 1]) b.ellipse(cx + s * 6, cy - 6.8, 2.7, 2.7, sh);
    for (const [fx, fy] of F.feet) b.ellipse(cx + fx, 25.6 + fy, 2.5, 1.5, (nx, ny) => (ny < -0.3 ? p.mid : p.foot));
    b.ellipse(cx, cy, F.rx, F.ry, sh);
    for (const s of [-1, 1]) b.ellipse(cx + s * 6, cy - 7.2, 1.3, 1.3, p.ear);
    b.ellipse(cx, cy + 3.3, 5.6, 4.4, (nx, ny) => (ny > 0.45 || nx > 0.6 ? p.bellyLo : p.belly));
    for (const s of [-1, 1]) b.ellipse(cx + s * 5.9, cy + 1.4, 1.7, 1.05, '#ff8fa8');
    [-1, 1].forEach((s, i) => { const [ax, ay] = F.arms[i]; b.ellipse(cx + s * 7.9 + ax, cy + 3.4 + ay, 1.8, 1.5, (nx, ny) => (ny < 0 ? p.base : p.mid)); });
    if (acc === 'santa') drawSanta(b, cx, cy);
    if (acc === 'scarf') drawScarf(b, cx, cy);
    b.outline(0.5);
    // 얼굴은 외곽선 뒤에(어두워지지 않게)
    const ey = Math.round(cy - 2.6);
    for (const [c0, c1] of [[8, 9], [14, 15]]) {
      for (let y = ey; y < ey + 3; y++) { b.set(c0, y, '#1d1428'); b.set(c1, y, '#1d1428'); }
      b.set(c0, ey, '#ffffff');
    }
    const ny = Math.round(cy + 0.4);
    if (acc === 'antler') { b.set(11, ny - 1, '#ff3030'); b.set(12, ny - 1, '#ff3030'); b.set(11, ny, '#d81e1e'); b.set(12, ny, '#ff3030'); b.set(11, ny - 1, '#ffb0b0'); }
    else { b.set(11, ny, '#ff6f91'); b.set(12, ny, '#ff6f91'); }
    b.set(10, ny + 1, '#7a4050'); b.set(13, ny + 1, '#7a4050'); b.set(11, ny + 2, '#7a4050'); b.set(12, ny + 2, '#7a4050');
    b.set(cx - 5, Math.round(cy - 5), shadeHex(p.hi, 1.5)); b.set(cx - 4, Math.round(cy - 6), shadeHex(p.hi, 1.5));
    return b;
  }

  function makeCharSheet(skin) {
    const c = makeCanvas(FW * FRAMES_N, FH);
    const g = c.getContext('2d');
    for (let f = 0; f < FRAMES_N; f++) drawChar(skin, f).paint(g, f * FW, 0);
    return c;
  }
  const sheetCache = new Map();
  function charSheet(skin) { if (!sheetCache.has(skin)) sheetCache.set(skin, makeCharSheet(skin)); return sheetCache.get(skin); }
  function drawCharPreview(canvas, skin, scale = 3, frame = 0) {
    canvas.width = FW * scale; canvas.height = FH * scale;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(charSheet(skin), frame * FW, 0, FW, FH, 0, 0, FW * scale, FH * scale);
  }

  /* ================= 소품 ================= */
  function makeGift() {
    const b = Buf(18, 18);
    const red = (x) => (x < 5 ? '#ff6060' : x < 12 ? '#e23a3a' : '#a8232a');
    for (let y = 7; y <= 16; y++) for (let x = 2; x <= 15; x++) b.set(x, y, y === 16 ? '#8e1d1d' : red(x));
    for (let y = 4; y <= 6; y++) for (let x = 1; x <= 16; x++) b.set(x, y, y === 4 ? '#ff7a7a' : red(x));
    for (let y = 4; y <= 16; y++) { b.set(8, y, '#fff1a8'); b.set(9, y, '#ffd23f'); }
    for (let x = 1; x <= 16; x++) b.set(x, 5, x < 8 ? '#fff1a8' : '#ffd23f');
    b.ellipse(6.3, 2.4, 2.6, 1.9, (nx) => (nx < 0 ? '#fff1a8' : '#ffd23f'));
    b.ellipse(11.7, 2.4, 2.6, 1.9, (nx) => (nx < 0 ? '#fff1a8' : '#d4a017'));
    b.outline(0.55);
    b.set(4, 8, '#ffffff'); b.set(5, 9, '#ffb0b0'); b.set(9, 3, '#ffffff');
    return bufCanvas(b);
  }

  function makeTree() {
    const W = 32, H = 50;
    const b = Buf(W, H);
    const rnd = S.mulberry32(77);
    b.ellipse(16, 46, 4, 3.4, (nx) => (nx < -0.2 ? '#8b5a2b' : nx < 0.4 ? '#6b3e1e' : '#4a2a12'));
    const tiers = [[7, 16, 2, 7], [13, 24, 4, 10], [20, 33, 6, 13], [28, 43, 8, 15.5]];
    for (const [y0, y1, w0, w1] of tiers) {
      for (let y = y0; y <= y1; y++) {
        const t = (y - y0) / (y1 - y0), hw = w0 + (w1 - w0) * t;
        for (let x = Math.floor(16 - hw); x < Math.ceil(16 + hw); x++) {
          const u = (x + 0.5 - (16 - hw)) / (2 * hw);
          const edge = y >= y1 - 1 && ((x + y) % 3 !== 0);
          b.set(x, y, edge ? '#ffffff' : u < 0.28 ? '#36b35c' : u < 0.7 ? '#1f8a40' : '#14632d');
        }
      }
    }
    for (let i = 0; i < 26; i++) {           // 반짝이 갈런드
      const t = i / 26, y = 10 + t * 32, x = 16 + Math.sin(t * 14) * (3 + t * 10);
      if (b.get(Math.floor(x), Math.floor(y))) b.set(x, y, i % 2 ? '#ffd23f' : '#fff1a8');
    }
    const orn = ['#ff3b3b', '#4dc3ff', '#ffd23f', '#ff7bd5', '#b388ff'];
    for (let i = 0; i < 18; i++) {
      const y = 10 + Math.floor(rnd() * 32), x = 6 + Math.floor(rnd() * 20);
      if (b.get(x, y) && b.get(x + 1, y + 1)) { b.ellipse(x + 1, y + 1, 1.3, 1.3, orn[i % 5]); b.set(x, y, '#ffffff'); }
    }
    b.outline(0.6);
    // 별(외곽선 뒤)
    b.ellipse(16, 4, 2.2, 2.2, '#ffd23f');
    b.line(16, 0, 16, 8, '#ffd23f'); b.line(12, 4, 20, 4, '#ffd23f');
    b.set(15, 3, '#ffffff'); b.set(16, 4, '#fff6c8');
    return bufCanvas(b);
  }

  // 스프링: 0 = 늘어남, 1 = 눌림
  function makeSpring() {
    const c = makeCanvas(32, 14); const g = c.getContext('2d');
    [[0, 0], [1, 6]].forEach(([f, press]) => {
      const b = Buf(16, 14);
      for (let x = 2; x <= 13; x++) { b.set(x, 12, '#3b4256'); b.set(x, 13, '#262a3a'); }
      const top = 3 + press;
      const coilRows = 11 - top;
      for (let i = 0; i < coilRows; i++) {
        const y = 11 - i; const k = i % 2;
        for (let x = 4; x <= 11; x++) b.set(x, y, k ? (x < 6 ? '#e8edf6' : '#aab3c6') : (x > 9 ? '#6d768c' : '#8d97ad'));
      }
      for (let x = 1; x <= 14; x++) for (let y = top - 2; y <= top; y++) b.set(x, y, y === top - 2 ? '#ff7a7a' : x < 4 ? '#ff6060' : '#e23a3a');
      b.outline(0.55);
      b.set(3, top - 2, '#ffffff');
      b.paint(g, f * 16, 0);
    });
    return c;
  }

  function makeFish(col) {
    const b = Buf(12, 7);
    b.ellipse(6.5, 3.5, 4.6, 2.8, (nx, ny) => (ny < -0.3 ? shadeHex(col, 1.25) : ny > 0.4 ? shadeHex(col, 0.8) : col));
    for (let y = 1; y <= 5; y++) b.set(1, y, col); b.set(0, 1, col); b.set(0, 5, col); b.set(2, 3, col);
    b.outline(0.6);
    b.set(9, 2, '#1d1428'); b.set(9, 1, '#ffffff');
    return bufCanvas(b);
  }
  function makeBird() {
    const c = makeCanvas(18, 6); const g = c.getContext('2d');
    const wings = [['X.......X', '.X.....X.', '..XX.XX..', '....X....'], ['.........', 'XXX...XXX', '...XXX...', '....X....']];
    wings.forEach((rows, f) => rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') { g.fillStyle = '#2b2236'; g.fillRect(f * 9 + x, y + 1, 1, 1); } })));
    return c;
  }
  function makeCloudSprite(seed) {
    const b = Buf(56, 20);
    const rnd = S.mulberry32(seed);
    const col = (nx, ny, x, y) => (y < 7 ? '#ffffff' : y < 11 ? '#f1f7ff' : y < 15 ? '#d9e8f8' : '#c3d6ee');
    for (let i = 0; i < 6; i++) b.ellipse(8 + i * 8 + rnd() * 3, 11 - rnd() * 3, 6 + rnd() * 3, 5 + rnd() * 2, col);
    b.ellipse(28, 14, 24, 4.5, col);
    return bufCanvas(b);
  }

  function makeButterfly(c1) {
    const c = makeCanvas(18, 7); const g = c.getContext('2d');
    const frames = [['XX.B.XX', 'XXXBXXX', '.XXBXX.', '.X.B.X.'], ['.......', 'XXXBXXX', 'XXXBXXX', '...B...']];
    frames.forEach((rows, f) => rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '.') return; g.fillStyle = ch === 'B' ? '#2b2236' : (x + y) % 3 ? c1 : '#ffffff'; g.fillRect(f * 9 + x + 1, y + 1, 1, 1); })));
    return c;
  }
  function makeBalloon() {   // 오즈 마법사의 열기구
    const b = Buf(16, 24);
    b.ellipse(8, 7.5, 7, 7.5, (nx, ny, x) => { const stripe = Math.floor((nx + 1) * 3.5) % 2; const l = -(nx * 0.6 + ny * 0.8); return stripe ? (l > 0 ? '#7dffb5' : '#2fbf71') : (l > 0 ? '#fff3a0' : '#e0b030'); });
    b.line(3, 14, 6, 19, '#5a3a1a'); b.line(12, 14, 10, 19, '#5a3a1a');
    for (let y = 19; y <= 22; y++) for (let x = 5; x <= 11; x++) b.set(x, y, x < 7 ? '#c08040' : '#8a5a2b');
    b.outline(0.6);
    return bufCanvas(b);
  }
  function makeSleigh() {    // 산타 썰매 + 루돌프
    const b = Buf(44, 14);
    for (let x = 26; x <= 40; x++) for (let y = 4; y <= 9; y++) b.set(x, y, y < 6 ? '#ff5a5a' : '#c62828');
    for (let x = 24; x <= 42; x++) b.set(x, 11, '#ffd23f'); b.set(43, 10, '#ffd23f'); b.set(23, 10, '#ffd23f');
    b.ellipse(33, 3, 3, 2.5, '#e23a3a'); b.set(33, 0, '#ffffff'); b.ellipse(36, 4, 2.4, 2, '#8a5a2b');   // 산타 + 선물 자루
    b.set(32, 3, '#ffd0b0'); b.set(31, 4, '#ffffff'); b.set(32, 5, '#ffffff');
    for (const rx of [3, 13]) {
      for (let x = rx; x <= rx + 7; x++) for (let y = 6; y <= 8; y++) b.set(x, y, '#a0673c');
      b.set(rx + 1, 9, '#6b3e1e'); b.set(rx + 6, 9, '#6b3e1e'); b.set(rx + 1, 10, '#6b3e1e'); b.set(rx + 6, 10, '#6b3e1e');
      b.ellipse(rx, 5, 1.8, 1.6, '#a0673c'); b.set(rx - 2, 5, rx === 3 ? '#ff3030' : '#3a2010'); b.line(rx, 3, rx - 1, 0, '#6b3e1e'); b.line(rx + 1, 3, rx + 3, 1, '#6b3e1e');
      b.line(rx + 8, 7, rx + 10, 7, '#ffd23f');
    }
    b.line(21, 7, 25, 7, '#ffd23f');
    b.outline(0.6);
    return bufCanvas(b);
  }
  function makeGumdrop(c) { const b = Buf(10, 10); b.ellipse(5, 5.5, 4.4, 4.2, (nx, ny) => (nx + ny < -0.6 ? '#ffffff' : nx + ny < 0 ? shadeHex(c, 1.3) : c)); b.outline(0.65); return bufCanvas(b); }

  function makeDot(w, h, painter) { const c = makeCanvas(w, h); painter(c.getContext('2d')); return c; }
  const PARTICLES = {
    p_ember: () => makeDot(2, 2, (g) => { g.fillStyle = '#ffb347'; g.fillRect(0, 0, 2, 2); g.fillStyle = '#fff1a8'; g.fillRect(0, 0, 1, 1); }),
    p_bubble: () => makeDot(5, 5, (g) => { g.fillStyle = '#c8f4ff'; g.fillRect(1, 0, 3, 1); g.fillRect(1, 4, 3, 1); g.fillRect(0, 1, 1, 3); g.fillRect(4, 1, 1, 3); g.fillStyle = '#ffffff'; g.fillRect(1, 1, 1, 1); }),
    p_petal: () => makeDot(3, 2, (g) => { g.fillStyle = '#ffb7c5'; g.fillRect(0, 0, 3, 2); g.fillStyle = '#ff8fab'; g.fillRect(2, 1, 1, 1); }),
    p_leaf: () => makeDot(4, 3, (g) => { g.fillStyle = '#e8762b'; g.fillRect(0, 1, 4, 1); g.fillRect(1, 0, 2, 3); g.fillStyle = '#f2b134'; g.fillRect(1, 1, 1, 1); g.fillStyle = '#a8461c'; g.fillRect(3, 2, 1, 1); }),
    p_snow: () => makeDot(2, 2, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 2, 2); }),
    p_star: () => makeDot(3, 3, (g) => { g.fillStyle = '#fff6a8'; g.fillRect(1, 0, 1, 3); g.fillRect(0, 1, 3, 1); }),
    p_puff: () => makeDot(3, 3, (g) => { g.fillStyle = '#ffffff'; g.fillRect(1, 0, 1, 3); g.fillRect(0, 1, 3, 1); }),
    p_conf: () => makeDot(2, 2, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 2, 2); }),
    p_dust: () => makeDot(2, 2, (g) => { g.fillStyle = '#e8e0d0'; g.fillRect(0, 0, 2, 2); }),
    p_shoot: () => makeDot(10, 2, (g) => { for (let x = 0; x < 10; x++) { g.fillStyle = `rgba(255,250,220,${(x + 1) / 10})`; g.fillRect(x, 0, 1, 2); } }),
  };

  /* ================= 발판 (폭 w x 24, 윗면 y=8, 위 8줄은 장식) ================= */
  const PLAT_H = 24, SURF = 8;
  function makePlatform(theme, w, variant = 0) {
    const zone = S.THEME_KEYS.indexOf(theme);
    const b = Buf(w, PLAT_H);
    const rnd = S.mulberry32(zone * 7919 + w * 31 + variant * 104729);
    const r = (a, c) => a + rnd() * (c - a);
    const inset = (y) => (y === 8 ? 2 : y === 9 ? 1 : y >= 21 ? y - 20 : 0);
    const inside = (x, y) => y >= SURF && x >= inset(y) && x < w - inset(y);
    const fillBody = (fn) => { for (let y = SURF; y < PLAT_H; y++) for (let x = 0; x < w; x++) if (inside(x, y)) b.set(x, y, fn(x, y)); };

    if (theme === 'magma') {     // 마그마: 현무암 벽돌 + 빛나는 균열 + 용암 방울
      fillBody((x, y) => (y === 8 ? '#9a6e60' : y === 9 ? '#7a5448' : '#4a3434'));
      for (const [y0, y1] of [[10, 15], [16, 22]]) {
        let x = Math.floor(r(-6, 0));
        while (x < w) {
          const sw = Math.floor(r(9, 20));
          for (let y = y0; y <= y1; y++) for (let xx = x; xx < x + sw; xx++) {
            if (!inside(xx, y)) continue;
            const edgeL = xx === x, edgeT = y === y0, edgeB = y === y1;
            let c = edgeT ? '#6a4a43' : edgeB ? '#352428' : edgeL ? '#5a3e3a' : (rnd() < 0.08 ? '#3a2828' : '#4d3636');
            if (xx === x + sw - 1) c = '#241717';
            b.set(xx, y, c);
          }
          if (rnd() < 0.45) for (let y = y0; y <= y1; y++) if (inside(x + sw - 1, y)) { b.set(x + sw - 1, y, y % 3 ? '#ff8a1f' : '#ffd23f'); if (inside(x + sw - 2, y)) b.set(x + sw - 2, y, '#a8461c'); }
          x += sw;
        }
      }
      for (let k = 0; k < Math.max(1, w / 40); k++) { const x = Math.floor(r(4, w - 4)); for (let y = 20; y < 24; y++) b.set(x, y, y === 23 ? '#ffd23f' : '#ff7a1a'); }
      for (let k = 0; k < Math.max(1, w / 50); k++) {
        const x = Math.floor(r(4, w - 5));
        b.set(x, 7, '#ff9a3c'); b.set(x + 1, 7, '#c2410c'); b.set(x - 1, 7, '#ffd27a'); b.set(x, 6, '#ffd27a'); b.set(x, 5, '#ff9a3c'); b.set(x + 1, 6, '#ff9a3c');
      }
    } else if (theme === 'water') { // 바닷속(봄): 모래 + 바위 층 + 산호·미역·불가사리
      fillBody((x, y) => {
        if (y === 8) return '#fff0c8';
        if (y <= 10) return (x + y * 2) % 7 === 0 ? '#e8c088' : '#f5d6a0';
        if (y === 14 + Math.round(Math.sin(x / 6))) return '#b07a48';
        if (y === 19 + Math.round(Math.sin(x / 9 + 2))) return '#9c6a3e';
        return y > 20 ? '#a8754a' : '#c98f5a';
      });
      for (let k = 0; k < w / 18; k++) b.ellipse(r(4, w - 4), r(13, 20), r(1.2, 2.2), r(1, 1.6), (nx, ny) => (ny < 0 ? '#6e4426' : '#8a5a34'));
      for (let k = 0; k < w / 22; k++) { const x = r(3, w - 3); b.ellipse(x, 11.5, 2, 1, '#ff8fab'); b.set(x, 11, '#ffc2d1'); }
      for (let x = 3; x < w - 3; x += Math.floor(r(9, 20))) {
        const kind = rnd();
        if (kind < 0.45) { const h = Math.floor(r(3, 7)); for (let i = 0; i < h; i++) { const xx = x + ((i >> 1) % 2); b.set(xx, 7 - i, i > h - 2 ? '#5fe0a0' : '#2fb36f'); b.set(xx + 1, 7 - i, '#1f8f5f'); } }
        else if (kind < 0.75) { b.line(x, 7, x, 4, '#ff6f91'); b.line(x, 5, x - 2, 3, '#ff8fab'); b.line(x, 5, x + 2, 2, '#ff8fab'); b.set(x - 2, 2, '#ffc2d1'); b.set(x + 2, 1, '#ffc2d1'); }
        else { b.set(x, 7, '#ff9a3c'); b.set(x - 1, 7, '#ff9a3c'); b.set(x + 1, 7, '#ff9a3c'); b.set(x, 6, '#ff9a3c'); b.set(x - 1, 8, '#e8762b'); b.set(x + 1, 8, '#e8762b'); b.set(x, 7, '#ffd27a'); }
      }
    } else if (theme === 'ground') { // 땅(가을): 풀 + 흙 + 돌·뿌리 + 버섯·호박
      fillBody((x, y) => {
        if (y <= 11) {
          const leaf = rnd();
          if (y <= 10 && leaf < 0.16) return ['#e8762b', '#f2b134', '#d94f2b'][Math.floor(rnd() * 3)];
          return ['#a8d356', '#86b83a', '#6f9a2e', '#557a22'][y - 8];
        }
        const t = (y - 12) / 11;
        return rgbToHex(mixRgb(rgbOf('#9a6634'), rgbOf('#5e3a1c'), t).map(Math.round));
      });
      for (let x = 1; x < w - 1; x++) if (rnd() < 0.3 && inside(x, 12)) b.set(x, 12, '#557a22');
      for (let k = 0; k < w / 14; k++) { const x = r(3, w - 3), y = r(14, 21); b.ellipse(x, y, 1.6, 1.2, (nx, ny) => (ny < 0 && nx < 0.3 ? '#cfc2b0' : '#9a8a7a')); }
      for (let k = 0; k < w / 40; k++) { let x = r(4, w - 4); for (let y = 13; y < 21; y++) { x += Math.floor(r(-1, 2)); if (inside(Math.floor(x), y)) b.set(x, y, '#4a2c12'); } }
      for (let x = 2; x < w - 2; x++) {
        const k = rnd();
        if (k < 0.18) { const h = 1 + Math.floor(rnd() * 3); const c = rnd() < 0.3 ? '#e8a33d' : '#86b83a'; for (let i = 0; i < h; i++) b.set(x, 7 - i, c); }
        else if (k < 0.2 && x < w - 5) { b.set(x + 1, 7, '#f3e6d0'); b.set(x + 1, 6, '#f3e6d0'); for (let xx = x; xx <= x + 2; xx++) b.set(xx, 5, '#e23a3a'); b.set(x + 1, 4, '#e23a3a'); b.set(x, 5, '#ff6060'); b.set(x + 1, 5, '#ffffff'); x += 4; }
        else if (k < 0.215 && x < w - 6) { for (let xx = x; xx <= x + 4; xx++) for (let y = 5; y <= 7; y++) b.set(xx, y, xx === x ? '#ffad4d' : (xx === x + 2 ? '#d9701c' : '#f08a24')); b.set(x + 2, 4, '#5f7d1e'); x += 6; }
      }
    } else if (theme === 'sky') {  // 하늘(겨울): 음영 있는 눈 구름 + 고드름
      const col = (y) => (y <= 9 ? '#ffffff' : y < 13 ? '#f4f9ff' : y < 16 ? '#dceaf9' : y < 19 ? '#c3d8f1' : '#a9c3e6');
      for (let x = 3; x < w + 6; x += Math.floor(r(6, 10))) b.ellipse(Math.min(x, w - 4), 13.5, r(4.5, 6.5), 5.6, (nx, ny, xx, y) => col(y));
      for (let y = 12; y <= 19; y++) for (let x = 2; x < w - 2; x++) b.set(x, y, col(y));
      for (let x = 4; x < w - 4; x++) if (rnd() < 0.5) b.set(x, 20, '#a9c3e6');
      for (let k = 0; k < w / 10; k++) b.set(r(3, w - 3), r(9, 14), '#e6f4ff');
      for (let k = 0; k < w / 26; k++) { const x = Math.floor(r(5, w - 5)); const h = Math.floor(r(2, 4)); for (let i = 0; i < h; i++) b.set(x, 20 + i, i === h - 1 ? '#e6f6ff' : '#bfe4ff'); }
      for (let k = 0; k < w / 30; k++) { const x = r(4, w - 4); b.set(x, 8, '#ffffff'); b.set(x + 1, 7, '#ffffff'); }
    } else if (theme === 'flower') {   // 꽃나라: 이끼 흙 + 데이지·튤립
      fillBody((x, y) => {
        if (y === 8) return '#b6f07a';
        if (y <= 10) return (x * 3 + y) % 11 === 0 ? '#5fbf3a' : '#7fd65a';
        if (y === 11) return '#5fae3a';
        const t = (y - 12) / 11;
        if ((x * 7 + y * 13) % 29 === 0) return '#ffc2d8';
        return rgbToHex(mixRgb(rgbOf('#d9b88a'), rgbOf('#a8825a'), t).map(Math.round));
      });
      for (let k = 0; k < w / 16; k++) b.ellipse(r(4, w - 4), r(14, 21), 1.4, 1, (nx, ny) => (ny < 0 ? '#f0d8c0' : '#c9a882'));
      for (let x = 3; x < w - 3; x += Math.floor(r(6, 13))) {
        const kind = rnd();
        if (kind < 0.45) { // 데이지
          const c = ['#ffffff', '#ffd6e8', '#fff3a8'][Math.floor(rnd() * 3)];
          b.set(x, 7, '#4caf50'); b.set(x, 6, '#4caf50');
          b.set(x, 4, c); b.set(x - 1, 5, c); b.set(x + 1, 5, c); b.set(x, 3, c); b.set(x - 1, 3, c); b.set(x + 1, 3, c); b.set(x - 1, 4, c); b.set(x + 1, 4, c);
          b.set(x, 4, '#ffb300');
        } else if (kind < 0.75) { // 튤립
          const c = ['#ff4d6d', '#ff8fab', '#ffb347', '#b388ff'][Math.floor(rnd() * 4)];
          b.line(x, 7, x, 4, '#3f9b3a'); b.set(x + 1, 6, '#5fbf3a');
          b.set(x - 1, 3, c); b.set(x, 3, shadeHex(c, 1.3)); b.set(x + 1, 3, c); b.set(x - 1, 2, c); b.set(x + 1, 2, c); b.set(x, 2, shadeHex(c, 0.8));
        } else { b.set(x, 7, '#86d65a'); b.set(x + 1, 6, '#86d65a'); b.set(x - 1, 6, '#5fbf3a'); }
      }
    } else if (theme === 'candy') {    // 과자나라: 초콜릿 바 + 딸기 크림 + 스프링클
      fillBody((x, y) => {
        const sx = x % 16, sy = (y - 8) % 8;
        if (sx === 0 || sy === 7) return '#4a2814';
        if (sx === 1 || sy === 0) return '#a8703f';
        return '#7a4a2a';
      });
      const sprink = ['#ff4d6d', '#4dc3ff', '#ffd23f', '#7dff8a', '#ffffff', '#b388ff'];
      for (let x = 0; x < w; x++) {
        const drip = 10 + (rnd() < 0.18 ? Math.floor(r(1, 4)) : 0) + Math.round(Math.sin(x / 3) * 0.6);
        for (let y = 8; y <= drip; y++) if (inside(x, y)) b.set(x, y, y === 8 ? '#ffd6ec' : y === drip ? '#e86aa8' : '#ff9ecf');
        if (rnd() < 0.2 && inside(x, 9)) b.set(x, 9, sprink[Math.floor(rnd() * sprink.length)]);
      }
      for (let y = 8; y < 24; y++) for (const xx of [0, 1, 2, 3, w - 4, w - 3, w - 2, w - 1]) if (inside(xx, y)) b.set(xx, y, (xx + y) % 4 < 2 ? '#ff3b3b' : '#ffffff');
      for (let x = 6; x < w - 6; x += Math.floor(r(14, 26))) {
        const c = sprink[Math.floor(rnd() * 4)];
        if (rnd() < 0.5) { b.ellipse(x, 5.5, 2.4, 2, (nx, ny) => (nx + ny < -0.4 ? shadeHex(c, 1.4) : c)); }   // 젤리
        else { b.ellipse(x, 5.5, 2, 1.6, c); b.set(x - 3, 5, c); b.set(x - 3, 6, c); b.set(x + 3, 5, c); b.set(x + 3, 6, c); b.set(x - 1, 5, '#ffffff'); }   // 사탕
      }
    } else if (theme === 'oz') {       // 오즈: 노란 벽돌길 + 양귀비 + 에메랄드
      fillBody((x, y) => {
        if (y === 8) return '#fff0a0';
        const row = Math.floor((y - 9) / 4), off = row % 2 ? 5 : 0;
        if ((y - 9) % 4 === 3 || (x + off) % 10 === 0) return '#b8862a';
        if ((y - 9) % 4 === 0 || (x + off) % 10 === 1) return '#ffe27a';
        return y > 19 ? '#d9a832' : '#f2c94c';
      });
      for (let x = 0; x < w; x++) if (inside(x, 23)) b.set(x, 23, '#3f9b3a');
      for (let x = 4; x < w - 4; x += Math.floor(r(9, 18))) {
        if (rnd() < 0.65) { b.line(x, 7, x, 5, '#2e7d32'); b.ellipse(x, 3.6, 1.8, 1.5, (nx, ny) => (ny < 0 ? '#ff5252' : '#c62828')); b.set(x, 4, '#1b1b1b'); }
        else { b.set(x, 6, '#2fbf71'); b.set(x - 1, 6, '#1f8a50'); b.set(x + 1, 6, '#1f8a50'); b.set(x, 5, '#7dffb5'); b.set(x, 7, '#1f8a50'); }
      }
    } else if (theme === 'star') {     // 별나라: 꿈빛 구름 + 작은 별
      const col = (y) => (y <= 9 ? '#efe7ff' : y < 13 ? '#d6c8ff' : y < 17 ? '#b9a4ff' : y < 20 ? '#9c86ee' : '#7f69d6');
      for (let x = 3; x < w + 6; x += Math.floor(r(6, 10))) b.ellipse(Math.min(x, w - 4), 13.5, r(4.5, 6.5), 5.6, (nx, ny, xx, y) => col(y));
      for (let y = 12; y <= 19; y++) for (let x = 2; x < w - 2; x++) b.set(x, y, col(y));
      for (let k = 0; k < w / 8; k++) b.set(r(3, w - 3), r(10, 19), rnd() < 0.5 ? '#fff6a8' : '#ffffff');
      for (let x = 6; x < w - 6; x += Math.floor(r(12, 22))) {
        const yy = Math.floor(r(3, 6));
        b.set(x, yy, '#ffe066'); b.set(x - 1, yy + 1, '#ffe066'); b.set(x + 1, yy + 1, '#ffe066'); b.set(x, yy + 1, '#ffffff');
        b.set(x - 2, yy + 1, '#ffd23f'); b.set(x + 2, yy + 1, '#ffd23f'); b.set(x - 1, yy + 2, '#ffd23f'); b.set(x + 1, yy + 2, '#ffd23f');
      }
    } else if (theme === 'xmas') {     // 산타 마을: 진저브레드 + 눈 + 지팡이 사탕
      fillBody((x, y) => {
        if (y <= 11 + (x % 7 === 0 ? 1 : 0)) return y === 8 ? '#ffffff' : y === 11 || y === 12 ? '#cfe3f7' : '#f4f9ff';
        if (y === 16) return x % 4 < 2 ? '#ffffff' : '#9a5a26';
        if (y === 17 && x % 4 === 1) return '#ffffff';
        return y > 20 ? '#8a4a1c' : (x * 5 + y * 3) % 23 === 0 ? '#d08a4a' : '#b8733a';
      });
      for (let k = 0; k < w / 22; k++) { const x = Math.floor(r(5, w - 5)); const h = Math.floor(r(2, 4)); for (let i = 0; i < h; i++) b.set(x, 21 + i, i === h - 1 ? '#e6f6ff' : '#bfe4ff'); }
      for (let x = 10; x < w - 8; x += Math.floor(r(26, 44))) {
        if (rnd() < 0.6) { for (let y = 1; y <= 7; y++) b.set(x, y, y % 2 ? '#ff3b3b' : '#ffffff'); b.set(x + 1, 1, '#ffffff'); b.set(x + 2, 1, '#ff3b3b'); b.set(x + 2, 2, '#ffffff'); }
        else { for (let yy = 4; yy <= 7; yy++) for (let xx = x - 2; xx <= x + 2; xx++) b.set(xx, yy, xx === x ? '#ffd23f' : '#2e9e4f'); b.set(x - 1, 3, '#ffd23f'); b.set(x + 1, 3, '#ffd23f'); }
      }
    } else {                     // 우주(크리스마스): 금속 패널 + 경고 줄무늬 + 전구 줄
      fillBody((x, y) => {
        if (y === 8) return '#e3e9fb';
        if (y === 9) return '#b9c4e6';
        if (y === 22) return '#3b4260';
        if (y === 23) return '#262a40';
        const end = x < 6 || x >= w - 6;
        if (end && y >= 10 && y <= 21) return (x + y) % 6 < 3 ? '#ffd23f' : '#1b1d2a';
        if (y === 15) return '#5a6285';
        const sx = x % 24;
        if (sx === 0) return '#454c6b';
        if (sx === 1) return '#8a93b8';
        return y < 12 ? '#7d86ab' : '#6b7499';
      });
      for (let x = 12; x < w - 8; x += 24) { b.set(x - 4, 11, '#d6dcf2'); b.set(x + 4, 11, '#d6dcf2'); b.set(x - 4, 20, '#d6dcf2'); b.set(x + 4, 20, '#d6dcf2'); }
      for (let x = 6; x < w - 6; x += 12) b.set(x, 23, '#7ff3ff');
      const bulbs = ['#ff4d4d', '#4dff88', '#ffd84d', '#4dc3ff', '#ff7bd5'];
      for (let x = 2; x < w - 2; x++) { const wy = 5 + Math.round(1.6 * Math.sin(((x % 16) / 16) * Math.PI)); b.set(x, wy, '#20232f'); }
      for (let x = 8, i = variant; x < w - 3; x += 16, i++) {
        const wy = 5 + Math.round(1.6 * Math.sin(0.5 * Math.PI)) + 1; const c = bulbs[i % 5];
        b.set(x, wy, c); b.set(x, wy + 1, shadeHex(c, 0.75)); b.set(x - 1, wy, c); b.set(x - 1, wy + 1, c); b.set(x - 1, wy, shadeHex(c, 1.5));
      }
    }
    return bufCanvas(b);
  }

  /* ================= 배경 (480x900 → 2배) ================= */
  const BW = 480, BH = 900;
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

  function Img(w, h) {
    const c = makeCanvas(w, h); const g = c.getContext('2d');
    const id = g.createImageData(w, h); const d = id.data;
    const api = {
      w, h,
      set(x, y, col) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; },
      get(x, y) { x |= 0; y |= 0; const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; },
      blend(x, y, col, a) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return; const i = (y * w + x) * 4; d[i] += (col[0] - d[i]) * a; d[i + 1] += (col[1] - d[i + 1]) * a; d[i + 2] += (col[2] - d[i + 2]) * a; },
      rect(x, y, rw, rh, col) { for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) api.set(xx, yy, col); },
      circle(cx, cy, r, col) { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r + r * 0.6) api.set(cx + xx, cy + yy, typeof col === 'function' ? col(xx / r, yy / r) : col); },
      ring(cx, cy, r, col) { for (let a = 0; a < 6.283; a += 0.5 / r) api.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), col); },
      glow(cx, cy, r, col, strength) { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) { const dd = Math.hypot(xx, yy) / r; if (dd < 1) api.blend(cx + xx, cy + yy, col, strength * (1 - dd) * (1 - dd)); } },
      line(x0, y0, x1, y1, col) { const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1; for (let i = 0; i <= n; i++) api.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col); },
      done() { g.putImageData(id, 0, 0); return c; },
    };
    return api;
  }
  const H = (h) => rgbOf(h);
  // 빛이 왼쪽 위에서 오는 3단 음영 공
  const ball = (hi, base, lo) => (nx, ny) => { const l = -(nx * 0.6 + ny * 0.8); return H(l > 0.45 ? hi : l > -0.35 ? base : lo); };

  function gradient(img, hexStops, y0 = 0, y1 = img.h) {
    const stops = hexStops.map(hexToRgb);
    const bands = 28;
    const cols = [];
    for (let k = 0; k <= bands; k++) {
      const t = (k / bands) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      cols.push(mixRgb(stops[i], stops[i + 1], t - i).map(Math.round));
    }
    for (let y = y0; y < y1; y++) {
      const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * bands;
      const bi = Math.min(bands - 1, Math.floor(t));
      const frac = t - bi;
      for (let x = 0; x < img.w; x++) {
        const th = (BAYER[y & 3][x & 3] + 0.5) / 16;
        img.set(x, y, frac > 0.55 && (frac - 0.55) / 0.45 > th ? cols[bi + 1] : cols[bi]);
      }
    }
  }

  function cloud(img, rnd, cx, cy, s, tones) {
    const [t1, t2, t3] = tones.map(H);
    const parts = [[0, 0, 1], [-1.1, 0.35, 0.72], [1.15, 0.3, 0.78], [-0.5, -0.45, 0.7], [0.55, -0.4, 0.62]];
    for (const [ox, oy, rs] of parts) {
      const r = Math.round(s * rs), px = cx + ox * s, py = cy + oy * s;
      img.circle(Math.round(px), Math.round(py), r, (nx, ny) => (ny > 0.45 ? t3 : ny > -0.1 || nx > 0.5 ? t2 : t1));
    }
    for (let x = Math.round(cx - s * 1.8); x < cx + s * 1.9; x++) img.set(x, cy + Math.round(s * 0.75), t3);
  }

  const BG = {
    magma(img, rnd) {
      gradient(img, ['#12030a', '#2a0710', '#4a0d0c', '#73190a', '#a8320c', '#d24a10']);
      const wall = H('#1c0609'), wallHi = H('#3d0f0a'), rim = H('#ff5a1f');
      for (let y = 0; y < BH; y++) {         // 양쪽 동굴 벽
        const wl = 30 + 26 * Math.sin(y / 60) + 12 * Math.sin(y / 23);
        const wr = 30 + 26 * Math.sin(y / 53 + 2) + 12 * Math.sin(y / 19 + 1);
        for (let x = 0; x < wl; x++) img.set(x, y, x > wl - 2 ? wallHi : wall);
        for (let x = BW - 1; x > BW - wr; x--) img.set(x, y, x < BW - wr + 2 ? wallHi : wall);
        if (rnd() < 0.05) img.set(wl, y, rim);
      }
      for (let k = 0; k < 3; k++) {          // 용암 폭포
        const left = k % 2 === 0, x0 = left ? 55 + rnd() * 40 : BW - 70 - rnd() * 40, y0 = 80 + rnd() * 300, y1 = BH - 60, wdt = 6 + Math.floor(rnd() * 5);
        for (let y = y0; y < y1; y++) {
          img.glow(x0 + wdt / 2, y, wdt + 10, H('#ff6a00'), 0.012);
          for (let x = 0; x < wdt; x++) img.set(x0 + x + Math.sin(y / 17) * 1.5, y, H((x + y) % 9 < 2 ? '#ffd23f' : x === 0 || x === wdt - 1 ? '#c2410c' : '#ff8a1f'));
        }
      }
      for (let i = 0; i < 7; i++) {          // 바위 기둥(음영)
        const x0 = 70 + rnd() * (BW - 140), w = 18 + Math.floor(rnd() * 30), hgt = 120 + Math.floor(rnd() * 320);
        for (let y = BH - hgt; y < BH; y++) {
          const shrink = Math.max(0, Math.round((BH - hgt + 28 - y) / 2.5)) + Math.round(Math.sin(y / 9 + i) * 1.5);
          for (let x = x0 + shrink; x < x0 + w - shrink; x++) {
            const u = (x - x0 - shrink) / Math.max(1, w - 2 * shrink);
            img.set(x, y, H(u < 0.18 ? '#4a1410' : u < 0.75 ? '#2a0a0a' : '#160405'));
          }
        }
      }
      for (let i = 0; i < 16; i++) {         // 종유석
        const x0 = rnd() * BW, w = 10 + rnd() * 18, hgt = 40 + rnd() * 120;
        for (let y = 0; y < hgt; y++) { const hw = (w / 2) * (1 - y / hgt); for (let x = x0 - hw; x <= x0 + hw; x++) img.set(x, y, H(x < x0 - hw / 3 ? '#3a0e0b' : '#1e0607')); }
        if (rnd() < 0.5) img.set(x0, hgt, H('#ff8a1f'));
      }
      for (let i = 0; i < 6; i++) {          // 빛나는 수정
        const cx = 60 + rnd() * (BW - 120), cy = 300 + rnd() * 500;
        img.glow(cx, cy - 8, 26, H('#ff9a3c'), 0.25);
        for (let k = 0; k < 4; k++) {
          const h = 10 + rnd() * 16, bx = cx + (k - 1.5) * 6, lean = (k - 1.5) * 2;
          for (let y = 0; y < h; y++) { const hw = 3 * (1 - y / h); for (let x = -hw; x <= hw; x++) img.set(bx + x + lean * (y / h), cy - y, H(x < 0 ? '#ffd27a' : '#ff8a1f')); }
        }
      }
      const lava = H('#ff6a00'), lavaMid = H('#ff9a1f'), lavaTop = H('#ffd23f');
      for (let x = 0; x < BW; x++) {
        const top = Math.round(845 + Math.sin(x / 14) * 5 + Math.sin(x / 5) * 1.5);
        for (let y = top; y < BH; y++) img.set(x, y, y < top + 2 ? lavaTop : (y + x) % 11 < 3 ? lavaMid : lava);
        img.blend(x, top - 1, H('#ff9a1f'), 0.6);
      }
      for (let i = 0; i < 14; i++) img.ring(rnd() * BW, 860 + rnd() * 30, 2 + Math.floor(rnd() * 3), lavaTop);
      for (let x = 0; x < BW; x += 2) for (let y = 760; y < 845; y++) img.blend(x, y, H('#ff6a00'), 0.25 * ((y - 760) / 85) ** 2);
      for (let i = 0; i < 160; i++) img.set(rnd() * BW, 300 + rnd() * 540, H(rnd() < 0.5 ? '#ff9a3c' : '#ffd23f'));
    },

    water(img, rnd) {
      gradient(img, ['#5cc6f0', '#2f95d6', '#1c6fb3', '#13508f', '#0c356a', '#082450']);
      const white = [255, 255, 255];
      for (let y = 0; y < 260; y++) for (let x = 0; x < BW; x++) {   // 물결 빛(코스틱)
        const v = Math.sin(x / 9 + Math.sin(y / 7) * 2) + Math.sin(y / 11 + x / 23);
        if (v > 1.45) img.blend(x, y, white, 0.16 * (1 - y / 260));
      }
      for (let r = 0; r < 8; r++) {         // 햇살 기둥
        const x0 = rnd() * BW, wdt = 10 + rnd() * 22;
        for (let y = 0; y < 650; y++) for (let x = 0; x < wdt; x++) img.blend(x0 + x + y * 0.3, y, white, 0.05 * (1 - y / 650));
      }
      const reef1 = H('#0f4479'), reef2 = H('#0b335e');
      for (let x = 0; x < BW; x++) {
        const a = Math.round(700 + Math.sin(x / 40) * 30 + Math.sin(x / 13) * 8), b2 = Math.round(770 + Math.sin(x / 31 + 2) * 22 + Math.sin(x / 9) * 5);
        for (let y = a; y < BH; y++) img.set(x, y, reef1);
        for (let y = b2; y < BH; y++) img.set(x, y, reef2);
      }
      for (let x = 0; x < BW; x++) {         // 바닥 바위(아래 마그마 층과 이어짐)
        const top = Math.round(855 + Math.sin(x / 17) * 6);
        for (let y = top; y < BH; y++) img.set(x, y, H(y < top + 3 ? '#6b5a4a' : y > 885 ? '#2a1414' : '#3a2a26'));
      }
      for (let i = 0; i < 22; i++) {         // 다시마
        const x0 = rnd() * BW, hgt = 120 + rnd() * 330, ph = rnd() * 6, base = 840 + rnd() * 20, c1 = H(rnd() < 0.5 ? '#1f8f5f' : '#2a9d6a');
        for (let y = 0; y < hgt; y++) {
          const x = x0 + Math.sin(y / 14 + ph) * 5;
          img.set(x, base - y, c1); img.set(x + 1, base - y, c1); img.set(x + 2, base - y, H('#156b46'));
          if (y % 18 === 9) { for (let k = 1; k < 6; k++) img.set(x + 2 + k, base - y - k * 0.5, H('#3cc47f')); }
        }
      }
      const corals = ['#ff8fab', '#ff9a3c', '#b388ff', '#ff6f91'];
      for (let i = 0; i < 12; i++) {         // 가지 산호
        const cx = rnd() * BW, cy = 830 + rnd() * 20, col = H(corals[i % 4]), hi = H(shadeHex(corals[i % 4], 1.35));
        const branch = (x, y, ang, len, dep) => {
          const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
          img.line(x, y, x2, y2, col); img.line(x + 1, y, x2 + 1, y2, col);
          if (dep > 0) { branch(x2, y2, ang - 0.5, len * 0.7, dep - 1); branch(x2, y2, ang + 0.45, len * 0.7, dep - 1); }
          else img.set(x2, y2, hi);
        };
        branch(cx, cy, -Math.PI / 2, 14 + rnd() * 8, 3);
      }
      for (let i = 0; i < 6; i++) { const cx = rnd() * BW, cy = 845; img.circle(cx, cy, 8, ball('#ffd0a0', '#e89a5a', '#a8643a')); for (let k = -6; k < 7; k += 3) img.set(cx + k, cy - 2, H('#c27a46')); }
      { // 보물상자
        const x = 60 + rnd() * 360, y = 832;
        img.rect(x, y, 22, 14, H('#8a5a2b')); img.rect(x, y - 6, 22, 6, H('#a8723a')); img.rect(x, y - 1, 22, 2, H('#ffd23f')); img.rect(x + 9, y - 2, 4, 6, H('#ffd23f'));
        img.glow(x + 11, y - 4, 22, H('#ffd23f'), 0.35);
      }
      const fishCols = ['#ffb347', '#ff7f50', '#ffd23f', '#7fe0ff'];
      for (let s = 0; s < 3; s++) {          // 물고기 떼
        const sx = rnd() * BW, sy = 120 + rnd() * 520, col = H(fishCols[s % 4]);
        for (let k = 0; k < 9; k++) {
          const fx = sx + (k % 3) * 14 + rnd() * 5, fy = sy + Math.floor(k / 3) * 9 + rnd() * 4;
          img.rect(fx, fy, 7, 3, col); img.set(fx - 1, fy - 1, col); img.set(fx - 1, fy + 3, col); img.set(fx - 1, fy + 1, col); img.set(fx + 5, fy, [20, 20, 30]);
        }
      }
      for (let j = 0; j < 4; j++) {          // 해파리
        const cx = 40 + rnd() * 400, cy = 140 + rnd() * 450;
        for (let yy = -8; yy <= 0; yy++) for (let xx = -9; xx <= 9; xx++) if (xx * xx / 81 + yy * yy / 64 <= 1) img.blend(cx + xx, cy + yy, H(yy < -5 ? '#ffd0f0' : '#ff9ed8'), 0.75);
        for (let t = -6; t <= 6; t += 3) for (let k = 0; k < 18; k++) img.blend(cx + t + Math.sin(k / 3 + t) * 1.5, cy + 1 + k, H('#ffc2ec'), 0.6);
      }
      for (let i = 0; i < 90; i++) img.ring(rnd() * BW, rnd() * 820, 1 + Math.floor(rnd() * 3), H('#bff0ff'));
    },

    ground(img, rnd) {
      gradient(img, ['#4a86d4', '#5f9be0', '#7cb5ec', '#a5d0f4', '#d4ecfa'], 0, 640);
      img.glow(390, 120, 90, H('#fff6c8'), 0.55);
      img.circle(390, 120, 24, ball('#fffbe0', '#fff3b0', '#ffe27a'));
      for (let i = 0; i < 8; i++) cloud(img, rnd, rnd() * BW, 50 + rnd() * 420, 10 + Math.floor(rnd() * 10), ['#ffffff', '#eef5ff', '#cddff2']);
      for (let i = 0; i < 4; i++) {          // 먼 산
        const cx = rnd() * BW, peak = 520 + rnd() * 50, half = 90 + rnd() * 60;
        for (let y = Math.round(peak); y < 660; y++) { const hw = ((y - peak) / 140) * half; for (let x = cx - hw; x <= cx + hw; x++) img.set(x, y, H(x < cx ? '#9fb3d4' : '#8ca2c6')); }
      }
      const layers = [[610, 18, 50, '#c9a35a', '#b8924c'], [660, 14, 37, '#d9822b', '#c46f20'], [715, 12, 29, '#b5561c', '#9c4816']];
      layers.forEach(([base, amp, per, c1, c2], li) => {
        const tops = [];
        for (let x = 0; x < BW; x++) { const t = Math.round(base + Math.sin(x / per + li) * amp + Math.sin(x / (per / 3)) * 3); tops.push(t); for (let y = t; y < BH; y++) img.set(x, y, H((x + y) % 23 === 0 ? c2 : c1)); }
        for (let k = 0; k < 9 - li * 2; k++) {  // 단풍나무
          const tx = Math.floor(rnd() * BW), r = 7 + li * 4 + Math.floor(rnd() * 4), ty = tops[tx];
          const cc = ['#e8762b', '#d94f2b', '#f2b134', '#c9562c', '#e0a030'][Math.floor(rnd() * 5)];
          img.rect(tx - 1, ty - r, 3 + (li > 1 ? 1 : 0), r + 2, H('#5a3418'));
          img.circle(tx, ty - r - r * 0.6, r, ball(shadeHex(cc, 1.3), cc, shadeHex(cc, 0.7)));
        }
      });
      for (let h = 0; h < 4; h++) {          // 작은 마을
        const x = 40 + h * 30 + rnd() * 10, y = 600 + Math.sin(x / 50) * 18;
        img.rect(x, y - 12, 16, 12, H('#f0e0c0')); img.rect(x + 12, y - 12, 4, 12, H('#d6c4a0'));
        for (let k = 0; k < 9; k++) img.rect(x - 2 + k, y - 13 - k * 0.0, 20 - k * 2, 1, H('#c0392b'));
        for (let k = 0; k < 8; k++) img.line(x - 2 + k, y - 12 - k, x + 18 - k, y - 12 - k, H(k < 2 ? '#a02a20' : '#c0392b'));
        img.rect(x + 4, y - 8, 3, 3, H('#ffd23f')); img.rect(x + 10, y - 6, 3, 6, H('#6b3e1e'));
        for (let k = 0; k < 4; k++) img.blend(x + 13 + k, y - 24 - k * 4, [230, 230, 230], 0.6);
      }
      for (let x = 0; x < BW; x++) { const t = Math.round(780 + Math.sin(x / 60) * 4); for (let y = t; y < 870; y++) img.set(x, y, H(y < t + 2 ? '#9cbf4a' : (x * 7 + y * 3) % 17 === 0 ? '#e8a33d' : '#7a9b3a')); }
      for (let x = 0; x < BW; x += 18) { img.rect(x, 770, 3, 14, H('#8a5a2b')); }
      for (let x = 0; x < BW; x++) { img.set(x, 774, H('#a8723a')); img.set(x, 779, H('#a8723a')); }
      for (let i = 0; i < 6; i++) { const px = rnd() * BW, py = 800 + rnd() * 50; img.circle(px, py, 6, ball('#ffb35c', '#f08a24', '#b85d10')); img.rect(px, py - 9, 2, 4, H('#5f7d1e')); }
      for (let x = 0; x < BW; x++) for (let y = 870; y < BH; y++) img.set(x, y, H(y < 872 ? '#5e3a1c' : (x + y) % 13 === 0 ? '#7a5030' : '#4a2c14'));
      for (let i = 0; i < 7; i++) { const bx = rnd() * BW, by = 60 + rnd() * 360, c = [60, 50, 60]; img.set(bx, by, c); img.set(bx + 1, by + 1, c); img.set(bx + 2, by, c); img.set(bx - 1, by - 1, c); img.set(bx + 3, by - 1, c); }
      for (let i = 0; i < 70; i++) img.set(rnd() * BW, rnd() * 760, H(['#e8762b', '#f2b134', '#d94f2b'][i % 3]));
    },

    sky(img, rnd) {
      gradient(img, ['#1d2a5c', '#2a3f86', '#3b5aa8', '#4a72c4', '#4a86d4']);
      for (let y = 0; y < 260; y++) for (let x = 0; x < BW; x++) {    // 오로라
        const v = Math.sin(x / 40 + Math.sin(y / 30) * 1.5) * 0.5 + 0.5;
        const band = Math.exp(-(((y - 120 - Math.sin(x / 55) * 40) / 30) ** 2));
        if (band * v > 0.25) img.blend(x, y, H(v > 0.7 ? '#7dffb5' : '#4de0c8'), 0.28 * band * v);
      }
      for (let i = 0; i < 120; i++) img.set(rnd() * BW, rnd() * 380, H(rnd() < 0.8 ? '#dfe8ff' : '#fff6a8'));
      const mx = 110, my = 180;
      img.glow(mx, my, 70, H('#fff8dc'), 0.4);
      img.circle(mx, my, 30, ball('#fffdf0', '#fff3c8', '#e6d49a'));
      img.circle(mx - 9, my - 6, 5, H('#ead9a4')); img.circle(mx + 11, my + 8, 7, H('#ead9a4')); img.circle(mx + 4, my - 14, 3, H('#ead9a4'));
      { // 달 앞을 지나는 산타 썰매 실루엣
        const sx = mx - 40, sy = my + 6, c = H('#1a2048');
        img.rect(sx + 44, sy, 22, 5, c); img.rect(sx + 60, sy - 6, 6, 6, c); img.line(sx + 42, sy + 7, sx + 68, sy + 7, c);
        for (let k = 0; k < 3; k++) { const rx = sx + k * 13; img.rect(rx, sy - 1, 9, 4, c); img.rect(rx + 7, sy - 5, 2, 4, c); img.set(rx + 9, sy - 6, c); img.set(rx + 1, sy + 3, c); img.set(rx + 7, sy + 3, c); img.line(rx + 9, sy, rx + 14, sy + 1, c); }
      }
      { // 열기구
        const bx = 380, by = 420;
        img.circle(bx, by, 20, (nx, ny) => { const stripe = Math.floor((nx + 1) * 3) % 2; const l = -(nx * 0.6 + ny * 0.8); return H(stripe ? (l > 0 ? '#ff6060' : '#c03030') : (l > 0 ? '#ffffff' : '#d8dde8')); });
        img.line(bx - 10, by + 17, bx - 5, by + 30, H('#5a3a1a')); img.line(bx + 10, by + 17, bx + 5, by + 30, H('#5a3a1a'));
        img.rect(bx - 5, by + 30, 10, 7, H('#8a5a2b'));
      }
      for (let i = 0; i < 13; i++) cloud(img, rnd, rnd() * BW, 260 + rnd() * 480, 12 + Math.floor(rnd() * 12), ['#ffffff', '#e4eefb', '#b9cbe8']);
      for (let k = 0; k < 60; k++) cloud(img, rnd, (k / 60) * BW * 1.1 - 10, 860 + rnd() * 30, 14 + Math.floor(rnd() * 8), ['#ffffff', '#eaf2fc', '#c9d9ee']);   // 구름 바다
      for (let i = 0; i < 320; i++) { const x = rnd() * BW, y = rnd() * BH; img.set(x, y, [255, 255, 255]); if (i % 9 === 0) { img.set(x - 1, y, [230, 240, 255]); img.set(x + 1, y, [230, 240, 255]); img.set(x, y - 1, [230, 240, 255]); img.set(x, y + 1, [230, 240, 255]); } }
    },

    space(img, rnd) {
      gradient(img, ['#010106', '#04041a', '#0a0a2e', '#12124a', '#1a1f5c', '#1d2a5c']);
      const neb = ['#3b1f6e', '#1f3b6e', '#5a1f5e', '#1f5a6e'];
      for (let n = 0; n < 7; n++) {         // 성운 2단 디더링
        const cx = rnd() * BW, cy = rnd() * 760, r = 50 + rnd() * 80, col = H(neb[n % 4]), col2 = H(shadeHex(neb[n % 4], 1.5));
        for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) {
          const d = Math.hypot(x - cx, (y - cy) * 1.4) / r + Math.sin(x / 13 + y / 17) * 0.12;
          if (d < 1 && (1 - d) * 16 > BAYER[y & 3][x & 3] + 5) img.set(x, y, d < 0.45 && (1 - d) * 16 > BAYER[y & 3][x & 3] + 9 ? col2 : col);
        }
      }
      for (let i = 0; i < 1400; i++) {      // 은하수 띠
        const t = rnd(), x = t * BW, y = 120 + t * 420 + (rnd() - 0.5) * 120 * (0.5 + rnd());
        img.blend(x, y, [210, 210, 255], 0.5 * rnd());
      }
      const starCols = ['#ffffff', '#fff6a8', '#a8d8ff', '#ffc8f0'];
      for (let i = 0; i < 700; i++) img.set(rnd() * BW, rnd() * BH, H(starCols[i % 4]));
      for (let i = 0; i < 40; i++) { const x = rnd() * BW, y = rnd() * BH, c = H(starCols[i % 4]); img.set(x - 1, y, c); img.set(x + 1, y, c); img.set(x, y - 1, c); img.set(x, y + 1, c); img.set(x, y, [255, 255, 255]); }
      for (let i = 0; i < 8; i++) { const x = rnd() * BW, y = rnd() * BH; img.glow(x, y, 9, [255, 255, 230], 0.6); for (let k = -5; k <= 5; k++) { img.set(x + k, y, [255, 255, 240]); img.set(x, y + k, [255, 255, 240]); } }
      { // 고리 행성(명암)
        const px = 120 + rnd() * 240, py = 520 + rnd() * 150, r = 40;
        for (let x = -70; x <= 70; x++) { const y = Math.round(x * 0.22); if (Math.hypot(x, y * 1.2) > r - 2 || y > 0) { img.set(px + x, py + y, H('#f0d090')); img.set(px + x, py + y + 1, H('#c8a060')); } }
        img.circle(px, py, r, (nx, ny) => { const band = Math.floor((ny + 1) * 5) % 2; const l = -(nx * 0.7 + ny * 0.5); return H(l < -0.45 ? (band ? '#6a3a20' : '#5a3018') : band ? '#e0a060' : '#c88048'); });
        for (let x = -70; x <= 70; x++) { const y = Math.round(x * 0.22); if (y > 0 || Math.hypot(x, y) > r) { img.set(px + x, py + y, H('#f0d090')); img.set(px + x, py + y + 1, H('#c8a060')); } }
      }
      { // 달
        const mx = 70 + rnd() * 120, my = 150 + rnd() * 120;
        img.circle(mx, my, 22, ball('#f0f0fa', '#d0d0e2', '#8a8aa8'));
        img.circle(mx - 6, my - 4, 4, H('#b0b0c8')); img.circle(mx + 8, my + 6, 5, H('#a8a8c0')); img.circle(mx + 2, my - 11, 2, H('#b0b0c8'));
      }
      { // 인공위성
        const sx = 380, sy = 330, c = H('#c9d1f0');
        img.rect(sx, sy, 8, 6, c); img.rect(sx - 14, sy + 1, 12, 4, H('#3a6ad0')); img.rect(sx + 10, sy + 1, 12, 4, H('#3a6ad0'));
        for (let k = 0; k < 12; k += 3) { img.set(sx - 14 + k, sy + 2, H('#7aa8ff')); img.set(sx + 10 + k, sy + 2, H('#7aa8ff')); }
        img.line(sx + 4, sy, sx + 4, sy - 6, c); img.set(sx + 4, sy - 7, H('#ff4d4d'));
      }
      { // 혜성
        const cx = 330, cy = 120;
        for (let k = 0; k < 60; k++) img.blend(cx + k, cy - k * 0.45, [180, 220, 255], 0.6 * (1 - k / 60));
        img.glow(cx, cy, 8, [255, 255, 255], 0.9);
      }
      img.glow(360, 70, 40, H('#fff6c8'), 0.5);      // 베들레헴 별
      for (let k = -16; k <= 16; k++) { img.set(360 + k, 70, [255, 250, 220]); img.set(360, 70 + k, [255, 250, 220]); if (Math.abs(k) < 7) { img.set(360 + k, 70 + k, [255, 245, 200]); img.set(360 + k, 70 - k, [255, 245, 200]); } }
      for (let y = 820; y < BH; y++) for (let x = 0; x < BW; x++) img.blend(x, y, H('#2a4590'), 0.5 * ((y - 820) / 80) ** 2);
    },
    flower(img, rnd) {
      gradient(img, ['#9fdcff', '#bfe9ff', '#dff3ff', '#fde2f3', '#ffd0e8']);
      // 무지개
      const rb = ['#ff6b6b', '#ffb347', '#ffe066', '#7dd87d', '#6bb8ff', '#b388ff'];
      for (let i = 0; i < rb.length; i++) for (let a = Math.PI; a < 2 * Math.PI; a += 0.004) {
        const rr = 210 - i * 7; for (let t = 0; t < 7; t++) img.blend(240 + Math.cos(a) * (rr - t), 360 + Math.sin(a) * (rr - t), H(rb[i]), 0.55);
      }
      img.glow(80, 90, 70, H('#fff6c8'), 0.6);
      img.circle(80, 90, 26, ball('#fffbe0', '#ffe27a', '#ffc94a'));
      img.set(72, 86, [90, 60, 40]); img.set(73, 86, [90, 60, 40]); img.set(87, 86, [90, 60, 40]); img.set(88, 86, [90, 60, 40]);
      for (let x = 72; x <= 88; x++) img.set(x, 98 + Math.round(Math.sin(((x - 72) / 16) * Math.PI) * 3), [200, 90, 60]);
      for (let i = 0; i < 7; i++) cloud(img, rnd, rnd() * BW, 60 + rnd() * 300, 10 + Math.floor(rnd() * 8), ['#ffffff', '#fff0f8', '#f5d8ec']);
      const hills = [[640, 22, 60, '#b8f0a0', '#a4e48c'], [700, 16, 44, '#8fdc72', '#7fcf62'], [760, 12, 33, '#6fc552', '#5fb544']];
      hills.forEach(([base, amp, per, c1, c2], li) => {
        for (let x = 0; x < BW; x++) { const t = Math.round(base + Math.sin(x / per + li * 2) * amp); for (let y = t; y < BH; y++) img.set(x, y, H((x * 3 + y) % 19 === 0 ? c2 : c1)); }
      });
      const petals = ['#ff6fa8', '#ffb347', '#b388ff', '#ff5252', '#ffffff', '#6bb8ff'];
      for (let i = 0; i < 9; i++) {         // 커다란 꽃
        const x = 20 + rnd() * 440, base = 700 + rnd() * 160, h = 120 + rnd() * 230, c = petals[i % petals.length], r = 14 + Math.floor(rnd() * 10);
        for (let y = base - h; y < base; y++) { img.set(x + Math.sin(y / 30) * 3, y, H('#3f9b3a')); img.set(x + 1 + Math.sin(y / 30) * 3, y, H('#2e7d32')); }
        img.circle(x - 10, base - h * 0.45, 7, ball('#8fe070', '#5fbf3a', '#3f9b3a'));
        const fx = x + Math.sin((base - h) / 30) * 3, fy = base - h;
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; img.circle(fx + Math.cos(a) * r * 0.9, fy + Math.sin(a) * r * 0.9, Math.round(r * 0.6), ball(shadeHex(c, 1.3), c, shadeHex(c, 0.75))); }
        img.circle(fx, fy, Math.round(r * 0.45), ball('#fff1a8', '#ffd23f', '#e0a000'));
      }
      for (let i = 0; i < 4; i++) {         // 버섯 집
        const x = 40 + rnd() * 400, y = 790 + rnd() * 70;
        img.rect(x - 9, y - 20, 18, 20, H('#fff3e0')); img.rect(x + 4, y - 20, 5, 20, H('#ead6bc'));
        img.rect(x - 3, y - 10, 6, 10, H('#8a5a2b')); img.circle(x + 2, y - 5, 1, H('#ffd23f'));
        for (let yy = 0; yy < 14; yy++) { const hw = 22 * Math.sqrt(1 - ((yy - 14) / 14) ** 2); for (let xx = -hw; xx <= hw; xx++) img.set(x + xx, y - 20 - 14 + yy, H(xx < -hw / 3 ? '#ff6b6b' : '#e53935')); }
        for (let k = 0; k < 5; k++) img.circle(x - 14 + k * 7, y - 28 + (k % 2) * 4, 2, H('#ffffff'));
      }
      for (let i = 0; i < 250; i++) { const x = rnd() * BW, y = 640 + rnd() * 260, c = H(petals[i % petals.length]); img.set(x, y, c); img.set(x + 1, y, c); img.set(x, y - 1, H('#fff6c8')); }
      for (let i = 0; i < 8; i++) { const x = rnd() * BW, y = 200 + rnd() * 400, c = H(petals[i % 5]); img.rect(x - 3, y - 2, 3, 3, c); img.rect(x + 1, y - 2, 3, 3, c); img.set(x, y, [40, 30, 40]); img.set(x, y - 1, [40, 30, 40]); }
    },

    candy(img, rnd) {
      gradient(img, ['#ffd6ec', '#ffc8e6', '#ffbfe0', '#ffd8c8', '#ffe8b8']);
      for (let i = 0; i < 9; i++) cloud(img, rnd, rnd() * BW, 50 + rnd() * 380, 11 + Math.floor(rnd() * 9), i % 2 ? ['#ffffff', '#ffe0f2', '#ffc0e0'] : ['#ffffff', '#dff2ff', '#bfe0ff']);
      for (let i = 0; i < 4; i++) {         // 아이스크림 산
        const cx = 40 + rnd() * 400, base = 760, h = 160 + rnd() * 120, half = 70 + rnd() * 40;
        const cols = [['#fff6e8', '#ffe8cc'], ['#ffb3d1', '#ff8fbf'], ['#c8f0d8', '#a0e0bc'], ['#d8c0ff', '#bca0f0']][i % 4];
        for (let y = Math.round(base - h); y < base; y++) {
          const hw = ((y - (base - h)) / h) * half;
          for (let x = cx - hw; x <= cx + hw; x++) img.set(x, y, H(x < cx - hw / 3 ? cols[0] : cols[1]));
        }
        for (let x = cx - 25; x <= cx + 25; x += 4) { const len = 10 + Math.abs(Math.sin(x)) * 25; for (let y = 0; y < len; y++) img.set(x, base - h + 25 + y + Math.abs(x - cx) * (h / half) * 0.5, H('#7a4a2a')); }
      }
      for (let i = 0; i < 7; i++) {         // 막대사탕 나무
        const x = 20 + rnd() * 440, base = 790 + rnd() * 60, h = 70 + rnd() * 120, r = 16 + Math.floor(rnd() * 8);
        img.rect(x - 1, base - h, 3, h, H('#ffffff')); img.rect(x + 1, base - h, 1, h, H('#e0e0e8'));
        const c1 = ['#ff4d6d', '#4dc3ff', '#7dd87d', '#b388ff'][i % 4];
        img.circle(x, base - h - r, r, (nx, ny) => { const a = Math.atan2(ny, nx), d = Math.hypot(nx, ny); return H(Math.floor((a + d * 6) / (Math.PI / 3)) % 2 ? c1 : '#ffffff'); });
      }
      for (let i = 0; i < 6; i++) {         // 지팡이 사탕
        const x = rnd() * BW, base = 860, h = 80 + rnd() * 60;
        for (let y = base - h; y < base; y++) for (let t = 0; t < 5; t++) img.set(x + t, y, H(((y + t) >> 2) % 2 ? '#ff3b3b' : '#ffffff'));
        for (let a = Math.PI; a < 2 * Math.PI; a += 0.05) for (let t = 0; t < 5; t++) img.set(x + 9 + Math.cos(a) * (9 - t + 2), base - h + Math.sin(a) * (9 - t + 2), H(Math.floor(a * 3) % 2 ? '#ff3b3b' : '#ffffff'));
      }
      { // 진저브레드 하우스
        const x = 300 + rnd() * 100, y = 800;
        img.rect(x, y - 40, 60, 40, H('#b8733a')); img.rect(x + 45, y - 40, 15, 40, H('#9a5a26'));
        for (let k = 0; k < 30; k++) img.line(x - 6 + k, y - 40 - k, x + 66 - k, y - 40 - k, H(k % 6 < 2 ? '#ffffff' : '#ff8fbf'));
        img.rect(x + 24, y - 20, 12, 20, H('#6b3e1e')); img.rect(x + 6, y - 30, 10, 10, H('#ffd23f')); img.rect(x + 44, y - 30, 10, 10, H('#ffd23f'));
        for (let k = 0; k < 6; k++) img.circle(x + 5 + k * 10, y - 42, 2, H(['#ff4d6d', '#7dd87d', '#4dc3ff'][k % 3]));
      }
      for (let x = 0; x < BW; x++) {         // 초콜릿 강
        const t = Math.round(852 + Math.sin(x / 16) * 4);
        for (let y = t; y < BH; y++) img.set(x, y, H(y < t + 2 ? '#a8703f' : (x + y * 2) % 15 < 2 ? '#8a5a32' : '#6b3e1e'));
      }
      const sp = ['#ff4d6d', '#4dc3ff', '#ffd23f', '#7dff8a', '#b388ff', '#ffffff'];
      for (let i = 0; i < 260; i++) { const x = rnd() * BW, y = rnd() * 840, c = H(sp[i % sp.length]); img.set(x, y, c); img.set(x + 1, y + (i % 2), c); }
    },

    oz(img, rnd) {
      gradient(img, ['#5fbfff', '#7fd0ff', '#a6e0ff', '#d4f2ff', '#e8fff0']);
      const rb = ['#ff6b6b', '#ffb347', '#ffe066', '#7dd87d', '#6bb8ff', '#b388ff'];
      for (let i = 0; i < rb.length; i++) for (let a = Math.PI; a < 2 * Math.PI; a += 0.003) {
        const rr = 300 - i * 9; for (let t = 0; t < 9; t++) img.blend(260 + Math.cos(a) * (rr - t), 560 + Math.sin(a) * (rr - t), H(rb[i]), 0.45);
      }
      for (let i = 0; i < 6; i++) cloud(img, rnd, rnd() * BW, 40 + rnd() * 260, 10 + Math.floor(rnd() * 8), ['#ffffff', '#eef8ff', '#cfe6f5']);
      { // 회오리와 날아가는 집
        const tx = 60 + rnd() * 40;
        for (let y = 120; y < 520; y++) { const hw = 6 + (520 - y) * 0.11; for (let x = -hw; x <= hw; x++) { const v = Math.sin(y / 6 + x / 5); img.blend(tx + x + Math.sin(y / 40) * 12, y, H(v > 0.3 ? '#8a8a9a' : '#6a6a7a'), 0.75); } }
        const hx = tx + 30, hy = 170;
        img.rect(hx, hy, 18, 12, H('#c9a87a')); for (let k = 0; k < 9; k++) img.line(hx - 2 + k, hy - k, hx + 20 - k, hy - k, H('#8a3a2a'));
        img.rect(hx + 7, hy + 5, 4, 7, H('#5a3a1a'));
      }
      { // 에메랄드 시티
        const cx = 330, base = 600;
        img.glow(cx, base - 90, 130, H('#7dffb5'), 0.35);
        const towers = [[-80, 90, 14], [-55, 140, 16], [-28, 120, 14], [0, 200, 20], [28, 130, 14], [55, 160, 16], [82, 100, 14]];
        for (const [dx, h, w] of towers) {
          for (let y = base - h; y < base; y++) for (let x = -w / 2; x <= w / 2; x++) img.set(cx + dx + x, y, H(x < -w / 6 ? '#7dffb5' : x < w / 4 ? '#2fbf71' : '#1f8a50'));
          for (let k = 0; k < w; k++) for (let y = 0; y < k * 1.6; y++) img.set(cx + dx - w / 2 + k * 0.5, base - h - (w * 1.6 - y) + (w - k) * 0, H('#2fbf71'));
          for (let y = 0; y < w * 1.5; y++) { const hw = (y / (w * 1.5)) * (w / 2); for (let x = -hw; x <= hw; x++) img.set(cx + dx + x, base - h - w * 1.5 + y, H(x < 0 ? '#9affc8' : '#2fbf71')); }
          for (let y = base - h + 10; y < base - 6; y += 14) img.rect(cx + dx - 2, y, 4, 6, H('#e8fff0'));
        }
      }
      for (let x = 0; x < BW; x++) { const t = Math.round(620 + Math.sin(x / 50) * 10); for (let y = t; y < BH; y++) img.set(x, y, H((x * 3 + y) % 21 === 0 ? '#5fae3a' : '#7fcf62')); }
      // 노란 벽돌길(원근)
      for (let y = 620; y < BH; y++) {
        const t = (y - 620) / (BH - 620), cx = 330 - t * 120 + Math.sin(t * 5) * 40, hw = 4 + t * 70;
        for (let x = cx - hw; x <= cx + hw; x++) { const brick = (Math.floor(y / (3 + t * 6)) + Math.floor((x - cx) / (5 + t * 10))) % 2; img.set(x, y, H(brick ? '#f2c94c' : '#ffe27a')); }
        img.set(cx - hw, y, H('#b8862a')); img.set(cx + hw, y, H('#b8862a'));
      }
      for (let i = 0; i < 420; i++) { const x = rnd() * BW, y = 640 + rnd() * 260; if (img.get(x, y)[1] > 150 && img.get(x, y)[0] < 200) { img.set(x, y, H('#e53935')); img.set(x + 1, y, H('#ff5252')); img.set(x, y + 1, H('#b71c1c')); } }
    },

    star(img, rnd) {
      gradient(img, ['#140b33', '#22125a', '#33207a', '#4a2f99', '#6b4fc0', '#8f6fd9']);
      const neb = ['#5a3fb0', '#7a4fd0', '#3f5fd0'];
      for (let n = 0; n < 5; n++) {
        const cx = rnd() * BW, cy = rnd() * 800, r = 60 + rnd() * 70, col = H(neb[n % 3]);
        for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) { const d = Math.hypot(x - cx, (y - cy) * 1.3) / r; if (d < 1 && (1 - d) * 16 > BAYER[y & 3][x & 3] + 6) img.set(x, y, col); }
      }
      for (let i = 0; i < 600; i++) img.set(rnd() * BW, rnd() * BH, H(['#ffffff', '#fff6a8', '#ffd0f0', '#c8d8ff'][i % 4]));
      // 별자리
      for (let c = 0; c < 4; c++) {
        let px = rnd() * BW, py = 40 + rnd() * 700;
        for (let k = 0; k < 5; k++) { const nx = px + (rnd() - 0.4) * 70, ny = py + (rnd() - 0.5) * 50; for (let t = 0; t <= 1; t += 0.02) img.blend(px + (nx - px) * t, py + (ny - py) * t, [220, 220, 255], 0.5); img.glow(px, py, 6, [255, 250, 220], 0.9); px = nx; py = ny; }
      }
      // 잠자는 초승달(모자 쓴)
      const mx = 330, my = 230, R = 70;
      img.glow(mx, my, 150, H('#fff6c8'), 0.35);
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
        if (x * x + y * y > R * R) continue;
        if ((x - 34) ** 2 + (y + 14) ** 2 < (R * 0.86) ** 2) continue;
        const l = -(x * 0.6 + y * 0.8) / R;
        img.set(mx + x, my + y, H(l > 0.3 ? '#fff8d0' : l > -0.3 ? '#ffe680' : '#e6c040'));
      }
      for (let k = 0; k < 9; k++) img.set(mx - 40 + k, my + 2 + Math.round(Math.sin((k / 8) * Math.PI) * 3), H('#7a5a20'));   // 감은 눈
      img.circle(mx - 52, my + 22, 5, H('#ffb0b0'));
      for (let y = 0; y < 50; y++) { const hw = 3 + y * 0.5; for (let x = -hw; x <= hw; x++) img.set(mx - 40 + x + y * 0.9, my - R - 10 + y * 0.6 - 30 + y, H(x < 0 ? '#6b8fff' : '#4a6fe0')); }
      img.circle(mx + 6, my - 100, 6, H('#ffffff'));
      // 별 모양 섬
      const star5 = (cx, cy, r, c1, c2) => {
        const pts = []; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
        const inPoly = (x, y) => { let c = false; for (let i = 0, j = 9; i < 10; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (inPoly(x + 0.5, y + 0.5)) img.set(cx + x, cy + y, H(x + y < -r * 0.2 ? c1 : c2));
        img.glow(cx, cy, r * 2, H('#fff6c8'), 0.25);
      };
      for (let i = 0; i < 6; i++) star5(30 + rnd() * 420, 420 + rnd() * 380, 12 + Math.floor(rnd() * 12), '#fff3a0', '#ffd23f');
      for (let k = 0; k < 40; k++) cloud(img, rnd, (k / 40) * BW * 1.1, 870 + rnd() * 30, 14 + Math.floor(rnd() * 6), ['#e8deff', '#c9b8ff', '#9f88e8']);
      for (let i = 0; i < 30; i++) { const x = rnd() * BW, y = rnd() * 850; img.glow(x, y, 7, [255, 245, 200], 0.7); for (let k = -4; k <= 4; k++) { img.set(x + k, y, [255, 250, 220]); img.set(x, y + k, [255, 250, 220]); } }
    },

    xmas(img, rnd) {
      gradient(img, ['#0b1538', '#13245a', '#1e3a7a', '#3a5aa8', '#6f8fd0']);
      for (let y = 0; y < 300; y++) for (let x = 0; x < BW; x++) {
        const band = Math.exp(-(((y - 130 - Math.sin(x / 60) * 50) / 35) ** 2)), v = Math.sin(x / 35 + y / 50) * 0.5 + 0.5;
        if (band * v > 0.2) img.blend(x, y, H(v > 0.7 ? '#ff7bd5' : '#7dffb5'), 0.3 * band * v);
      }
      for (let i = 0; i < 200; i++) img.set(rnd() * BW, rnd() * 400, [240, 240, 255]);
      for (let x = 0; x < BW; x++) {        // 눈 언덕 두 겹
        const a = Math.round(640 + Math.sin(x / 70) * 30), b2 = Math.round(720 + Math.sin(x / 45 + 1) * 18);
        for (let y = a; y < BH; y++) img.set(x, y, H(y < a + 3 ? '#ffffff' : '#c9daf0'));
        for (let y = b2; y < BH; y++) img.set(x, y, H(y < b2 + 3 ? '#ffffff' : '#e6f0fa'));
      }
      const tree = (x, base, h) => {
        for (let y = 0; y < h; y++) { const hw = (y / h) * h * 0.35 + 1; for (let xx = -hw; xx <= hw; xx++) img.set(x + xx, base - h + y, H((y % 14 > 11) ? '#ffffff' : xx < 0 ? '#2fae55' : '#1f7a3a')); }
        for (let k = 0; k < h / 5; k++) { const y = base - h + 6 + rnd() * (h - 8), hw = ((y - base + h) / h) * h * 0.35; img.set(x + (rnd() * 2 - 1) * hw, y, H(['#ff3b3b', '#ffd23f', '#4dc3ff', '#ff7bd5'][k % 4])); }
        img.rect(x - 2, base, 5, 6, H('#5a3418')); img.circle(x, base - h - 2, 3, H('#ffd23f'));
      };
      for (let i = 0; i < 8; i++) tree(rnd() * BW, 660 + rnd() * 80, 40 + rnd() * 50);
      { // 산타 작업장
        const x = 150 + rnd() * 120, y = 800;
        img.rect(x, y - 60, 110, 60, H('#a8463a')); img.rect(x + 85, y - 60, 25, 60, H('#863428'));
        for (let k = 0; k < 40; k++) img.line(x - 10 + k * 1.2, y - 60 - k, x + 120 - k * 1.2, y - 60 - k, H(k < 4 ? '#ffffff' : k % 8 < 2 ? '#ffffff' : '#5a2a2a'));
        img.rect(x + 80, y - 115, 14, 30, H('#7a3a2a')); img.rect(x + 78, y - 118, 18, 5, H('#ffffff'));
        img.rect(x + 45, y - 30, 20, 30, H('#4a2a12'));
        for (const wx of [12, 72]) { img.rect(x + wx, y - 45, 18, 16, H('#ffd23f')); img.glow(x + wx + 9, y - 37, 20, H('#ffd23f'), 0.3); }
        for (let k = 0; k < 14; k++) { img.circle(x + 4 + k * 8, y - 62 + (k % 2), 1, H(['#ff3b3b', '#7dff8a', '#ffd23f', '#4dc3ff'][k % 4])); }
        img.rect(x - 30, y - 50, 4, 50, H('#ffffff')); for (let yy = 0; yy < 50; yy += 6) img.rect(x - 30, y - 50 + yy, 4, 3, H('#ff3b3b'));
        img.rect(x - 34, y - 54, 12, 5, H('#e8e8f0'));
      }
      { // 눈사람
        const x = 380 + rnd() * 60, y = 840;
        img.circle(x, y, 16, ball('#ffffff', '#eef4fb', '#c9d8ec')); img.circle(x, y - 24, 11, ball('#ffffff', '#eef4fb', '#c9d8ec'));
        img.set(x - 4, y - 26, [20, 20, 30]); img.set(x + 4, y - 26, [20, 20, 30]); img.rect(x, y - 23, 5, 2, H('#ff8a1f'));
        img.rect(x - 10, y - 15, 20, 3, H('#e23a3a')); img.rect(x - 8, y - 40, 16, 6, H('#1b1d2a')); img.rect(x - 11, y - 35, 22, 2, H('#1b1d2a'));
      }
      for (let i = 0; i < 400; i++) img.set(rnd() * BW, rnd() * BH, [255, 255, 255]);
    },
  };

  function makeBackground(theme) {
    const img = Img(BW, BH);
    BG[theme](img, S.mulberry32(1234 + S.THEME_KEYS.indexOf(theme) * 99));
    return img.done();
  }
  // 위·아래 가장자리 평균색(구역 경계를 부드럽게 잇는 데 사용)
  function edgeColors(canvas) {
    const g = canvas.getContext('2d');
    const avg = (y0) => { const d = g.getImageData(0, y0, canvas.width, 6).data; let r = 0, gg = 0, b = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } return [r / n, gg / n, b / n].map(Math.round); };
    return { top: avg(0), bottom: avg(canvas.height - 6) };
  }

  /* ================= Phaser 텍스처 등록 ================= */
  function addCanvasTex(scene, key, canvas) {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
    return scene.textures.get(key);
  }
  function addSheet(scene, key, canvas, fw, fh, n) {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.addCanvas(key, canvas);
    for (let f = 0; f < n; f++) tex.add(f, 0, f * fw, 0, fw, fh);
  }

  function ensureSkin(scene, skin) {
    const key = 'char' + skin;
    if (scene.textures.exists(key)) return key;
    addSheet(scene, key, makeCharSheet(skin), FW, FH, FRAMES_N);
    const frames = (list) => list.map((f) => ({ key, frame: f }));
    scene.anims.create({ key: key + '_idle', frames: frames([0, 0, 1, 1]), frameRate: 4, repeat: -1 });
    scene.anims.create({ key: key + '_run', frames: frames([2, 3, 4, 5]), frameRate: 12, repeat: -1 });
    scene.anims.create({ key: key + '_jump', frames: frames([6]), frameRate: 1, repeat: -1 });
    scene.anims.create({ key: key + '_fall', frames: frames([7]), frameRate: 1, repeat: -1 });
    return key;
  }

  function ensurePlatform(scene, theme, w, variant = 0) {
    const key = `plat_${theme}_${w}_${variant}`;
    addCanvasTex(scene, key, makePlatform(theme, w, variant));
    return key;
  }

  function registerTextures(scene) {
    for (const [k, fn] of Object.entries(PARTICLES)) addCanvasTex(scene, k, fn());
    addCanvasTex(scene, 'gift', makeGift());
    addCanvasTex(scene, 'tree', makeTree());
    addSheet(scene, 'spring', makeSpring(), 16, 14, 2);
    addSheet(scene, 'bird', makeBird(), 9, 6, 2);
    if (!scene.anims.exists('bird_fly')) scene.anims.create({ key: 'bird_fly', frames: [{ key: 'bird', frame: 0 }, { key: 'bird', frame: 1 }], frameRate: 6, repeat: -1 });
    ['#ffb347', '#ff7f50', '#7fe0ff'].forEach((c, i) => addCanvasTex(scene, 'fish' + i, makeFish(c)));
    for (let i = 0; i < 3; i++) addCanvasTex(scene, 'cloud' + i, makeCloudSprite(50 + i));
    addSheet(scene, 'butterfly0', makeButterfly('#ff6fa8'), 9, 7, 2);
    addSheet(scene, 'butterfly1', makeButterfly('#ffb347'), 9, 7, 2);
    addSheet(scene, 'butterfly2', makeButterfly('#6bb8ff'), 9, 7, 2);
    for (let i = 0; i < 3; i++) if (!scene.anims.exists('flutter' + i)) scene.anims.create({ key: 'flutter' + i, frames: [{ key: 'butterfly' + i, frame: 0 }, { key: 'butterfly' + i, frame: 1 }], frameRate: 8, repeat: -1 });
    addCanvasTex(scene, 'balloon', makeBalloon());
    addCanvasTex(scene, 'sleigh', makeSleigh());
    ['#ff4d6d', '#4dc3ff', '#7dd87d', '#ffd23f'].forEach((c, i) => addCanvasTex(scene, 'gum' + i, makeGumdrop(c)));
  }

  // 배경은 필요할 때(가까워질 때) 하나씩 만든다 → 처음 로딩이 빠름
  const edgeCache = {};
  function ensureBg(scene, theme) {
    const key = 'bg_' + theme;
    if (!scene.textures.exists(key)) { const c = makeBackground(theme); edgeCache[theme] = edgeColors(c); scene.textures.addCanvas(key, c); }
    return key;
  }
  const bgEdges = (theme) => edgeCache[theme];

  root.PIXEL = { FW, FH, PLAT_H, SURF, BG_SCALE: 2, SKIN_COUNT: S.SKIN_COUNT, BODY, ACC, ACC_NAME, skinInfo, charSheet, drawCharPreview,
    makePlatform, makeBackground, makeGift, registerTextures, ensureSkin, ensurePlatform, ensureBg, bgEdges };
})(typeof self !== 'undefined' ? self : this);
