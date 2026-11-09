/* 통합 점검: 모의 LLM 서버 + 게임 서버를 띄우고 학생 2명·교사 흐름을 끝까지 돌린다.  실행: npm test */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3123, LLM = 3999, URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) { console.error('❌', m); process.exit(1); } console.log('✅', m); };

// 모의 OpenAI: 요청마다 문제 8개를 JSON 스키마 형식으로 돌려준다
let llmCalls = 0;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    llmCalls++;
    const reqJson = JSON.parse(body);
    const hasSchema = reqJson.response_format && reqJson.response_format.type === 'json_schema';
    const questions = Array.from({ length: 8 }, (_, i) => ({ type: 'dialogue', question: `[mock ${llmCalls}-${i}] A: Do you know anything about Tuho? B: ___`, choices: ["Yes, I do.", 'I am ten.', 'It is red.', 'Good night.'], answer_index: 0, hint_ko: '알고 있다고 답해요' }));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: reqJson.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ questions }), refusal: null } }], usage: {}, _schema: hasSchema }));
  });
}).listen(LLM);

const dataDir = fs.mkdtempSync('/tmp/jt-data-');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, DATA_DIR: dataDir, OPENAI_API_KEY: 'test', OPENAI_BASE_URL: `http://localhost:${LLM}/v1`, OPENAI_MODEL: 'mock-model' }, stdio: ['ignore', 'pipe', 'inherit'],
});
srv.stdout.on('data', (d) => process.stdout.write('   [server] ' + d));

const emitAck = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
async function api(p, opts = {}, token) {
  const r = await fetch(URL + '/api/admin' + p, { ...opts, headers: { ...(opts.headers || {}), ...(token ? { 'x-admin-token': token } : {}) } });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}

