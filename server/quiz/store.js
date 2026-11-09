'use strict';
/*
 * 문제은행. data/questions.json 에 저장되고, 게임 중에 추가돼도 바로 반영된다.
 * 학생마다 섞은 "덱"에서 한 장씩 뽑아 중복 없이 내고, 다 풀면 보기 순서를 바꿔 다시 낸다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SAMPLE = require('./sample');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'questions.json');

let bank = [];
let index = new Map();
let version = 0;
let saveTimer = null;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();
const keyOf = (q) => norm(q.question) + '|' + norm(q.choices[q.answer]);

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = String(raw.question || raw.q || '').trim().slice(0, 200);
  const choices = (Array.isArray(raw.choices) ? raw.choices : raw.c || []).map((c) => String(c).trim().slice(0, 80));
  const answer = Number(raw.answer ?? raw.answer_index ?? raw.a);
  if (question.length < 3 || choices.length !== 4 || choices.some((c) => !c)) return null;
  if (new Set(choices.map(norm)).size !== 4) return null;
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null;
  return {
    id: typeof raw.id === 'string' && /^[a-f0-9]{6,16}$/.test(raw.id) ? raw.id : crypto.randomBytes(5).toString('hex'),
    question, choices, answer,
    hint: String(raw.hint ?? raw.hint_ko ?? raw.h ?? '').trim().slice(0, 80),
    type: String(raw.type || '').slice(0, 20),
  };
}

function rebuild() { index = new Map(bank.map((q) => [q.id, q])); version++; }

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(bank, null, 1));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) { console.error('[quiz] 저장 실패', e.message); }
  }, 400);
}

function load() {
  try { bank = JSON.parse(fs.readFileSync(FILE, 'utf8')).map(sanitize).filter(Boolean); } catch { bank = []; }
  if (!bank.length) bank = SAMPLE.map(sanitize).filter(Boolean);
  rebuild();
}

function add(list, { replace = false } = {}) {
  if (replace) bank = [];
  const seen = new Set(bank.map(keyOf));
  let added = 0;
  for (const raw of list || []) {
    const q = sanitize({ ...raw, id: undefined });
    if (!q) continue;
    const k = keyOf(q);
    if (seen.has(k)) continue;
    seen.add(k);
    bank.push(q);
    added++;
  }
  rebuild();
  save();
  return added;
}

function remove(id) { const n = bank.length; bank = bank.filter((q) => q.id !== id); rebuild(); save(); return n !== bank.length; }
function clear() { bank = []; rebuild(); save(); }
function resetToSample() { bank = SAMPLE.map(sanitize).filter(Boolean); rebuild(); save(); }
function all() { return bank; }
function count() { return bank.length; }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function drawFor(rec, guard = 0) {
  if (!bank.length || guard > 2) return null;
  if (rec.deckVer !== version || !rec.deck || !rec.deck.length) {
    let pool = bank.filter((q) => !rec.served.has(q.id));
    if (!pool.length) { rec.served.clear(); rec.cycle++; pool = bank.slice(); }
    rec.deck = shuffle(pool.map((q) => q.id));
    rec.deckVer = version;
  }
  while (rec.deck.length) {
    const q = index.get(rec.deck.pop());
    if (!q) continue;
    rec.served.add(q.id);
    // 보기 순서를 매번 섞는다 → 두 바퀴째부터는 "살짝 바뀐" 문제가 된다
    const order = shuffle([0, 1, 2, 3]);
    return { id: q.id, question: q.question, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer), hint: q.hint };
  }
  return drawFor(rec, guard + 1);
}

load();
module.exports = { add, remove, clear, resetToSample, all, count, drawFor, sanitize };
