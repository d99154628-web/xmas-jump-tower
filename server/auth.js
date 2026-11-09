'use strict';
/* 교사 인증: 비밀번호(기본 0634) → 12시간짜리 토큰. REST 는 x-admin-token 헤더, 소켓은 handshake.auth.token */
const crypto = require('crypto');

const PASSWORD = String(process.env.ADMIN_PASSWORD || '0634');
const TTL = 12 * 60 * 60 * 1000;
const tokens = new Map();      // token -> expiresAt
const attempts = new Map();    // ip -> [timestamps]  (4자리 비밀번호 무차별 대입 방지)

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function allowAttempt(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  attempts.set(ip, list);
  return list.length <= 10;
}

function login(password) {
  if (!safeEqual(password, PASSWORD)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TTL);
  return token;
}

function verify(token) {
  if (!token || typeof token !== 'string') return false;
  const exp = tokens.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { tokens.delete(token); return false; }
  return true;
}

function middleware(req, res, next) {
  if (verify(req.get('x-admin-token'))) return next();
  res.status(401).json({ ok: false, error: '교사 인증이 필요해요.' });
}

module.exports = { login, verify, middleware, allowAttempt };