(async () => {
  await sleep(900);
  ok((await fetch(URL + '/')).status === 200, '학생 페이지 응답');
  ok((await fetch(URL + '/vendor/phaser.min.js')).status === 200, 'Phaser 로컬 제공');

  const bad = await api('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '1111' }) });
  ok(bad.status === 401, '틀린 비밀번호 거부');
  const login = await api('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '0634' }) });
  const token = login.body.token;
  ok(!!token, '비밀번호 0634 로그인');
  ok((await api('/state')).status === 401, '토큰 없으면 관리자 API 거부');

  const teacher = io(URL + '/teacher', { auth: { token }, transports: ['websocket'] });
  let dash = null; teacher.on('dash', (d) => (dash = d));
  const a = io(URL, { transports: ['websocket'] });
  const b = io(URL, { transports: ['websocket'] });
  let counts = []; a.on('count', (n) => counts.push(n));
  const snaps = []; b.on('s', (t, list) => snaps.push(...list));
  await sleep(300);

  const ja = await emitAck(a, 'join', { name: '산타햄찌', skin: 3, key: 'testkey-aaaa1111' });
  const jb = await emitAck(b, 'join', { name: '<b>루돌프</b>', skin: 15 });
  ok(ja.ok && jb.ok, '학생 2명 입장');
  ok(jb.roster.some((r) => r[1] === '산타햄찌'), '나중 입장자가 기존 플레이어 목록 받음');
  ok(!/[<>]/.test(jb.roster.concat([[0, '']]).map((r) => r[1]).join('')), '닉네임 태그 제거');
  await sleep(400);
  ok(counts[counts.length - 1] === 2, '참여 인원 2명 방송');

  for (let i = 0; i < 6; i++) { a.emit('m', [480 + i * 5, -100 - i * 10, 1, 0]); await sleep(70); }
  await sleep(200);
  ok(snaps.some((s) => s[0] === ja.you.sid && s[1] === 505), '위치 스냅샷 동기화(B가 A 위치 수신)');
  a.emit('m', [480, -90000, 2, 0]); await sleep(120);
  ok(snaps.filter((s) => s[0] === ja.you.sid).pop()[2] > -1000, '순간 상승(치트) 위치 제한');

  const q0 = await emitAck(a, 'quiz:next', {});
  ok(!q0.ok, '대기 중엔 퀴즈 안 나옴');

  let gameStart = null; b.on('game:start', (s) => (gameStart = s));
  await api('/game/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ durationSec: 30 }) }, token);
  await sleep(200);
  ok(gameStart && gameStart.phase === 'playing' && gameStart.endsAt - gameStart.startedAt === 30000, '교사 시작 → 학생에게 동기화된 타이머 전달');
  await sleep(3500);

  const q1 = await emitAck(a, 'quiz:next', {});
  ok(q1.ok && q1.q.choices.length === 4 && q1.q.answer === undefined, '퀴즈 출제(정답은 클라이언트로 안 보냄)');
  const res1 = await emitAck(a, 'quiz:answer', { id: q1.q.id, choice: 0 });
  ok(res1.ok && typeof res1.correct === 'boolean', '서버 채점: ' + (res1.correct ? '정답' : '오답'));
  const again = await emitAck(a, 'quiz:answer', { id: q1.q.id, choice: 0 });
  ok(!again.ok, '같은 문제 두 번 채점 불가');
  const seen = new Set();
  for (let i = 0; i < 40; i++) { const q = await emitAck(b, 'quiz:next', {}); seen.add(q.q.question); await emitAck(b, 'quiz:answer', { id: q.q.id, choice: 1 }); }
  ok(seen.size >= 30, `중복 없이 출제(40번 중 서로 다른 문제 ${seen.size}개)`);

  // PDF 업로드 → 모의 LLM → 진행 중 게임에 투입
  const fd = new FormData();
  fd.append('pdf', new Blob([fs.readFileSync(path.join(__dirname, 'sample-guide.pdf'))], { type: 'application/pdf' }), 'guide.pdf');
  fd.append('count', '40'); fd.append('pages', '1-2'); fd.append('mode', 'append');
  const up = await api('/quiz/upload', { method: 'POST', body: fd }, token);
  ok(up.body.ok, 'PDF 업로드 접수');
  let job;
  for (let i = 0; i < 40; i++) { await sleep(250); job = (await api('/quiz/job/' + up.body.jobId, {}, token)).body.job; if (job.status === 'done' || job.status === 'error') break; }
  ok(job.status === 'done' && job.added > 0, `PDF→AI 문제 생성 완료: ${job.message} (LLM 호출 ${llmCalls}번)`);
  const bank = (await api('/quiz', {}, token)).body;
  ok(bank.questions.some((q) => q.question.startsWith('[mock')), '생성 문제가 문제은행에 들어감');

  await sleep(500);
  ok(dash && dash.players.length === 2 && dash.players.find((p) => p.name === '산타햄찌').correct + dash.players.find((p) => p.name === '산타햄찌').wrong === 1, '교사 대시보드 실시간 점수 수신');

  // 새로고침(재접속)해도 점수 유지
  const scoreBefore = dash.players.find((p) => p.name === '산타햄찌').score;
  a.disconnect(); await sleep(200);
  const a2 = io(URL, { transports: ['websocket'] }); await sleep(200);
  const ja2 = await emitAck(a2, 'join', { name: '산타햄찌', skin: 3, key: 'testkey-aaaa1111' });
  ok(ja2.ok && ja2.you.sid === ja.you.sid && ja2.you.score === scoreBefore, '새로고침해도 같은 학생·점수 유지');

  let ended = null; b.on('game:end', (d) => (ended = d));
  await api('/game/stop', { method: 'POST' }, token);
  await sleep(300);
  ok(ended && ended.ranking.length === 2 && ended.ranking[0].rank === 1, '종료 → 순위 방송');
  const csv = await api('/results.csv', {}, token);
  ok(csv.body.includes('산타햄찌'), 'CSV 결과 내려받기');

  console.log('\n🎉 모든 점검 통과');
  srv.kill(); mock.close(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
