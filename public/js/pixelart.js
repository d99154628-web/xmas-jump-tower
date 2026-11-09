/*
 * pixelart.js — 모든 그래픽을 코드로 그리는 도트(픽셀) 아트 생성기.
 * 이미지 파일을 내려받을 필요가 없어 로딩이 빠르고 저작권 걱정도 없다.
 * 저해상도로 그린 뒤 Phaser 의 pixelArt 모드로 확대해서 또렷한 도트 느낌을 낸다.
 */
(function (root) {
  'use strict';
  const S = root.SHARED;

  const FW = 16, FH = 20, FRAMES_N = 7;   // 캐릭터 한 프레임 크기 / 프레임 수
  const hexToRgb = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const rgbToHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const darken = (h, f) => rgbToHex(hexToRgb(h).map((v) => v * f));
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ---------------- 캐릭터(동글동글 햄스터) ---------------- */
  const BODY = [
    ['#f4a259', '#fff1d6'], ['#f2d7a7', '#fffaf0'], ['#a8a8b8', '#ececf4'], ['#a0673c', '#f0d2b0'], ['#e8e8ee', '#ffffff'],
    ['#f7a1c4', '#ffe3ef'], ['#7fd8be', '#e2fff6'], ['#7ab8f5', '#e3f1ff'], ['#f5d94e', '#fff8d1'], ['#b79cf0', '#efe7ff'],
  ];
  const ACC = ['santa', 'antler', 'scarf'];
  const ACC_NAME = { santa: '산타 모자', antler: '루돌프', scarf: '목도리' };
  const skinInfo = (i) => ({ pal: BODY[i % 10], acc: ACC[Math.floor(i / 10) % 3] });

  const BODY_ROWS = [
    '................',
    '................',
    '...OO......OO...',
    '..OBBO....OBBO..',
    '..OBBBOOOOBBBO..',
    '.OBBBBBBBBBBBBO.',
    '.OBBBBBBBBBBBBO.',
    'OBBBEWBBBBEWBBBO',
    'OBBBEEBBBBEEBBBO',
    'OBPPBBBLLBBBPPBO',
    'OBBBBBLLLLBBBBBO',
    'OBBBBLLLLLLBBBBO',
    'OBBBBLLLLLLBBBBO',
    '.OBBBLLLLLLBBBO.',
    '.OBBBBLLLLBBBBO.',
    '..OOBBBBBBBBOO..',
  ];
  const FEET = {
    stand: ['...OFFO..OFFO...', '....OO....OO....'],
    A: ['..OFFO...OFFO...', '...OO.....OO....'],
    B: ['...OFFO...OFFO..', '....OO.....OO...'],
    T: ['....OFFOOFFO....', '.....OO..OO.....'],
    J: ['....OFFOOFFO....', '................'],
  };
  // 0~1 idle(숨쉬기), 2~5 run, 6 jump.  b: 몸 y이동, f: 발 y이동
  const FRAMES = [
    { b: 0, f: 0, feet: 'stand' }, { b: 1, f: 0, feet: 'stand' },
    { b: 0, f: 0, feet: 'A' }, { b: -1, f: -1, feet: 'T' }, { b: 0, f: 0, feet: 'B' }, { b: -1, f: -1, feet: 'T' },
    { b: -1, f: -1, feet: 'J' },
  ];
  const ACC_PARTS = {
    santa: [{ y: 0, rows: ['..........WW....', '......RRRRWW....', '.....RRRRRR.....', '....RRRRRRRR....', '...WWWWWWWWWW...'] }],
    antler: [
      { y: 0, rows: ['.A.A.......A.A..', '.AAA.......AAA..', '..A.........A...'] },
      { y: 9, rows: ['.......NN.......'] },
    ],
    scarf: [{ y: 11, rows: ['.GGGRGGGRGGGRGG.', '..........GG....', '..........GR....'] }],
  };

  function colorMap(skin) {
    const { pal } = skinInfo(skin);
    return { O: '#2b1d2e', B: pal[0], L: pal[1], E: '#1a1020', W: '#ffffff', P: '#ff7b9c', F: darken(pal[0], 0.68),
      R: '#e23a3a', A: '#7a4a22', N: '#ff3030', G: '#2e9e4f', Y: '#ffd23f', D: '#a8232a' };
  }

  function paintRows(g, ox, oy, rows, cmap) {
    for (let ry = 0; ry < rows.length; ry++) {
      const row = rows[ry];
      for (let x = 0; x < row.length; x++) {
        const c = cmap[row[x]];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(ox + x, oy + ry, 1, 1);
      }
    }
  }

  function drawCharFrame(g, ox, oy, skin, frame) {
    const cm = colorMap(skin);
    const fr = FRAMES[frame];
    const feet = FEET[fr.feet];
    const top = oy + 2;   // 위쪽 2px 여유(모자 자리)
    if (fr.b > 0) { paintRows(g, ox, top + 16 + fr.f, feet, cm); paintRows(g, ox, top + fr.b, BODY_ROWS, cm); }
    else { paintRows(g, ox, top + fr.b, BODY_ROWS, cm); paintRows(g, ox, top + 16 + fr.f, feet, cm); }
    for (const part of ACC_PARTS[skinInfo(skin).acc]) paintRows(g, ox, top + fr.b + part.y, part.rows, cm);
  }

  function makeCharSheet(skin) {
    const c = makeCanvas(FW * FRAMES_N, FH);
    const g = c.getContext('2d');
    for (let f = 0; f < FRAMES_N; f++) drawCharFrame(g, f * FW, 0, skin, f);
    return c;
  }

  const sheetCache = new Map();
  function charSheet(skin) { if (!sheetCache.has(skin)) sheetCache.set(skin, makeCharSheet(skin)); return sheetCache.get(skin); }

  function drawCharPreview(canvas, skin, scale = 3, frame = 0) {
    canvas.width = FW * scale; canvas.height = FH * scale;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(charSheet(skin), frame * FW, 0, FW, FH, 0, 0, FW * scale, FH * scale);
  }

  /* ---------------- 작은 스프라이트 ---------------- */
  const GIFT_ROWS = [
    '................', '.....YY..YY.....', '......YYYY......', '.OOOOOOGGOOOOOO.', '.ORRRRRGGRRRRRO.', '.OOOOOOGGOOOOOO.',
    '..ORRRRGGRRRRO..', '..ORRRRGGRRRRO..', '..OGGGGGGGGGGO..', '..ORRRRGGRRRRO..', '..ORRRRGGRRRRO..', '..ORRRRGGRDRRO..',
    '..ODDDDGGDDDDO..', '..OOOOOOOOOOOO..', '................', '................',
  ];
  function makeGift() { const c = makeCanvas(16, 16); paintRows(c.getContext('2d'), 0, 0, GIFT_ROWS, colorMap(0)); return c; }

  function makeTree() {
    const W = 24, H = 34;
    const c = makeCanvas(W, H); const g = c.getContext('2d');
    const rnd = S.mulberry32(77);
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    const tiers = [[6, 12, 1, 5], [11, 20, 3, 8], [18, 29, 5, 11]];
    for (const [y0, y1, w0, w1] of tiers) {
      for (let y = y0; y <= y1; y++) {
        const hw = Math.round(w0 + (w1 - w0) * (y - y0) / (y1 - y0));
        for (let x = 12 - hw; x < 12 + hw; x++) px(x, y, x < 12 - hw + 2 ? '#145c2b' : (y === y1 ? '#1a6b33' : '#1f8a40'));
      }
    }
    const orn = ['#ff3b3b', '#ffd23f', '#4dc3ff', '#ff7bd5', '#ffffff'];
    for (let i = 0; i < 16; i++) {
      const y = 8 + Math.floor(rnd() * 21);
      const t = tiers.find(([a, b]) => y >= a && y <= b) || tiers[2];
      const hw = Math.round(t[2] + (t[3] - t[2]) * (y - t[0]) / (t[1] - t[0]));
      px(12 - hw + 1 + Math.floor(rnd() * Math.max(1, hw * 2 - 2)), y, orn[i % orn.length]);
    }
    g.fillStyle = '#6b3e1e'; g.fillRect(10, 30, 4, 4);
    // 별
    g.fillStyle = '#ffd23f';
    g.fillRect(11, 0, 2, 6); g.fillRect(9, 2, 6, 2);
    px(10, 1, '#fff6a8'); px(13, 4, '#fff6a8');
    return c;
  }

  function makeDot(w, h, painter) { const c = makeCanvas(w, h); painter(c.getContext('2d')); return c; }
  const PARTICLES = {
    p_ember: () => makeDot(2, 2, (g) => { g.fillStyle = '#ffb347'; g.fillRect(0, 0, 2, 2); g.fillStyle = '#fff1a8'; g.fillRect(0, 0, 1, 1); }),
    p_bubble: () => makeDot(5, 5, (g) => { g.fillStyle = '#c8f4ff'; g.fillRect(1, 0, 3, 1); g.fillRect(1, 4, 3, 1); g.fillRect(0, 1, 1, 3); g.fillRect(4, 1, 1, 3); g.fillStyle = '#ffffff'; g.fillRect(1, 1, 1, 1); }),
    p_petal: () => makeDot(3, 2, (g) => { g.fillStyle = '#ffb7c5'; g.fillRect(0, 0, 3, 2); g.fillStyle = '#ff8fab'; g.fillRect(2, 1, 1, 1); }),
    p_leaf: () => makeDot(3, 3, (g) => { g.fillStyle = '#e8762b'; g.fillRect(0, 1, 3, 1); g.fillRect(1, 0, 1, 3); g.fillStyle = '#f2b134'; g.fillRect(1, 1, 1, 1); }),
    p_snow: () => makeDot(2, 2, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 2, 2); }),
    p_star: () => makeDot(3, 3, (g) => { g.fillStyle = '#fff6a8'; g.fillRect(1, 0, 1, 3); g.fillRect(0, 1, 3, 1); }),
    p_puff: () => makeDot(3, 3, (g) => { g.fillStyle = '#ffffff'; g.fillRect(1, 0, 1, 3); g.fillRect(0, 1, 3, 1); }),
    p_conf: () => makeDot(2, 2, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 2, 2); }),
  };

  /* ---------------- 발판(구역별) ---------------- */
  function makePlatform(zone, w) {
    const c = makeCanvas(w, 16); const g = c.getContext('2d');
    const rnd = S.mulberry32(zone * 7919 + w);
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    const fill = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); };
    if (zone === 0) {               // 마그마: 현무암 + 빛나는 균열
      fill(0, 0, w, 16, '#3b2626'); fill(0, 0, w, 2, '#6e4a3c'); fill(0, 15, w, 1, '#1a0f0f');
      for (let i = 0; i < w / 3; i++) px(Math.floor(rnd() * w), 3 + Math.floor(rnd() * 11), '#2a1818');
      for (let k = 0; k < Math.max(1, w / 24); k++) {
        let x = Math.floor(rnd() * w), y = 4;
        for (let s = 0; s < 8; s++) { px(x, y, '#ff7a1a'); if (s === 3) px(x, y, '#ffd23f'); y++; x += Math.floor(rnd() * 3) - 1; if (y > 13) break; }
      }
    } else if (zone === 1) {        // 바닷속(봄): 모래 + 분홍 산호꽃
      fill(0, 0, w, 16, '#d9a066'); fill(0, 0, w, 3, '#f5d6a0'); fill(0, 15, w, 1, '#7a5230');
      for (let i = 0; i < w / 3; i++) px(Math.floor(rnd() * w), 4 + Math.floor(rnd() * 10), '#c48a52');
      for (let x = 2; x < w - 2; x += 5 + Math.floor(rnd() * 6)) { px(x, 0, '#ff8fab'); px(x + 1, 0, '#ffc2d1'); px(x, 1, '#ff8fab'); }
    } else if (zone === 2) {        // 땅(가을): 흙 + 단풍 풀
      fill(0, 0, w, 16, '#8d5a2b'); fill(0, 15, w, 1, '#4a2e14');
      for (let x = 0; x < w; x++) for (let y = 0; y < 4; y++) {
        const r = rnd(); px(x, y, y === 3 ? '#5f7d1e' : r < 0.35 ? '#e8a33d' : r < 0.55 ? '#d9622b' : '#7cb342');
      }
      for (let i = 0; i < w / 4; i++) px(Math.floor(rnd() * w), 5 + Math.floor(rnd() * 9), '#6e4420');
    } else if (zone === 3) {        // 하늘(겨울): 눈 구름
      for (let x = 0; x < w; x++) {
        const bump = Math.round(1.5 + Math.sin(x / 5 + rnd()) * 1.5);
        fill(x, bump, 1, 13 - bump, '#ffffff');
        fill(x, 11, 1, 3, '#d6e6ff');
        px(x, 14, '#9cc3e6');
      }
      for (let i = 0; i < w / 6; i++) px(Math.floor(rnd() * w), 3 + Math.floor(rnd() * 7), '#e6f2ff');
    } else {                        // 우주(크리스마스): 금속 + 전구 장식
      fill(0, 0, w, 16, '#59607e'); fill(0, 0, w, 2, '#aeb8de'); fill(0, 2, w, 1, '#7d86a8'); fill(0, 15, w, 1, '#2b2f45');
      fill(0, 4, w, 1, '#1b1d2a');
      const bulbs = ['#ff4d4d', '#4dff88', '#ffd84d', '#4dc3ff'];
      for (let x = 3, i = 0; x < w - 2; x += 8, i++) { px(x, 5, bulbs[i % 4]); px(x, 6, bulbs[i % 4]); }
      for (let x = 8; x < w - 4; x += 16) px(x, 10, '#c9d1f0');
    }
    // 둥근 모서리
    g.clearRect(0, 0, 1, 1); g.clearRect(w - 1, 0, 1, 1); g.clearRect(0, 15, 1, 1); g.clearRect(w - 1, 15, 1, 1);
    return c;
  }

  /* ---------------- 배경(구역별, 240x450 → 4배 확대) ---------------- */
  const BW = 240, BH = 450;
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

  function Img(w, h) {
    const c = makeCanvas(w, h); const g = c.getContext('2d');
    const id = g.createImageData(w, h); const d = id.data;
    const api = {
      w, h,
      set(x, y, col) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; },
      blend(x, y, col, a) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; d[i] += (col[0] - d[i]) * a; d[i + 1] += (col[1] - d[i + 1]) * a; d[i + 2] += (col[2] - d[i + 2]) * a; },
      rect(x, y, rw, rh, col) { for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) api.set(xx, yy, col); },
      circle(cx, cy, r, col) { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r + r * 0.6) api.set(cx + xx, cy + yy, col); },
      ring(cx, cy, r, col) { for (let a = 0; a < 6.283; a += 0.25) api.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), col); },
      done() { g.putImageData(id, 0, 0); return c; },
    };
    return api;
  }

  // 여러 색 띠를 나누고, 띠 경계만 바이어 디더링 → 도트 그라데이션
  function gradient(img, hexStops, y0 = 0, y1 = img.h) {
    const stops = hexStops.map(hexToRgb);
    const bands = 18;
    const cols = [];
    for (let b = 0; b <= bands; b++) {
      const t = (b / bands) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      cols.push(mixRgb(stops[i], stops[i + 1], t - i).map(Math.round));
    }
    for (let y = y0; y < y1; y++) {
      const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * bands;
      const bi = Math.min(bands - 1, Math.floor(t));
      const frac = t - bi;
      for (let x = 0; x < img.w; x++) {
        const th = (BAYER[y & 3][x & 3] + 0.5) / 16;
        img.set(x, y, frac > 0.6 && (frac - 0.6) / 0.4 > th ? cols[bi + 1] : cols[bi]);
      }
    }
  }

  function cloud(img, cx, cy, s, col, shade) {
    img.circle(cx, cy, s, col); img.circle(cx - s, cy + 2, Math.round(s * 0.7), col); img.circle(cx + s, cy + 2, Math.round(s * 0.75), col);
    for (let x = cx - s * 2; x < cx + s * 2; x++) img.set(x, cy + Math.round(s * 0.8) + 1, shade);
  }

  const BG = [
    function magma(img, rnd) {
      gradient(img, ['#1a0505', '#3a0b0b', '#5c1408', '#8a2a0a', '#b8420c']);
      const rock = hexToRgb('#260808'), edge = hexToRgb('#3d0f0a');
      for (let i = 0; i < 9; i++) {           // 아래에서 솟은 바위 기둥
        const x0 = Math.floor(rnd() * BW), w = 8 + Math.floor(rnd() * 18), hgt = 60 + Math.floor(rnd() * 170);
        for (let y = BH - hgt; y < BH; y++) {
          const shrink = Math.max(0, Math.round((BH - hgt + 14 - y) / 3));
          for (let x = x0 + shrink; x < x0 + w - shrink; x++) img.set(x, y, x === x0 + shrink ? edge : rock);
        }
      }
      for (let i = 0; i < 10; i++) {          // 위에서 내려온 종유석
        const x0 = Math.floor(rnd() * BW), w = 6 + Math.floor(rnd() * 10), hgt = 20 + Math.floor(rnd() * 60);
        for (let y = 0; y < hgt; y++) { const hw = Math.round((w / 2) * (1 - y / hgt)); for (let x = x0 - hw; x <= x0 + hw; x++) img.set(x, y, rock); }
      }
      const lava = hexToRgb('#ff6a00'), lavaTop = hexToRgb('#ffd23f');
      for (let x = 0; x < BW; x++) {
        const top = Math.round(428 + Math.sin(x / 9) * 3);
        for (let y = top; y < BH; y++) img.set(x, y, y === top ? lavaTop : lava);
      }
      for (let i = 0; i < 90; i++) img.set(rnd() * BW, 200 + rnd() * 230, hexToRgb(rnd() < 0.5 ? '#ff9a3c' : '#ffd23f'));
    },
    function water(img, rnd) {
      gradient(img, ['#3aa6e0', '#1f7fc4', '#155fa0', '#0e3f7a', '#082a5a']);
      const white = [255, 255, 255];
      for (let r = 0; r < 6; r++) {            // 위에서 비치는 햇살
        const x0 = rnd() * BW, wdt = 6 + rnd() * 10;
        for (let y = 0; y < 300; y++) for (let x = 0; x < wdt; x++) img.blend(x0 + x + y * 0.35, y, white, 0.07 * (1 - y / 300));
      }
      const sand = hexToRgb('#c9a66b');
      for (let x = 0; x < BW; x++) { const top = Math.round(432 + Math.sin(x / 13) * 3); for (let y = top; y < BH; y++) img.set(x, y, sand); }
      for (let i = 0; i < 14; i++) {           // 미역
        const x0 = rnd() * BW, hgt = 60 + rnd() * 120, ph = rnd() * 6;
        for (let y = 0; y < hgt; y++) {
          const x = x0 + Math.sin(y / 8 + ph) * 3;
          const col = hexToRgb(y > hgt - 10 ? '#3cc47f' : '#1f8f5f');
          img.set(x, 434 - y, col); img.set(x + 1, 434 - y, col);
        }
      }
      for (let i = 0; i < 9; i++) {            // 봄 느낌의 분홍 산호꽃
        const cx = rnd() * BW, cy = 418 + rnd() * 12;
        img.circle(cx, cy, 3 + Math.floor(rnd() * 3), hexToRgb('#ff8fab'));
        img.circle(cx + 3, cy - 3, 2, hexToRgb('#ffc2d1'));
      }
      for (let i = 0; i < 7; i++) {            // 물고기
        const fx = rnd() * BW, fy = 60 + rnd() * 300, col = hexToRgb(rnd() < 0.5 ? '#ffb347' : '#ff7f50');
        img.rect(fx, fy, 5, 3, col); img.set(fx - 1, fy, col); img.set(fx - 1, fy + 2, col); img.set(fx + 3, fy, [20, 20, 30]);
      }
      for (let i = 0; i < 45; i++) img.ring(rnd() * BW, rnd() * BH, 1 + Math.floor(rnd() * 2), hexToRgb('#bff0ff'));
    },
    function ground(img, rnd) {
      gradient(img, ['#4aa3e8', '#6cb8ef', '#8fcbf3', '#b5ddf6'], 0, 340);
      for (let i = 0; i < 6; i++) cloud(img, rnd() * BW, 30 + rnd() * 220, 5 + Math.floor(rnd() * 5), [255, 255, 255], hexToRgb('#dfeeff'));
      const hill1 = hexToRgb('#c49a50'), hill2 = hexToRgb('#d97b2b'), grass = hexToRgb('#6b8e23'), dirt = hexToRgb('#7a4a22');
      for (let x = 0; x < BW; x++) {
        const h1 = Math.round(330 + Math.sin(x / 30) * 12 + Math.sin(x / 11) * 4);
        const h2 = Math.round(368 + Math.sin(x / 22 + 1) * 10);
        for (let y = h1; y < BH; y++) img.set(x, y, hill1);
        for (let y = h2; y < BH; y++) img.set(x, y, hill2);
        for (let y = 400; y < BH; y++) img.set(x, y, y > 432 ? dirt : grass);
      }
      const canopy = ['#e8762b', '#d94f2b', '#f2b134', '#c9562c'];
      for (let i = 0; i < 7; i++) {            // 단풍나무
        const tx = 10 + rnd() * (BW - 20), r = 9 + Math.floor(rnd() * 6);
        img.rect(tx - 1, 380, 3, 22, hexToRgb('#6b3e1e'));
        img.circle(tx, 378 - r / 2, r, hexToRgb(canopy[i % 4]));
        for (let k = 0; k < 12; k++) img.set(tx - r + rnd() * r * 2, 378 - r / 2 - r + rnd() * r * 2, hexToRgb('#ffd27a'));
      }
      for (let i = 0; i < 5; i++) { const bx = rnd() * BW, by = 40 + rnd() * 200, c = [60, 50, 60]; img.set(bx, by, c); img.set(bx + 1, by + 1, c); img.set(bx + 2, by, c); }
    },
    function sky(img, rnd) {
      gradient(img, ['#24346e', '#3a5aa8', '#5b86cf', '#86b4ea', '#b7d8f6']);
      for (let i = 0; i < 30; i++) img.set(rnd() * BW, rnd() * 90, hexToRgb('#cfe0ff'));
      const mount = hexToRgb('#7f9cc4');
      for (let m = 0; m < 6; m++) {            // 눈 덮인 산
        const cx = rnd() * BW, peak = 360 + rnd() * 50, half = 30 + rnd() * 30;
        for (let y = Math.round(peak); y < BH; y++) {
          const hw = ((y - peak) / (BH - peak)) * half * 1.6;
          for (let x = cx - hw; x <= cx + hw; x++) img.set(x, y, y < peak + 10 ? [255, 255, 255] : mount);
        }
      }
      for (let i = 0; i < 11; i++) cloud(img, rnd() * BW, 60 + rnd() * 320, 6 + Math.floor(rnd() * 6), [255, 255, 255], hexToRgb('#dfeeff'));
      for (let i = 0; i < 160; i++) img.set(rnd() * BW, rnd() * BH, [255, 255, 255]);
    },
    function space(img, rnd) {
      gradient(img, ['#020208', '#05051a', '#0b0b2e', '#141448', '#1f1f5c']);
      const neb = [hexToRgb('#3b1f6e'), hexToRgb('#1f3b6e'), hexToRgb('#4a1f4e')];
      for (let n = 0; n < 4; n++) {           // 성운(디더링)
        const cx = rnd() * BW, cy = rnd() * BH, r = 30 + rnd() * 40, col = neb[n % 3];
        for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) {
          const d = Math.hypot(x - cx, y - cy) / r;
          if (d < 1 && (1 - d) * 16 > BAYER[y & 3][x & 3] + 6) img.set(x, y, col);
        }
      }
      const starCols = ['#ffffff', '#fff6a8', '#a8d8ff', '#ffc8f0'];
      for (let i = 0; i < 320; i++) img.set(rnd() * BW, rnd() * BH, hexToRgb(starCols[i % 4]));
      for (let i = 0; i < 18; i++) { const x = rnd() * BW, y = rnd() * BH, c = hexToRgb(starCols[i % 4]); img.set(x, y, c); img.set(x - 1, y, c); img.set(x + 1, y, c); img.set(x, y - 1, c); img.set(x, y + 1, c); }
      const px = 40 + rnd() * 160, py = 260 + rnd() * 120;   // 고리 행성
      img.circle(px, py, 18, hexToRgb('#e0a060'));
      for (let y = -18; y <= 18; y += 5) for (let x = -18; x <= 18; x++) if (x * x + y * y < 324) img.set(px + x, py + y, hexToRgb('#c07040'));
      for (let x = -32; x <= 32; x++) { const y = Math.round(x * 0.18); img.set(px + x, py + y, hexToRgb('#f0d090')); img.set(px + x, py + y + 1, hexToRgb('#c8a060')); }
      const mx = 30 + rnd() * 180, my = 80 + rnd() * 100;      // 달
      img.circle(mx, my, 11, hexToRgb('#d8d8e8'));
      img.circle(mx - 3, my - 2, 2, hexToRgb('#b0b0c8')); img.circle(mx + 4, my + 3, 3, hexToRgb('#b0b0c8'));
    },
  ];

  function makeBackground(zone) {
    const img = Img(BW, BH);
    BG[zone](img, S.mulberry32(1234 + zone * 99));
    return img.done();
  }

  /* ---------------- Phaser 텍스처 등록 ---------------- */
  function addCanvasTex(scene, key, canvas) {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
    return scene.textures.get(key);
  }

  function ensureSkin(scene, skin) {
    const key = 'char' + skin;
    if (scene.textures.exists(key)) return key;
    const tex = scene.textures.addCanvas(key, makeCharSheet(skin));
    for (let f = 0; f < FRAMES_N; f++) tex.add(f, 0, f * FW, 0, FW, FH);
    const frames = (list) => list.map((f) => ({ key, frame: f }));
    scene.anims.create({ key: key + '_idle', frames: frames([0, 1]), frameRate: 2.5, repeat: -1 });
    scene.anims.create({ key: key + '_run', frames: frames([2, 3, 4, 5]), frameRate: 11, repeat: -1 });
    scene.anims.create({ key: key + '_jump', frames: frames([6]), frameRate: 1, repeat: -1 });
    return key;
  }

  function ensurePlatform(scene, zone, w) {
    const key = `plat_${zone}_${w}`;
    addCanvasTex(scene, key, makePlatform(zone, w));
    return key;
  }

  function registerTextures(scene) {
    for (const [k, fn] of Object.entries(PARTICLES)) addCanvasTex(scene, k, fn());
    addCanvasTex(scene, 'gift', makeGift());
    addCanvasTex(scene, 'tree', makeTree());
    for (let z = 0; z < S.ZONES.length; z++) addCanvasTex(scene, 'bg' + z, makeBackground(z));
  }

  root.PIXEL = { FW, FH, SKIN_COUNT: S.SKIN_COUNT, BODY, ACC, ACC_NAME, skinInfo, charSheet, drawCharPreview,
    makePlatform, makeBackground, makeGift, registerTextures, ensureSkin, ensurePlatform };
})(typeof self !== 'undefined' ? self : this);
