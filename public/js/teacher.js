/* global io, SHARED, PIXEL */
/* 교사용 대시보드: 게임 조작 · 서버 시계에 맞춘 타이머 · 실시간 타워/순위 · 문제은행·PDF 생성 */
(function () {
  'use strict';
  const S = SHARED;
  const $ = (id) => document.getElementById(id);
  let token = localStorage.getItem('jt_admin') || '';
  let socket = null;
  let state = null;
  let offset = 0;
  let players = [];
  let bank = [];
  let mapBase = null;
  let mapSeed = null;

  $('studentUrl').textContent = location.origin + '/';

  /* ---------- 인증 ---------- */
  async function api(path, opts = {}) {
    const headers = { 'x-admin-token': token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch('/api/admin' + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.blob();
    if (data && data.ok === false) throw new Error(data.error || '요청 실패');
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

  function showLogin() {
    $('dash').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('pw').focus();
    if (socket) { socket.disconnect(); socket = null; }
  }

  $('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pw').value }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { $('loginMsg').textContent = j.error || '로그인 실패'; return; }
    token = j.token;
    localStorage.setItem('jt_admin', token);
    $('pw').value = '';
    boot();
  };
  $('logoutBtn').onclick = () => { localStorage.removeItem('jt_admin'); token = ''; showLogin(); };

  async function boot() {
    try {
      const s = await api('/state');
      $('login').classList.add('hidden');
      $('dash').classList.remove('hidden');
      state = s.state;
      $('llmBadge').textContent = s.llm ? `🤖 AI 사용 가능 (${s.model})` : '⚠️ OPENAI_API_KEY 없음 — PDF 생성 불가';
      $('llmBadge').className = 'badge ' + (s.llm ? 'on' : 'warn');
      connectSocket();
      loadBank();
    } catch (e) { if (e.message !== 'unauthorized') alert(e.message); }
  }

  /* ---------- 소켓(실시간) ---------- */
  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io('/teacher', { auth: { token }, transports: ['websocket'], upgrade: false });
    socket.on('connect', () => { setConn(true); syncClock(); });
    socket.on('disconnect', () => setConn(false));
    socket.on('connect_error', (err) => { setConn(false); if (err && err.message === 'unauthorized') showLogin(); });
    socket.on('state', (s) => { state = s; renderPhase(); $('quizCount').textContent = `${s.quizCount}문제`; if (bank.length !== s.quizCount) loadBankSoon(); });
    socket.on('dash', (d) => { players = d.players; renderRanking(); drawMap(); });
    socket.on('game:end', () => { renderPhase(); });
    socket.on('quiz:job', (job) => renderJob(job));
  }
  function setConn(on) { const c = $('conn'); c.textContent = on ? '● 실시간 연결됨' : '● 연결 끊김'; c.className = 'badge ' + (on ? 'on' : 'off'); }

  async function syncClock() {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const st = await new Promise((res) => socket.timeout(3000).emit('t', (err, v) => res(err ? null : v)));
      const t1 = Date.now();
      if (st != null && t1 - t0 < best) { best = t1 - t0; offset = st + (t1 - t0) / 2 - t1; }
    }
  }
  const serverNow = () => Date.now() + offset;

  /* ---------- 게임 조작 ---------- */
  document.querySelectorAll('.presets [data-min]').forEach((b) => { b.onclick = () => { $('minInput').value = b.dataset.min; $('secInput').value = 0; }; });
  const run = (fn) => async (...args) => { try { await fn(...args); } catch (e) { if (e.message !== 'unauthorized') alert(e.message); } };
  $('startBtn').onclick = run(async () => {
    const sec = Number($('minInput').value || 0) * 60 + Number($('secInput').value || 0);
    if (sec < 30) return alert('게임 시간은 30초 이상으로 해 주세요.');
    if (state && state.phase === 'playing' && !confirm('진행 중인 게임을 새로 시작할까요? 점수가 초기화돼요.')) return;
    await post('/game/start', { durationSec: sec });
  });
  $('pauseBtn').onclick = run(() => post(state && state.paused ? '/game/resume' : '/game/pause'));
  $('plusBtn').onclick = run(() => post('/game/add-time', { sec: 60 }));
  $('minusBtn').onclick = run(() => post('/game/add-time', { sec: -60 }));
  $('stopBtn').onclick = run(async () => { if (confirm('지금 게임을 끝내고 순위를 보여 줄까요?')) await post('/game/stop'); });
  $('lobbyBtn').onclick = run(() => post('/game/lobby'));
  $('csvBtn').onclick = run(async () => {
    const blob = await api('/results.csv');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `점프타워-결과-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  function phaseInfo() {
    if (!state) return ['lobby', '연습 시간(대기)'];
    const now = serverNow();
    if (state.phase === 'playing') {
      if (state.paused) return ['paused', '⏸ 일시정지'];
      if (now < state.startedAt) return ['countdown', '3·2·1 카운트다운'];
      return ['playing', '🎮 게임 중'];
    }
    if (state.phase === 'ended') return ['ended', '🏁 게임 끝'];
    return ['lobby', '🛝 연습 시간(대기)'];
  }

  function renderPhase() {
    const [cls, label] = phaseInfo();
    const b = $('phaseBadge');
    b.className = 'phase ' + cls;
    b.textContent = label;
    $('pauseBtn').textContent = state && state.paused ? '▶ 다시 시작' : '⏸ 일시정지';
    const playing = state && state.phase === 'playing';
    ['pauseBtn', 'plusBtn', 'minusBtn', 'stopBtn'].forEach((id) => { $(id).disabled = !playing; });
    $('onlineCount').textContent = state ? state.online : 0;
  }

  function tickTimer() {
    requestAnimationFrame(tickTimer);
    if (!state) return;
    let rem = null;
    if (state.phase === 'playing') {
      if (state.paused) rem = state.remaining;
      else if (serverNow() < state.startedAt) rem = state.duration * 1000;
      else rem = state.endsAt - serverNow();
    } else if (state.phase === 'ended') rem = 0;
    const el = $('bigTimer');
    if (rem == null) el.textContent = '--:--';
    else { const s = Math.max(0, Math.ceil(rem / 1000)); el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
    el.classList.toggle('warn', rem != null && rem < 10500 && state.phase === 'playing');
    if (tickTimer.n++ % 15 === 0) renderPhase();
  }
  tickTimer.n = 0;

  /* ---------- 미니맵 · 순위 ---------- */
  const ZONE_BG = ['#5c1408', '#155fa0', '#6cb8ef', '#5b86cf', '#0b0b2e'];
  function buildMapBase(seed) {
    const cv = $('map');
    const W = cv.width, H = cv.height;
    const base = document.createElement('canvas'); base.width = W; base.height = H;
    const g = base.getContext('2d');
    const sx = W / S.WORLD_W, sy = H / S.WORLD_H;
    S.ZONES.forEach((z, i) => {
      g.fillStyle = ZONE_BG[i];
      g.fillRect(0, S.zoneTop(i) * sy, W, S.ZONE_H * sy + 1);
      g.fillStyle = '#ffffffcc'; g.font = '12px Galmuri11, sans-serif';
      g.fillText(`${z.emoji} ${z.name}`, 6, (S.zoneTop(i) + S.ZONE_H) * sy - 6);
    });
    const lvl = S.buildLevel(seed);
    for (const p of lvl.platforms) {
      g.fillStyle = p.kind === 'checkpoint' || p.kind === 'summit' ? '#ffd23f' : '#ffffff88';
      g.fillRect(p.x * sx, p.y * sy, Math.max(2, p.w * sx), 2);
    }
    g.fillStyle = '#4dff88';
    for (const sp of lvl.springs) g.fillRect(sp.x * sx - 1, sp.y * sy - 3, 3, 3);
    g.fillStyle = '#e23a3a';
    for (const gf of lvl.gifts) g.fillRect(gf.x * sx - 1, gf.y * sy - 2, 3, 3);
    g.font = '16px sans-serif'; g.fillText('🎄', lvl.summit.x * sx - 8, lvl.summit.y * sy);
    return base;
  }

  function drawMap() {
    if (!state) return;
    if (mapSeed !== state.seed) { mapBase = buildMapBase(state.seed); mapSeed = state.seed; }
    const cv = $('map'); const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(mapBase, 0, 0);
    const sx = cv.width / S.WORLD_W, sy = cv.height / S.WORLD_H;
    g.font = '10px Galmuri11, sans-serif'; g.textAlign = 'center';
    for (const p of players) {
      if (!p.online) continue;
      const x = p.x * sx, y = p.y * sy;
      g.drawImage(PIXEL.charSheet(p.skin), 0, 0, PIXEL.FW, PIXEL.FH, x - 9, y - 19, 18, 21);
      g.fillStyle = '#000a'; g.fillText(p.name, x + 1, y - 19);
      g.fillStyle = '#fff'; g.fillText(p.name, x, y - 20);
    }
    g.textAlign = 'left';
  }

  const avatarCache = new Map();
  function avatar(skin) {
    if (!avatarCache.has(skin)) { const c = document.createElement('canvas'); PIXEL.drawCharPreview(c, skin, 2); avatarCache.set(skin, c.toDataURL()); }
    return avatarCache.get(skin);
  }
  function renderRanking() {
    const sorted = players.slice().sort((a, b) => b.score - a.score || b.correct - a.correct);
    const tb = $('rankBody');
    const frag = document.createDocumentFragment();
    sorted.forEach((p, i) => {
      const tr = document.createElement('tr');
      tr.className = (p.online ? '' : 'offline ') + (i < 3 ? 'top' + (i + 1) : '');
      const cells = [i + 1, null, p.name, p.score, `${p.h}m (최고 ${p.best})`, p.laps, `${p.correct} / ${p.wrong}`];
      cells.forEach((v, k) => {
        const td = document.createElement('td');
        if (k === 1) { const img = document.createElement('img'); img.src = avatar(p.skin); img.width = 24; img.style.imageRendering = 'pixelated'; td.append(img); }
        else td.textContent = String(v);
        tr.append(td);
      });
      frag.append(tr);
    });
    tb.replaceChildren(frag);
  }

  /* ---------- 문제은행 ---------- */
  let bankTimer = null;
  function loadBankSoon() { clearTimeout(bankTimer); bankTimer = setTimeout(loadBank, 600); }
  async function loadBank() {
    const d = await api('/quiz');
    bank = d.questions;
    $('quizCount').textContent = `${d.count}문제`;
    renderBank();
  }
  function renderBank() {
    const q = $('search').value.trim().toLowerCase();
    const list = bank.filter((b) => !q || (b.question + ' ' + b.choices.join(' ')).toLowerCase().includes(q)).slice(0, 400);
    const frag = document.createDocumentFragment();
    for (const b of list) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td'); td1.textContent = b.question + (b.hint ? `  💡${b.hint}` : '');
      const td2 = document.createElement('td'); td2.className = 'ok'; td2.textContent = b.choices[b.answer];
      const td3 = document.createElement('td'); td3.className = 'wrong'; td3.textContent = b.choices.filter((_, i) => i !== b.answer).join(' · ');
      const td4 = document.createElement('td');
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.title = '이 문제 지우기';
      del.onclick = run(async () => { await api('/quiz/' + b.id, { method: 'DELETE' }); bank = bank.filter((x) => x.id !== b.id); renderBank(); });
      td4.append(del);
      tr.append(td1, td2, td3, td4);
      frag.append(tr);
    }
    $('bankBody').replaceChildren(frag);
  }
  $('search').oninput = renderBank;
  $('sampleBtn').onclick = run(async () => { if (confirm('지금 문제를 지우고 기본 문제로 바꿀까요?')) { await post('/quiz/sample'); loadBank(); } });
  $('clearBtn').onclick = run(async () => { if (confirm('문제를 모두 지울까요? (게임 중이면 퀴즈가 안 나와요)')) { await api('/quiz', { method: 'DELETE' }); loadBank(); } });
  $('exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ questions: bank }, null, 1)], { type: 'application/json' }));
    a.download = `점프타워-문제은행-${bank.length}문제.json`;
    a.click();
  };
  $('importFile').onchange = run(async (e) => {
    const f = $('importFile').files[0];
    if (!f) return;
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.questions;
    const replace = confirm('확인 = 지금 문제를 이 파일로 바꾸기\n취소 = 지금 문제에 추가하기');
    const r = await post('/quiz/import', { questions: list, replace });
    alert(`${r.added}문제를 불러왔어요. (전체 ${r.count}문제)`);
    $('importFile').value = '';
    loadBank();
  });

  /* ---------- PDF 업로드 → AI 생성 ---------- */
  let pollTimer = null;
  $('uploadForm').onsubmit = run(async (e) => {
    e.preventDefault();
    const file = $('pdfFile').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('pdf', file);
    ['pages', 'count', 'grade', 'focus', 'mode'].forEach((id) => fd.append(id, $(id).value));
    $('uploadBtn').disabled = true;
    renderJob({ status: 'uploading', progress: 2, message: `${file.name} 올리는 중…` });
    try {
      const r = await api('/quiz/upload', { method: 'POST', body: fd });
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {          // 소켓이 끊겨도 진행 상황을 받도록 폴링 병행
        try { const j = await api('/quiz/job/' + r.jobId); renderJob(j.job); } catch { /* ignore */ }
      }, 2500);
    } catch (err) {
      $('uploadBtn').disabled = false;
      renderJob({ status: 'error', progress: 0, message: err.message });
    }
  });
  function renderJob(job) {
    $('progFill').style.width = `${job.progress || 0}%`;
    $('jobMsg').textContent = (job.status === 'error' ? '❌ ' : job.status === 'done' ? '✅ ' : '⏳ ') + job.message;
    if (job.status === 'done' || job.status === 'error') { clearInterval(pollTimer); $('uploadBtn').disabled = false; loadBankSoon(); }
  }

  if (token) boot(); else showLogin();
  requestAnimationFrame(tickTimer);
})();
