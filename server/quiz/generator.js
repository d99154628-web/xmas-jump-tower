'use strict';
/*
 * 교사용 지도서 텍스트 → LLM(OpenAI) → 4지선다 문제.
 *  1) 텍스트를 약 4,500자 조각으로 나눔
 *  2) 영어 단어가 많은 조각을 우선 골라(지도서의 한국어 지도 절차는 건너뜀) 최대 N개만 사용 → 비용 제한
 *  3) 조각마다 Structured Outputs(JSON Schema) 로 문제를 받음 — 4개씩 동시에 요청
 *  4) 검증·중복 제거 후, 조각이 끝날 때마다 바로 게임 문제은행에 넣음(onBatch)
 */
const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_CHUNKS = Number(process.env.QUIZ_MAX_CHUNKS) || 14;
const CONCURRENCY = 4;

let client = null;
const hasApiKey = () => !!process.env.OPENAI_API_KEY;
const getClient = () => (client ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000, maxRetries: 2 }));

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'question', 'choices', 'answer_index', 'hint_ko'],
        properties: {
          type: { type: 'string', enum: ['vocab_meaning', 'vocab_word', 'dialogue', 'fill_blank', 'grammar', 'reading'] },
          question: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answer_index: { type: 'integer' },
          hint_ko: { type: 'string' },
        },
      },
    },
  },
};

function systemPrompt(grade) {
  return [
    `You write English quiz items for Korean elementary school students (${grade}, CEFR pre-A1~A1).`,
    'The input is an excerpt from a Korean English-teacher\'s guidebook. It mixes Korean teaching procedures with the English learning content.',
    'Use ONLY the English learning content in the excerpt: key expressions, dialogues, vocabulary, chants, story lines, grammar points.',
    'Ignore Korean classroom procedures, objectives, evaluation rubrics and page numbers.',
    'Rules:',
    '- Every item is 4-option multiple choice with exactly ONE correct answer; distractors must be clearly wrong but plausible.',
    '- Mix types: Korean meaning → English word, English word → Korean meaning, "A: ... B: ___" dialogue response, fill in the blank, simple grammar.',
    '- Keep question text under 90 characters and each choice under 40 characters. Easy, friendly words only.',
    '- Korean may appear only in meaning questions and in hint_ko.',
    '- hint_ko: a short Korean hint (max 25 chars) that does NOT reveal the answer.',
    '- answer_index is 0-3; spread the correct position evenly.',
    '- Never write "all of the above"/"none of the above". No duplicate items.',
  ].join('\n');
}

function chunkText(text, size = 4500) {
  const lines = String(text).split('\n');
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    if (cur.length + line.length + 1 > size && cur.length > size * 0.4) { chunks.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

const englishScore = (s) => (String(s).match(/[A-Za-z]{2,}/g) || []).length;

function pickChunks(chunks, max) {
  const scored = chunks.map((c, i) => ({ c, i, s: englishScore(c) })).filter((x) => x.s >= 15);
  if (scored.length <= max) return scored.map((x) => x.c);
  return scored.sort((a, b) => b.s - a.s).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.c);
}

async function askLLM(chunk, n, focus, grade) {
  const user = [
    'Guidebook excerpt:',
    '"""',
    chunk,
    '"""',
    focus ? `Teacher's focus: ${focus}` : '',
    `Write exactly ${n} items.`,
  ].filter(Boolean).join('\n');
  const res = await getClient().chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_schema', json_schema: { name: 'quiz_batch', strict: true, schema: SCHEMA } },
    messages: [{ role: 'system', content: systemPrompt(grade) }, { role: 'user', content: user }],
  });
  const msg = res.choices && res.choices[0] && res.choices[0].message;
  if (!msg || msg.refusal) throw new Error('AI가 응답을 거절했어요.');
  const parsed = JSON.parse(msg.content || '{}');
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

async function generateQuestions(text, { count = 120, focus = '', grade = '초등 6학년', onProgress, onBatch } = {}) {
  if (!hasApiKey()) throw new Error('서버에 OPENAI_API_KEY 가 설정되지 않았어요(.env 확인).');
  const chunks = pickChunks(chunkText(text), MAX_CHUNKS);
  if (!chunks.length) throw new Error('PDF에서 영어 학습 내용을 찾지 못했어요. 쪽 범위를 확인해 주세요.');
  // 중복·불량 문제가 걸러질 것을 감안해 25% 더 요청
  const per = Math.min(40, Math.max(6, Math.ceil((count * 1.25) / chunks.length)));
  let done = 0;
  let produced = 0;
  let lastError = null;

  await mapLimit(chunks, CONCURRENCY, async (chunk) => {
    try {
      const qs = await askLLM(chunk, per, focus, grade);
      produced += qs.length;
      if (onBatch && qs.length) onBatch(qs);
    } catch (e) {
      lastError = e;
      console.error('[quiz] 조각 생성 실패:', e.message);
    }
    done++;
    if (onProgress) onProgress(done, chunks.length);
  });

  if (!produced && lastError) throw new Error('문제 생성 실패: ' + lastError.message);
  return produced;
}

module.exports = { generateQuestions, hasApiKey, chunkText, pickChunks, MODEL };
