// Пароли (scrypt), одноразовые коды TOTP (RFC 6238) и сессии CRM.
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), 64, SCRYPT);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'base64'));
}

export function checkPasswordStrength(password) {
  const p = String(password || '');
  if (p.length < 10) return 'Пароль должен быть не короче 10 символов';
  if (!/\d/.test(p) || !/[^\d]/.test(p)) return 'В пароле должны быть и буквы, и цифры';
  return '';
}

// Временный пароль для нового помощника: без похожих символов (0/O, 1/l).
export function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8) + '7';
}

// ---------- TOTP ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s) {
  let bits = '';
  for (const c of String(s).toUpperCase()) {
    const v = B32.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Возвращает номер принятого 30-секундного шага или null.
// Код с шагом не новее lastCounter не принимается повторно.
export function verifyTotp(secret, code, lastCounter = -1) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastCounter) continue;
    if (crypto.timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(clean))) return step;
  }
  return null;
}

export function otpauthUri(secret, login) {
  const issuer = 'Siliveev CRM';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${login}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- Сессии и попытки входа ----------

const IDLE_MS = 4 * 60 * 60 * 1000;
const MAX_MS = 12 * 60 * 60 * 1000;
const TICKET_MS = 5 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const sessions = new Map();
const tickets = new Map();
const fails = new Map();

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(token, { userId, created: now, seen: now });
  return token;
}

export function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.seen > IDLE_MS || now - s.created > MAX_MS) { sessions.delete(token); return null; }
  s.seen = now;
  return s;
}

export function dropSession(token) {
  sessions.delete(token);
}

export function dropUserSessions(userId) {
  for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t);
}

// Промежуточный билет между вводом пароля и вводом кода.
export function createTicket(data) {
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticket, { ...data, created: Date.now() });
  return ticket;
}

export function takeTicket(ticket, keep = false) {
  const t = tickets.get(ticket);
  if (!t) return null;
  if (Date.now() - t.created > TICKET_MS) { tickets.delete(ticket); return null; }
  if (!keep) tickets.delete(ticket);
  return t;
}

export function isLocked(key) {
  const f = fails.get(key);
  return !!(f && f.until > Date.now());
}

// После max неудач подряд ключ блокируется на 15 минут. Для логина хватает 5,
// для IP порог выше: помощники в одном офисе выходят в интернет с одного адреса.
export function noteFailure(key, max = MAX_FAILS) {
  const f = fails.get(key) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= max) { f.until = Date.now() + LOCK_MS; f.count = 0; }
  fails.set(key, f);
}

export function clearFailures(key) {
  fails.delete(key);
}
