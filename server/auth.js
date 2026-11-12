// Accounts: names, passwords, sessions, and a small request limiter.
const crypto = require('crypto');
const { promisify } = require('util');
const { q, qSafe } = require('./db');
const { ApiError, bad } = require('./util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

// Passwords are stored as "s1$N$r$p$salt$key" (scrypt, random salt per account).
async function hashPassword(pass) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pass.normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return ['s1', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pass, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 's1') return false;
  const want = Buffer.from(parts[5], 'base64');
  const N = +parts[1], r = +parts[2], p = +parts[3];
  if (!(N >= 1024 && N <= 1 << 17) || !(r >= 1 && r <= 16) || !(p >= 1 && p <= 4) || want.length < 16) return false;
  const got = await scrypt(String(pass).normalize('NFKC'), Buffer.from(parts[4], 'base64'), want.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return crypto.timingSafeEqual(want, got);
}
// Spends the same time as a real check, so a wrong name and a wrong password look alike from outside.
let dummy = null;
async function fakeVerify(pass) {
  if (!dummy) dummy = hashPassword('not-a-real-password');
  await verifyPassword(pass, await dummy);
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,15}$/u;
const NAME_RULE = 'Use 3 to 16 letters, numbers, dots, dashes or underscores, starting with a letter or number.';
function cleanName(raw) {
  const name = String(raw == null ? '' : raw).normalize('NFKC').trim();
  if (!NAME_RE.test(name)) throw bad('name', NAME_RULE);
  return name;
}
const nameKey = (name) => name.toLowerCase();
function cleanPass(raw) {
  const pass = typeof raw === 'string' ? raw : '';
  if (pass.length < 6) throw bad('pass', 'The password needs at least 6 characters.');
  if (pass.length > 100) throw bad('pass', 'The password can be at most 100 characters.');
  return pass;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function bearer(headers) {
  const h = headers && (headers.authorization || headers.Authorization);
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(String(h || '').trim());
  return m ? m[1] : '';
}
async function createSession(userId) {
  const token = newToken();
  await q(`INSERT INTO gc_sessions (token_hash, user_id) VALUES ($1, $2)`, [tokenHash(token), userId]);
  return token;
}
// Who is asking. Also keeps "last seen" fresh (at most every 20 s) so others can tell who is online.
async function userFromRequest(headers) {
  const token = bearer(headers);
  if (!token) throw new ApiError(401, 'auth', 'Please log in.');
  const hash = tokenHash(token);
  const rows = await qSafe(
    `SELECT u.id, u.name, u.rev,
            (extract(epoch FROM now() - u.seen_at))::float8 AS idle,
            (extract(epoch FROM now() - s.seen_at))::float8 AS sidle
       FROM gc_sessions s JOIN gc_users u ON u.id = s.user_id
      WHERE s.token_hash = $1`, [hash]);
  if (!rows.length) throw new ApiError(401, 'auth', 'Your session ended. Please log in again.');
  const u = rows[0];
  if (u.sidle > SESSION_DAYS * 86400) {
    await q(`DELETE FROM gc_sessions WHERE token_hash = $1`, [hash]);
    throw new ApiError(401, 'auth', 'Your session ended. Please log in again.');
  }
  if (u.idle > 20) await qSafe(`UPDATE gc_users SET seen_at = now() WHERE id = $1`, [u.id]);
  if (u.sidle > 43200) await qSafe(`UPDATE gc_sessions SET seen_at = now() WHERE token_hash = $1`, [hash]);
  return { id: u.id, name: u.name, rev: u.rev, tokenHash: hash };
}
const SESSION_DAYS = 120;

// Counts a hit for key and throws when there were more than max inside the window.
async function limit(key, max, windowSec, message) {
  const rows = await qSafe(
    `INSERT INTO gc_limits (key, hits, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN gc_limits.reset_at < now() THEN 1 ELSE gc_limits.hits + 1 END,
       reset_at = CASE WHEN gc_limits.reset_at < now() THEN EXCLUDED.reset_at ELSE gc_limits.reset_at END
     RETURNING hits, GREATEST(0, extract(epoch FROM reset_at - now()))::float8 AS wait`, [String(key).slice(0, 120), windowSec]);
  if (Math.random() < 0.02) q(`DELETE FROM gc_limits WHERE reset_at < now() - interval '1 hour'`).catch(() => {});
  if (rows[0].hits > max) {
    const mins = Math.max(1, Math.ceil(rows[0].wait / 60));
    throw new ApiError(429, 'slow_down', message || ('Too many tries. Wait about ' + mins + ' minute' + (mins === 1 ? '' : 's') + ' and try again.'));
  }
}
const unlimit = (key) => q(`DELETE FROM gc_limits WHERE key = $1`, [String(key).slice(0, 120)]).catch(() => {});

module.exports = { hashPassword, verifyPassword, fakeVerify, cleanName, nameKey, cleanPass, createSession, userFromRequest, tokenHash, limit, unlimit, NAME_RULE, SESSION_DAYS };
