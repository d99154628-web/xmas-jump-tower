'use strict';
/*
 * game.js — 서버가 "진짜" 상태를 갖는다: 게임 단계·타이머·점수·퀴즈 정답.
 * 위치는 각 학생 브라우저가 물리 계산을 하고(입력 지연 0), 서버는 20Hz 로 묶어서 뿌린다.
 *  - 바뀐 플레이어만 보내는 델타 스냅샷 + volatile emit(밀리면 버림) → 렉이 쌓이지 않음
 *  - 정답 인덱스는 학생에게 미리 보내지 않음(서버에서 채점)
 */
const S = require('../public/js/shared');
const auth = require('./auth');
const quiz = require('./quiz/store');

const state = {
  phase: 'lobby',     // lobby(연습) | playing | ended
  duration: 300,      // 초
  startedAt: 0,       // 카운트다운이 끝나는 서버 시각(ms)
  endsAt: 0,
  paused: false,
  remaining: 0,       // 일시정지 중 남은 ms
  seed: newSeed(),
  round: 0,
};

const players = new Map();  // socket.id -> record (접속 중)
const records = new Map();  // key -> record (새로고침해도 점수 유지)
const dirty = new Set();
let io = null;
let teacherNs = null;
let nextSid = 1;

function newSeed() { return Math.floor(Math.random() * 2 ** 31) >>> 0; }
const clampInt = (v, a, b, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
const spawnX = () => Math.round(S.WORLD_W / 2 + (Math.random() - 0.5) * 360);
const scoreOf = (r) => r.lapBest + r.correct * S.GAME.pointsPerCorrect;   // 최고 높이(m) + 정답 점수

function publicState() {
  return {
    phase: state.phase, duration: state.duration, startedAt: state.startedAt, endsAt: state.endsAt,
    paused: state.paused, remaining: state.remaining, seed: state.seed, round: state.round,
    serverTime: Date.now(), quizCount: quiz.count(), online: players.size,
  };
}

function newRecord(key, name, skin) {
  return {
    key, name, skin, sid: nextSid++, socketId: null, online: true,
    x: spawnX(), y: S.FLOOR_Y - 30, anim: 0, flip: 0, lastMoveAt: 0,
    lapBest: 0, correct: 0, wrong: 0,
    pending: null, deck: null, deckVer: -1, served: new Set(), cycle: 0,
  };
}

function resetScores(r) {
  r.lapBest = 0; r.correct = 0; r.wrong = 0;
  r.pending = null; r.deck = null; r.deckVer = -1; r.served.clear(); r.cycle = 0;
}

function cleanName(v) {
  return String(v || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 10);
}

/* ---------------- 소켓 연결 ---------------- */
function attach(_io) {
  io = _io;
  teacherNs = io.of('/teacher');
  teacherNs.use((socket, next) => (auth.verify(socket.handshake.auth && socket.handshake.auth.token) ? next() : next(new Error('unauthorized'))));
  teacherNs.on('connection', (s) => {
    s.emit('state', publicState());
    s.emit('dash', dashboard());
    s.on('t', (ack) => typeof ack === 'function' && ack(Date.now()));
  });

  io.on('connection', (socket) => {
    socket.emit('count', players.size);
    socket.on('t', (ack) => typeof ack === 'function' && ack(Date.now()));
    socket.on('join', (data, ack) => onJoin(socket, data, ack));
    socket.on('m', (arr) => onMove(socket, arr));
    socket.on('quiz:next', (_d, ack) => onQuizNext(socket, ack));
    socket.on('quiz:answer', (d, ack) => onQuizAnswer(socket, d, ack));
    socket.on('disconnect', () => onLeave(socket));
  });

  setInterval(tick, 1000 / S.NET.tickHz);
  setInterval(dashTick, 250);
  setInterval(timerTick, 100);
}

function onJoin(socket, data, ack) {
  if (typeof ack !== 'function') return;
  if (players.has(socket.id)) return ack({ ok: false, reason: '이미 입장했어요.' });
  data = data || {};
  const name = cleanName(data.name);
  if (!name) return ack({ ok: false, reason: '닉네임을 써 주세요.' });
  const skin = clampInt(data.skin, 0, S.SKIN_COUNT - 1, 0);
  const key = typeof data.key === 'string' && /^[a-z0-9-]{8,64}$/i.test(data.key) ? data.key : null;

  let rec = key ? records.get(key) : null;
  if (rec && rec.online && rec.socketId !== socket.id) {
    // 같은 학생이 탭을 하나 더 열었으면 예전 탭을 내보낸다
    const old = io.sockets.sockets.get(rec.socketId);
    if (old) old.disconnect(true);
  }
  if (!rec) {
    rec = newRecord(key || require('crypto').randomUUID(), name, skin);
    records.set(rec.key, rec);
  }
  rec.name = name; rec.skin = skin; rec.online = true; rec.socketId = socket.id;
  if (state.phase !== 'playing') { rec.x = spawnX(); rec.y = S.FLOOR_Y - 30; }

  players.set(socket.id, rec);
  socket.join('players');
  socket.to('players').emit('roster:add', [rec.sid, rec.name, rec.skin, Math.round(rec.x), Math.round(rec.y)]);
  ack({
    ok: true, key: rec.key,
    you: { sid: rec.sid, x: rec.x, y: rec.y, lapBest: rec.lapBest, correct: rec.correct, score: scoreOf(rec) },
    state: publicState(),
    roster: [...players.values()].filter((r) => r !== rec).map((r) => [r.sid, r.name, r.skin, Math.round(r.x), Math.round(r.y), r.anim, r.flip]),
  });
  broadcastCount();
}

function onMove(socket, arr) {
  const rec = players.get(socket.id);
  if (!rec || !Array.isArray(arr) || arr.length < 4) return;
  let x = Number(arr[0]); let y = Number(arr[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  x = S.clamp(x, 0, S.WORLD_W);
  y = S.clamp(y, S.TOP_LIMIT, 0);
  const now = Date.now();
  const dt = Math.min(1000, Math.max(16, now - (rec.lastMoveAt || now)));
  // 위로는 물리적으로 가능한 속도까지만(간단한 치트 방지). 아래(추락·리스폰)는 자유.
  const maxRise = 1250 * dt / 1000 + 80;   // 스프링(1080px/s) 포함
  if (rec.y - y > maxRise) y = rec.y - maxRise;
  rec.x = x; rec.y = y; rec.anim = (arr[2] | 0) & 3; rec.flip = arr[3] ? 1 : 0; rec.lastMoveAt = now;
  if (isRunning()) {
    const h = S.heightOf(y);
    if (h > rec.lapBest) rec.lapBest = h;
  }
  dirty.add(rec);
}

function isRunning() {
  const now = Date.now();
  return state.phase === 'playing' && !state.paused && now >= state.startedAt;
}

function onQuizNext(socket, ack) {
  if (typeof ack !== 'function') return;
  const rec = players.get(socket.id);
  if (!rec) return ack({ ok: false, reason: '입장 전이에요.' });
  if (!isRunning()) return ack({ ok: false, reason: '게임이 시작되면 퀴즈가 나와요.' });
  const q = quiz.drawFor(rec);
  if (!q) return ack({ ok: false, reason: '문제은행이 비어 있어요.' });
  rec.pending = { id: q.id, answer: q.answer, at: Date.now() };
  ack({ ok: true, q: { id: q.id, question: q.question, choices: q.choices, hint: q.hint } });
}

function onQuizAnswer(socket, d, ack) {
  if (typeof ack !== 'function') return;
  const rec = players.get(socket.id);
  const p = rec && rec.pending;
  if (!p || !d || d.id !== p.id) return ack({ ok: false });
  rec.pending = null;
  const correct = Number(d.choice) === p.answer;
  if (isRunning()) { if (correct) rec.correct++; else rec.wrong++; }
  ack({ ok: true, correct, answer: p.answer, score: scoreOf(rec), correctCount: rec.correct });
}

function onLeave(socket) {
  const rec = players.get(socket.id);
  if (rec) {
    players.delete(socket.id);
    dirty.delete(rec);
    if (rec.socketId === socket.id) rec.online = false;
    io.to('players').emit('roster:remove', rec.sid);
  }
  broadcastCount();
}

let countTimer = null;
function broadcastCount() {
  if (countTimer) return;               // 한꺼번에 25명이 들어와도 200ms 에 한 번만
  countTimer = setTimeout(() => { countTimer = null; io.emit('count', players.size); }, 200);
}

/* ---------------- 주기 작업 ---------------- */
function tick() {
  if (!dirty.size) return;
  const list = [];
  for (const r of dirty) list.push([r.sid, Math.round(r.x), Math.round(r.y), r.anim, r.flip]);
  dirty.clear();
  io.to('players').volatile.emit('s', Date.now(), list);
}

function dashTick() {
  if (teacherNs && teacherNs.sockets.size) teacherNs.volatile.emit('dash', dashboard());
}

function timerTick() {
  if (state.phase === 'playing' && !state.paused && Date.now() >= state.endsAt) endGame();
}

function activeRecords() {
  return [...records.values()].filter((r) => r.online || r.correct + r.wrong + r.lapBest > 0);
}

function ranking() {
  return activeRecords()
    .map((r) => ({ sid: r.sid, name: r.name, skin: r.skin, score: scoreOf(r), best: r.lapBest, correct: r.correct, wrong: r.wrong, online: r.online }))
    .sort((a, b) => b.score - a.score || b.correct - a.correct)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

function dashboard() {
  return {
    t: Date.now(),
    players: activeRecords().map((r) => ({
      sid: r.sid, name: r.name, skin: r.skin, online: r.online, x: Math.round(r.x), y: Math.round(r.y),
      zone: S.zoneOf(r.y), h: S.heightOf(r.y), score: scoreOf(r), best: r.lapBest, correct: r.correct, wrong: r.wrong,
    })),
  };
}

/* ---------------- 교사 조작 ---------------- */
function emitState() {
  const s = publicState();
  io.emit('state', s);
  teacherNs.emit('state', s);
}

function start(durationSec) {
  const now = Date.now();
  state.duration = clampInt(durationSec, 30, 3600, 300);
  state.phase = 'playing';
  state.paused = false;
  state.round++;
  state.seed = newSeed();                     // 판마다 새 맵
  state.startedAt = now + 3500;               // 3·2·1 카운트다운
  state.endsAt = state.startedAt + state.duration * 1000;
  for (const [k, r] of records) { if (!r.online) records.delete(k); else resetScores(r); }
  for (const r of players.values()) { r.x = spawnX(); r.y = S.FLOOR_Y - 30; }
  const s = publicState();
  io.emit('game:start', s);
  teacherNs.emit('state', s);
}

function pause() {
  if (state.phase !== 'playing' || state.paused) return;
  state.paused = true;
  state.remaining = Math.max(0, state.endsAt - Date.now());
  emitState();
}

function resume() {
  if (state.phase !== 'playing' || !state.paused) return;
  state.paused = false;
  state.endsAt = Date.now() + state.remaining;
  if (state.startedAt > Date.now()) state.startedAt = Date.now();
  emitState();
}

function addTime(sec) {
  if (state.phase !== 'playing') return;
  const ms = clampInt(sec, -600, 600, 60) * 1000;
  if (state.paused) state.remaining = Math.max(1000, state.remaining + ms);
  else state.endsAt = Math.max(Date.now() + 1000, state.endsAt + ms);
  state.duration = Math.max(30, state.duration + ms / 1000);
  emitState();
}

function endGame() {
  if (state.phase !== 'playing') return;
  state.phase = 'ended';
  state.paused = false;
  const r = ranking();
  io.emit('game:end', { ranking: r });
  teacherNs.emit('game:end', { ranking: r });
  emitState();
}

function toLobby() {
  state.phase = 'lobby';
  state.paused = false;
  emitState();
}

function notifyQuizBank() { if (io) emitState(); }
function emitTeacher(ev, data) { if (teacherNs) teacherNs.emit(ev, data); }

function resultsCsv() {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['순위', '닉네임', '점수', '최고 높이(m)', '정답', '오답', '접속']];
  for (const r of ranking()) rows.push([r.rank, r.name, r.score, r.best, r.correct, r.wrong, r.online ? 'O' : 'X']);
  return rows.map((row) => row.map(esc).join(',')).join('\r\n');
}

module.exports = { attach, publicState, start, pause, resume, addTime, stop: endGame, toLobby, ranking, resultsCsv, notifyQuizBank, emitTeacher };
