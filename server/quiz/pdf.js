'use strict';
/* PDF → 쪽별 텍스트. unpdf(최신 pdf.js 서버용 빌드)를 쓴다. ESM 전용이라 동적 import. */

function parseRange(str) {
  // "120-140, 150" → Set{120..140,150}. 비어 있으면 null(전체)
  const s = String(str || '').replace(/\s/g, '');
  if (!s) return null;
  const set = new Set();
  for (const part of s.split(',')) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] || m[1]);
    for (let p = Math.min(a, b); p <= Math.max(a, b) && set.size < 2000; p++) set.add(p);
  }
  return set.size ? set : null;
}

function cleanPage(t) {
  return String(t || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map((l) => l.trim())
    .filter((l) => l && !/^\d{1,4}$/.test(l))   // 쪽 번호만 있는 줄 제거
    .join('\n');
}

async function extractPdfText(buffer, pageSet) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = [];
  text.forEach((t, i) => { if (!pageSet || pageSet.has(i + 1)) pages.push(cleanPage(t)); });
  return { totalPages, usedPages: pages.length, text: pages.join('\n\n') };
}

module.exports = { extractPdfText, parseRange };
