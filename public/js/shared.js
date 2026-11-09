/*
 * shared.js — 서버(Node)와 브라우저(게임·교사 화면)가 같이 쓰는 상수와 맵 생성기.
 * 같은 seed 를 넣으면 어디서든 똑같은 맵이 나오므로, 서버는 seed 하나만 보내면 된다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD_W = 960;          // 16:9 화면(960x540) 가로 폭 = 맵 폭
  const ZONE_H = 1800;          // 구역 하나의 높이(px)
  // ===== 맵(테마) 100개 =====
  // 손으로 그린 기본 맵 10개 × 색 변형 4가지 = 40개  +  상상 풍경 15가지 × 시간대 4가지 = 60개
  const BASES = {   // base: [발판 그림, 날리는 효과, 움직이는 소품, 미니맵 색]
    magma: ['magma', 'embers', null, '#c2410c'], water: ['water', 'bubbles', 'fish', '#1c6fb3'],
    flower: ['flower', 'petals', 'butterflies', '#f7a1c4'], ground: ['ground', 'leaves', 'birds', '#d9822b'],
    candy: ['candy', 'sprinkles', 'gums', '#ff8fc8'], oz: ['oz', 'poppies', 'balloon', '#2fbf71'],
    sky: ['sky', 'snow', 'clouds', '#4a86d4'], star: ['star', 'stars', null, '#6b4fc0'],
    space: ['space', 'space', null, '#12124a'], xmas: ['xmas', 'xmas', 'sleigh', '#e23a3a'],
  };
  const BASE_HUES = [0, 140, 200, 285];
  const ARCHES = {  // 상상 풍경: [발판, 발판 색 회전, 효과, 소품, 미니맵 색]
    desert: ['oz', 0, 'dust', 'birds', '#e0b060'], jungle: ['flower', 40, 'leaves', 'butterflies', '#2e8b3a'],
    crystal: ['star', 160, 'stars', null, '#5fd0e0'], ice: ['sky', 0, 'snow', null, '#bfe8ff'],
    mushroom: ['flower', 250, 'fireflies', 'butterflies', '#c060c0'], city: ['space', 0, 'stars', null, '#3a4a7a'],
    beach: ['water', 0, 'petals', 'birds', '#40c0d0'], castle: ['sky', 0, 'stars', 'clouds', '#c8d8ff'],
    volcano: ['magma', 0, 'embers', null, '#a03018'], haunted: ['ground', 250, 'fireflies', 'birds', '#5a3a8a'],
    dino: ['ground', 60, 'leaves', 'birds', '#6a9a3a'], toy: ['candy', 120, 'sprinkles', 'gums', '#ff9a3c'],
    balloon: ['sky', 0, 'petals', 'balloon', '#9fd8ff'], music: ['star', 0, 'stars', 'butterflies', '#e090ff'],
    lantern: ['oz', 0, 'fireflies', null, '#ff9a3c'],
  };
  const PALS = ['day', 'sunset', 'night', 'pastel'];
  const THEMES = [];
  for (const [base, [plat, fx, amb, color]] of Object.entries(BASES)) {
    BASE_HUES.forEach((hue, i) => THEMES.push({ id: `${base}${i}`, kind: 'base', base, hue, plat, platHue: hue, fx, amb, color: hueRotate(color, hue) }));
  }
  for (const [arch, [plat, platHue, fx, amb, color]] of Object.entries(ARCHES)) {
    PALS.forEach((pal, i) => THEMES.push({ id: `${arch}${i}`, kind: 'land', arch, pal, hue: 0, plat, platHue, fx: pal === 'night' && fx !== 'embers' ? 'fireflies' : fx, amb, color: pal === 'night' ? '#1a2050' : color }));
  }
  const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
  const CYCLE = 10;                  // 10구역마다 크리스마스 트리 기념 지점

  function hueRotate(hex, deg) {
    if (!deg) return hex;
    let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
    }
    h = (h + deg / 360) % 1;
    const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return '#' + [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }
  const THEME_KEYS = THEMES.map((t) => t.id);
  // 무한 타워: 바닥이 y=0 근처이고 위로 갈수록 y 가 음수로 커진다. 구역 z 는 [-(z+1)·ZONE_H, -z·ZONE_H]
  const FLOOR_Y = -32;               // 맨 아래 바닥의 윗면 y
  const TOP_LIMIT = -50_000_000;     // 사실상 무제한(약 500만 m)

  const PHYS = { gravity: 1300, speed: 250, jump: 640, djump: 580, spring: 1080 };
  const NET = { tickHz: 20, sendHz: 15, interpDelay: 120 };
  const SKIN_COUNT = 30;
  const GAME = {
    quizEvery: 30,          // 초: 이 시간 동안 퀴즈를 안 풀면 자동으로 퀴즈가 뜬다
    energyDrain: 1.5,       // 초당 에너지 감소(0이 되면 더블점프 불가)
    energyPerCorrect: 30,
    pointsPerCorrect: 30,
    giftRespawnMs: 20000,
    lives: 3,               // 생명(❤️) 개수 — 크게 떨어지면 1개 써서 원래 자리로, 퀴즈 정답이면 +1(최대)
    bigFall: 900,           // 이 높이(px) 이상 바닥보다 위에서 떨어지면 '추락 장면'
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function zoneOf(y) { return Math.max(0, Math.floor(-y / ZONE_H)); }
  function zoneTop(z) { return -(z + 1) * ZONE_H; }
  function zoneBottom(z) { return -z * ZONE_H; }
  function heightOf(y) { return Math.max(0, Math.round((FLOOR_Y - 30 - y) / 10)); } // 1m = 10px
  const hash = (seed, z, salt) => (Math.imul(seed ^ salt, 0x9e3779b1) ^ Math.imul(z + 1, 0x85ebca6b)) >>> 0;

  // 맵 100개를 판(seed)마다 섞어서 순서대로 쓰고, 100구역을 넘으면 다시 섞어서 끝없이 이어 간다
  const orderCache = new Map();
  function blockOrder(seed, c) {
    const key = seed + ':' + c;
    if (orderCache.has(key)) return orderCache.get(key);
    const rnd = mulberry32(hash(seed, c, 0x51ed270b));
    const ids = THEME_KEYS.slice();
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    if (orderCache.size > 50) orderCache.clear();
    orderCache.set(key, ids);
    return ids;
  }
  function themeOf(seed, z) { const n = THEMES.length; return THEME_BY_ID[blockOrder(seed, Math.floor(z / n))[z % n]]; }

  // 난이도: 처음 12구역 동안 점점 어려워지고 그 뒤로는 유지(한 번 점프 높이 158px 안에서)
  const WIDTHS = [[128, 128, 96], [128, 96, 96], [96, 96, 128, 64], [96, 64, 64], [64, 96, 64]];
  const diffOf = (z) => Math.min(1, z / 12);
  const widthsOf = (z) => WIDTHS[Math.min(4, Math.floor(diffOf(z) * 5))];
  const CP_W = 288;
  function checkpointX(seed, z) {
    if (z === 0) return WORLD_W / 2;
    const rnd = mulberry32(hash(seed, z, 0x2545f491));
    return Math.round(CP_W / 2 + 16 + rnd() * (WORLD_W - CP_W - 32));
  }
  const checkpointY = (z) => (z === 0 ? FLOOR_Y : zoneBottom(z) - 40);

  // 구역 하나를 seed 와 z 만으로 만든다 → 서버·학생·교사 화면 어디서든 같은 결과, 필요한 구역만 생성
  const zoneCache = new Map();
  function buildZone(seed, z) {
    const key = seed + ':' + z;
    if (zoneCache.has(key)) return zoneCache.get(key);
    const rnd = mulberry32(hash(seed, z, 0x1b873593));
    const rnd2 = mulberry32(hash(seed, z, 0x9e3779b9));
    const r = (a, b) => a + rnd() * (b - a);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const theme = themeOf(seed, z);
    const platforms = [], gifts = [], springs = [];
    const cpx = checkpointX(seed, z), cpy = checkpointY(z);
    if (z === 0) platforms.push({ x: 0, y: FLOOR_Y, w: WORLD_W, kind: 'floor' });
    else platforms.push({ x: Math.round(cpx - CP_W / 2), y: cpy, w: CP_W, kind: 'checkpoint' });
    const target = checkpointY(z + 1), nextCx = checkpointX(seed, z + 1);
    const gmin = 92 + diffOf(z) * 22, gmax = 116 + diffOf(z) * 22;
    let y = cpy, prevCx = cpx, row = 0;
    while (y - target > gmax) {
      let gap = r(gmin, gmax);
      if (y - gap - target < 70) gap = (y - target) / 2;
      y -= gap; row++;
      const w = pick(widthsOf(z));
      let cx = clamp(prevCx + r(-200, 200), w / 2 + 8, WORLD_W - w / 2 - 8);
      const left = y - target;
      if (left <= gmax) cx = clamp(nextCx + r(-110, 110), w / 2 + 8, WORLD_W - w / 2 - 8);   // 마지막 줄은 다음 체크포인트 바로 아래
      else if (left < 420) cx = clamp(cx + (nextCx - cx) * (left < 200 ? 0.8 : 0.45), w / 2 + 8, WORLD_W - w / 2 - 8);   // 다음 체크포인트 쪽으로
      cx = clamp(cx, prevCx - 200, prevCx + 200);   // 바로 아래 발판에서 닿을 수 있게
      const main = { x: Math.round(cx - w / 2), y: Math.round(y), w, kind: 'main' };
      platforms.push(main);
      if (row % 6 === 0) gifts.push({ id: z * 100 + row, x: Math.round(cx), y: Math.round(y) - 16 });
      if (row % 7 === 3 && w >= 96) springs.push({ x: Math.round(rnd2() < 0.5 ? main.x + 16 : main.x + w - 16), y: main.y });
      if (rnd() < 0.45) {   // 갈림길
        const w2 = pick([64, 96]);
        let cx2 = r(w2 / 2 + 8, WORLD_W - w2 / 2 - 8);
        if (Math.abs(cx2 - cx) < 220) cx2 = cx2 < cx ? Math.max(w2 / 2 + 8, cx - 260) : Math.min(WORLD_W - w2 / 2 - 8, cx + 260);
        if (Math.abs(cx2 - cx) > w / 2 + w2 / 2 + 20) {
          const side = { x: Math.round(cx2 - w2 / 2), y: Math.round(y + r(-20, 20)), w: w2, kind: 'side' };
          platforms.push(side);
          if (rnd2() < 0.22) springs.push({ x: side.x + Math.round(w2 / 2), y: side.y });
        }
      }
      prevCx = cx;
    }
    // 10구역마다(다음 바퀴 첫 체크포인트) 크리스마스 트리 기념 지점
    const tree = z > 0 && z % CYCLE === 0 ? { x: cpx + (cpx < WORLD_W / 2 ? 100 : -100), y: cpy, n: z / CYCLE } : null;
    const out = { z, theme, platforms, gifts, springs, checkpoint: { x: cpx, y: cpy }, tree };
    if (zoneCache.size > 400) zoneCache.clear();
    zoneCache.set(key, out);
    return out;
  }

  return { WORLD_W, ZONE_H, THEMES, THEME_BY_ID, THEME_KEYS, CYCLE, hueRotate, FLOOR_Y, TOP_LIMIT, PHYS, NET, SKIN_COUNT, GAME,
    mulberry32, clamp, zoneOf, heightOf, zoneTop, zoneBottom, themeOf, buildZone, diffOf };
});
