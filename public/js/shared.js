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
  // 테마(구역) 10개. 판마다 순서를 섞고, 맨 위는 언제나 산타 마을(크리스마스 트리 골인)
  const THEMES = {
    magma:  { name: '용암 동굴',     emoji: '🌋', season: '부글부글 불씨',   color: '#c2410c' },
    water:  { name: '바닷속 왕국',   emoji: '🌊', season: '봄 산호',         color: '#1c6fb3' },
    flower: { name: '꽃나라',         emoji: '🌸', season: '봄바람 꽃잎',     color: '#f7a1c4' },
    ground: { name: '단풍 마을',     emoji: '🍂', season: '가을',            color: '#d9822b' },
    candy:  { name: '과자나라',       emoji: '🍭', season: '달콤 스프링클',   color: '#ff8fc8' },
    oz:     { name: '오즈의 마법사', emoji: '🌈', season: '노란 벽돌길',     color: '#2fbf71' },
    sky:    { name: '겨울 하늘',     emoji: '❄️', season: '눈송이',          color: '#4a86d4' },
    star:   { name: '별나라',         emoji: '⭐', season: '반짝반짝',        color: '#6b4fc0' },
    space:  { name: '우주',           emoji: '🚀', season: '별똥별',          color: '#12124a' },
    xmas:   { name: '산타 마을',     emoji: '🎅', season: '메리 크리스마스', color: '#e23a3a' },
  };
  const THEME_KEYS = Object.keys(THEMES);
  const ZONE_COUNT = THEME_KEYS.length;
  const WORLD_H = ZONE_H * ZONE_COUNT;
  const ZONES = THEME_KEYS.map((k) => ({ key: k, ...THEMES[k] }));   // (기본 순서)
  const FLOOR_Y = WORLD_H - 32;  // 맨 아래 바닥의 윗면 y

  const PHYS = { gravity: 1300, speed: 250, jump: 640, djump: 580, spring: 1080 };
  const NET = { tickHz: 20, sendHz: 15, interpDelay: 120 };
  const SKIN_COUNT = 30;
  const GAME = {
    quizEvery: 30,          // 초: 이 시간 동안 퀴즈를 안 풀면 자동으로 퀴즈가 뜬다
    energyDrain: 1.5,       // 초당 에너지 감소(0이 되면 더블점프 불가)
    energyPerCorrect: 30,
    pointsPerCorrect: 30,
    lapBonus: 1000,         // 꼭대기(크리스마스 트리) 도착 보너스
    giftRespawnMs: 20000,
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
  function zoneOf(y) { return clamp(Math.floor((WORLD_H - y) / ZONE_H), 0, ZONE_COUNT - 1); }
  // 판(seed)마다 테마 순서를 섞는다. 산타 마을은 항상 꼭대기
  function zoneOrder(seed) {
    const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
    const keys = THEME_KEYS.filter((k) => k !== 'xmas');
    for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    return keys.concat('xmas');
  }
  function heightOf(y) { return Math.max(0, Math.round((FLOOR_Y - 30 - y) / 10)); } // 1m = 10px
  function zoneTop(z) { return WORLD_H - (z + 1) * ZONE_H; }

  // 구역이 높아질수록 발판이 좁아지고 간격이 넓어진다(난이도 상승)
  const WIDTHS = [[128, 128, 96], [128, 96, 96], [96, 96, 128, 64], [96, 64, 64], [64, 96, 64]];
  const diffOf = (z) => z / (ZONE_COUNT - 1);
  const widthsOf = (z) => WIDTHS[Math.min(4, Math.floor(diffOf(z) * 5))];

  function buildLevel(seed) {
    const rnd = mulberry32(seed >>> 0);
    const r = (a, b) => a + rnd() * (b - a);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const platforms = [];
    const gifts = [];
    const springs = [];
    const rnd2 = mulberry32((seed ^ 0x9e3779b9) >>> 0);   // 스프링은 따로(발판 배치에 영향 없음)
    const checkpoints = [{ x: WORLD_W / 2, y: FLOOR_Y }];

    platforms.push({ x: 0, y: FLOOR_Y, w: WORLD_W, zone: 0, kind: 'floor' });
    let y = FLOOR_Y;
    let prevCx = WORLD_W / 2;
    let lastZone = 0;
    let row = 0;
    let gid = 0;

    while (true) {
      const z = zoneOf(y);
      const gap = r(92 + diffOf(z) * 22, 116 + diffOf(z) * 22);
      if (y - gap < 300) break;
      y -= gap;
      row++;
      const zone = zoneOf(y);

      if (zone !== lastZone) {
        // 새 구역 시작: 넓은 체크포인트 발판
        const w = 288;
        const cx = clamp(prevCx + r(-120, 120), w / 2 + 16, WORLD_W - w / 2 - 16);
        platforms.push({ x: Math.round(cx - w / 2), y: Math.round(y), w, zone, kind: 'checkpoint' });
        checkpoints[zone] = { x: cx, y: Math.round(y) };
        prevCx = cx;
        lastZone = zone;
        continue;
      }

      const w = pick(widthsOf(zone));
      const cx = clamp(prevCx + r(-200, 200), w / 2 + 8, WORLD_W - w / 2 - 8);
      const main = { x: Math.round(cx - w / 2), y: Math.round(y), w, zone, kind: 'main' };
      platforms.push(main);
      if (row % 6 === 0) gifts.push({ id: gid++, x: Math.round(cx), y: Math.round(y) - 16 });
      if (row % 7 === 3 && w >= 96) springs.push({ x: Math.round(rnd2() < 0.5 ? main.x + 16 : main.x + w - 16), y: main.y });

      // 갈림길(보조 발판)
      if (rnd() < 0.45) {
        const w2 = pick([64, 96]);
        let cx2 = r(w2 / 2 + 8, WORLD_W - w2 / 2 - 8);
        if (Math.abs(cx2 - cx) < 220) cx2 = cx2 < cx ? Math.max(w2 / 2 + 8, cx - 260) : Math.min(WORLD_W - w2 / 2 - 8, cx + 260);
        if (Math.abs(cx2 - cx) > w / 2 + w2 / 2 + 20) {
          const side = { x: Math.round(cx2 - w2 / 2), y: Math.round(y + r(-20, 20)), w: w2, zone, kind: 'side' };
          platforms.push(side);
          if (rnd2() < 0.22) springs.push({ x: side.x + Math.round(w2 / 2), y: side.y });
        }
      }
      prevCx = cx;
    }

    // 꼭대기: 크리스마스 트리가 있는 정상 발판
    const sy = Math.round(y - 105);
    const sw = 320;
    const scx = clamp(prevCx, sw / 2 + 16, WORLD_W - sw / 2 - 16);
    platforms.push({ x: Math.round(scx - sw / 2), y: sy, w: sw, zone: ZONE_COUNT - 1, kind: 'summit' });
    return { seed, order: zoneOrder(seed), platforms, gifts, springs, checkpoints, summit: { x: Math.round(scx), y: sy } };
  }

  return { WORLD_W, WORLD_H, ZONE_H, ZONES, THEMES, THEME_KEYS, ZONE_COUNT, zoneOrder, FLOOR_Y, PHYS, NET, SKIN_COUNT, GAME,
    mulberry32, clamp, zoneOf, heightOf, zoneTop, buildLevel };
});
