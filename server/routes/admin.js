'use strict';
/* 교사용 REST API (/api/admin/*). /login 을 빼고 전부 x-admin-token 필요 */
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const auth = require('../auth');
const quiz = require('../quiz/store');
const { extractPdfText, parseRange } = require('../quiz/pdf');
const { generateQuestions, hasApiKey, MODEL } = require('../quiz/generator');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)),
});

const jobs = new Map();
const num = (v, a, b, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };

module.exports = function createAdminRouter({ game }) {
  const r = express.Router();
  const body = (req) => req.body || {};

  r.post('/login', (req, res) => {
    if (!auth.allowAttempt(req.ip)) return res.status(429).json({ ok: false, error: '잠시 후 다시 시도해 주세요.' });
    const token = auth.login(String(body(req).password || ''));
    if (!token) return res.status(401).json({ ok: false, error: '비밀번호가 틀렸어요.' });
    res.json({ ok: true, token });
  });

  r.use(auth.middleware);

  r.get('/state', (req, res) => res.json({ ok: true, state: game.publicState(), llm: hasApiKey(), model: MODEL }));

  // ---- 게임 조작 ----
  r.post('/game/start', (req, res) => { game.start(num(body(req).durationSec, 30, 3600, 300)); res.json({ ok: true, state: game.publicState() }); });
  r.post('/game/pause', (req, res) => { game.pause(); res.json({ ok: true, state: game.publicState() }); });
  r.post('/game/resume', (req, res) => { game.resume(); res.json({ ok: true, state: game.publicState() }); });
  r.post('/game/add-time', (req, res) => { game.addTime(num(body(req).sec, -600, 600, 60)); res.json({ ok: true, state: game.publicState() }); });
  r.post('/game/stop', (req, res) => { game.stop(); res.json({ ok: true, state: game.publicState() }); });
  r.post('/game/lobby', (req, res) => { game.toLobby(); res.json({ ok: true, state: game.publicState() }); });
  r.get('/ranking', (req, res) => res.json({ ok: true, ranking: game.ranking() }));
  r.get('/results.csv', (req, res) => {
    res.type('text/csv; charset=utf-8');
    res.attachment(`jump-tower-results-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send('﻿' + game.resultsCsv());   // BOM: 엑셀에서 한글 안 깨짐
  });

  // ---- 문제은행 ----
  r.get('/quiz', (req, res) => res.json({ ok: true, count: quiz.count(), questions: quiz.all() }));
  r.delete('/quiz', (req, res) => { quiz.clear(); game.notifyQuizBank(); res.json({ ok: true, count: 0 }); });
  r.delete('/quiz/:id', (req, res) => { const ok = quiz.remove(req.params.id); game.notifyQuizBank(); res.json({ ok, count: quiz.count() }); });
  r.post('/quiz/sample', (req, res) => { quiz.resetToSample(); game.notifyQuizBank(); res.json({ ok: true, count: quiz.count() }); });
  r.post('/quiz/import', (req, res) => {
    const list = Array.isArray(body(req).questions) ? body(req).questions : [];
    const added = quiz.add(list, { replace: !!body(req).replace });
    game.notifyQuizBank();
    res.json({ ok: true, added, count: quiz.count() });
  });

  // PDF 업로드 → 즉시 jobId 반환, 진행 상황은 소켓('quiz:job')과 GET /quiz/job/:id 로
  r.post('/quiz/upload', upload.single('pdf'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'PDF 파일을 골라 주세요.' });
    if (!hasApiKey()) return res.status(400).json({ ok: false, error: '서버에 OPENAI_API_KEY 가 없어요. .env 파일에 넣고 서버를 다시 켜 주세요.' });
    const b = body(req);
    const opts = {
      count: num(b.count, 10, 400, 120),
      pages: parseRange(b.pages),
      focus: String(b.focus || '').slice(0, 300),
      grade: String(b.grade || '초등 6학년').slice(0, 30),
      replace: b.mode === 'replace',
    };
    const job = { id: crypto.randomUUID(), fileName: req.file.originalname, status: 'parsing', progress: 0, message: 'PDF 읽는 중…', added: 0, startedAt: Date.now() };
    jobs.set(job.id, job);
    res.json({ ok: true, jobId: job.id });
    runJob(job, req.file.buffer, opts, game);
  });

  r.get('/quiz/job/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false });
    res.json({ ok: true, job });
  });

  return r;
};

async function runJob(job, buffer, opts, game) {
  const update = (patch) => { Object.assign(job, patch); game.emitTeacher('quiz:job', job); };
  try {
    const { totalPages, usedPages, text } = await extractPdfText(buffer, opts.pages);
    if (text.replace(/\s/g, '').length < 200) {
      throw new Error('PDF에서 글자를 거의 찾지 못했어요. 스캔(사진) PDF라면 글자 선택이 되는 PDF가 필요해요.');
    }
    update({ status: 'generating', progress: 5, message: `${totalPages}쪽 중 ${usedPages}쪽 읽음 · AI가 문제 만드는 중…` });
    let first = true;
    await generateQuestions(text, {
      count: opts.count, focus: opts.focus, grade: opts.grade,
      onBatch: (batch) => {
        // 조각이 끝날 때마다 바로 게임에 투입(진행 중인 게임에도 즉시 반영)
        job.added += quiz.add(batch, { replace: opts.replace && first });
        first = false;
        game.notifyQuizBank();
      },
      onProgress: (done, total) => update({ progress: 5 + Math.round((90 * done) / total), message: `AI가 문제 만드는 중… (${done}/${total} 묶음, ${job.added}문제)` }),
    });
    update({ status: 'done', progress: 100, message: `완료! 새 문제 ${job.added}개를 게임에 넣었어요. (전체 ${quiz.count()}개)` });
  } catch (e) {
    update({ status: 'error', message: e.message || String(e) });
  }
}
