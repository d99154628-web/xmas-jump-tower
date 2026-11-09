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
  const ZONES = [
    { key: 'magma',  name: '지구의 마그마', emoji: '🌋', season: '불씨',       color: '#ff5a1f' },
    { key: 'water',  name: '바닷속',        emoji: '🌊', season: '봄',         color: '#2bb3ff' },
    { key: 'ground', name: '땅 위',          emoji: '🍂', season: '가을',       color: '#f0a020' },
    { key: 'sky',    name: '하늘',          emoji: '❄️', season: '겨울',       color: '#bfe4ff' },
    { key: 'space',  name: '우주',          emoji: '🎄', season: '크리스마스', color: '#b388ff' },
  ];
  const WORLD_H = ZONE_H * ZONES.length;
  const FLOOR_Y = WORLD_H - 32;  // 맨 아래 바닥의 윗면 y

  const PHYS = { gravity: 1300, speed: 250, jump: 640, djump: 580 };
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
  function zoneOf(y) { return clamp(Math.floor((WORLD_H - y) / ZONE_H), 0, ZONES.length - 1); }
  function heightOf(y) { return Math.max(0, Math.round((FLOOR_Y - 30 - y) / 10)); } // 1m = 10px
  function zoneTop(z) { return WORLD_H - (z + 1) * ZONE_H; }

  // 구역이 높아질수록 발판이 좁아지고 간격이 넓어진다(난이도 상승)
  const WIDTHS = [[128, 128, 96], [128, 96, 96], [96, 128, 64], [96, 64, 64], [64, 96, 64]];

  function buildLevel(seed) {
    const rnd = mulberry32(seed >>> 0);
    const r = (a, b) => a + rnd() * (b - a);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const platforms = [];
    const gifts = [];
    const checkpoints = [{ x: WORLD_W / 2, y: FLOOR_Y }];

    platforms.push({ x: 0, y: FLOOR_Y, w: WORLD_W, zone: 0, kind: 'floor' });
    let y = FLOOR_Y;
    let prevCx = WORLD_W / 2;
    let lastZone = 0;
    let row = 0;
    let gid = 0;

    while (true) {
      const z = zoneOf(y);
      const gap = r(92 + z * 5, 116 + z * 5);
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

      const w = pick(WIDTHS[zone]);
      const cx = clamp(prevCx + r(-200, 200), w / 2 + 8, WORLD_W - w / 2 - 8);
      const main = { x: Math.round(cx - w / 2), y: Math.round(y), w, zone, kind: 'main' };
      platforms.push(main);
      if (row % 6 === 0) gifts.push({ id: gid++, x: Math.round(cx), y: Math.round(y) - 16 });

      // 갈림길(보조 발판)
      if (rnd() < 0.45) {
        const w2 = pick([64, 96]);
        let cx2 = r(w2 / 2 + 8, WORLD_W - w2 / 2 - 8);
        if (Math.abs(cx2 - cx) < 220) cx2 = cx2 < cx ? Math.max(w2 / 2 + 8, cx - 260) : Math.min(WORLD_W - w2 / 2 - 8, cx + 260);
        if (Math.abs(cx2 - cx) > w / 2 + w2 / 2 + 20) {
          platforms.push({ x: Math.round(cx2 - w2 / 2), y: Math.round(y + r(-20, 20)), w: w2, zone, kind: 'side' });
        }
      }
      prevCx = cx;
    }

    // 꼭대기: 크리스마스 트리가 있는 정상 발판
    const sy = Math.round(y - 105);
    const sw = 320;
    const scx = clamp(prevCx, sw / 2 + 16, WORLD_W - sw / 2 - 16);
    platforms.push({ x: Math.round(scx - sw / 2), y: sy, w: sw, zone: ZONES.length - 1, kind: 'summit' });
    return { seed, platforms, gifts, checkpoints, summit: { x: Math.round(scx), y: sy } };
  }

  return { WORLD_W, WORLD_H, ZONE_H, ZONES, FLOOR_Y, PHYS, NET, SKIN_COUNT, GAME,
    mulberry32, clamp, zoneOf, heightOf, zoneTop, buildLevel };
});
