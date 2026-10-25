// CRM АУ внутри сайта: интерфейс, вход с паролем и кодом, права помощников, журнал действий.
// Подключается в serve.mjs по адресу /crm/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as auth from './lib/auth.mjs';
import { openStore, normalizeProcedure, diffProcedure } from './lib/store.mjs';
import { convertSiriusExport, mergeProcedures } from './lib/sirius.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(ROOT, 'app');
const SIRIUS_ORIGIN = 'https://xn----ptbavjdcddt.xn--p1ai';
const COOKIE = 'crm_session';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'Неверный формат запроса'); }
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && body !== null;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createCrm({ dataDir = path.join(ROOT, 'данные'), trustProxy = process.env.TRUST_PROXY === '1' } = {}) {
  const store = openStore(dataDir);
  const { data, users } = store;
  const dummyHash = auth.hashPassword('dummy-password-1');

  const clientIp = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const isLoopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
  const isHttps = req => req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const sessionCookie = (req, token, maxAge) =>
    `${COOKIE}=${token}; Path=/crm; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

  const findUser = id => users.find(u => u.id === id);
  const isOwner = u => u.role === 'owner';
  const canSee = (u, p) => isOwner(u) || p.assignees.includes(u.id);
  const publicUser = u => ({ id: u.id, login: u.login, name: u.name, role: u.role, must_change_password: !!u.must_change_password });
  const userRow = u => ({
    ...publicUser(u), active: u.active, totp_enabled: !!u.totp_enabled, created_at: u.created_at, last_login: u.last_login || '',
    assigned: data.procedures.filter(p => p.assignees.includes(u.id)).length,
  });
  const audit = (req, user, action, extra = {}) =>
    store.audit({ user_id: user?.id || '', user_name: user?.name || extra.login || '', ip: clientIp(req), action, ...extra });

  function enrollStage(user) {
    const secret = auth.newTotpSecret();
    const ticket = auth.createTicket({ userId: user.id, stage: 'enroll', secret });
    return { stage: 'enroll', ticket, secret, uri: auth.otpauthUri(secret, user.login) };
  }

  function startSession(req, res, user) {
    const token = auth.createSession(user.id);
    user.last_login = new Date().toISOString();
    store.saveUsers();
    audit(req, user, 'login');
    send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, 12 * 3600) });
  }

  // ---------- Вход ----------

  async function login(req, res) {
    const { login = '', password = '' } = await readJson(req);
    const key = 'login:' + String(login).trim().toLowerCase();
    const ipKey = 'ip:' + clientIp(req);
    if (auth.isLocked(key) || auth.isLocked(ipKey)) throw new HttpError(429, 'Слишком много неудачных попыток. Подождите 15 минут.');
    const user = users.find(u => u.active && u.login.toLowerCase() === String(login).trim().toLowerCase());
    const ok = auth.verifyPassword(password, user ? user.pass : dummyHash) && !!user;
    if (!ok) {
      auth.noteFailure(key);
      auth.noteFailure(ipKey, 20);
      audit(req, null, 'login_failed', { login: String(login).slice(0, 80) });
      throw new HttpError(401, 'Неверный логин или пароль');
    }
    auth.clearFailures(key);
    if (!user.totp_enabled) return send(res, 200, enrollStage(user));
    return send(res, 200, { stage: 'totp', ticket: auth.createTicket({ userId: user.id, stage: 'totp' }) });
  }

  async function loginTotp(req, res) {
    const { ticket, code } = await readJson(req);
    const t = auth.takeTicket(ticket, true);
    if (!t || t.stage !== 'totp') throw new HttpError(401, 'Время на ввод кода вышло. Войдите заново.');
    const user = findUser(t.userId);
    const key = 'totp:' + t.userId;
    if (!user || !user.active) throw new HttpError(401, 'Учётная запись отключена');
    if (auth.isLocked(key)) throw new HttpError(429, 'Слишком много неверных кодов. Подождите 15 минут.');
    const step = auth.verifyTotp(user.totp_secret, code, user.totp_last ?? -1);
    if (step === null) {
      auth.noteFailure(key);
      audit(req, user, 'totp_failed');
      throw new HttpError(401, 'Неверный код. Введите код, который сейчас показывает приложение.');
    }
    auth.takeTicket(ticket);
    auth.clearFailures(key);
    user.totp_last = step;
    startSession(req, res, user);
  }

  async function loginEnroll(req, res) {
    const { ticket, code } = await readJson(req);
    const t = auth.takeTicket(ticket, true);
    if (!t || t.stage !== 'enroll') throw new HttpError(401, 'Время на подключение кода вышло. Войдите заново.');
    const user = findUser(t.userId);
    if (!user || !user.active) throw new HttpError(401, 'Учётная запись отключена');
    const step = auth.verifyTotp(t.secret, code);
    if (step === null) throw new HttpError(401, 'Код не подошёл. Проверьте, что время на телефоне точное, и введите новый код.');
    auth.takeTicket(ticket);
    user.totp_secret = t.secret;
    user.totp_enabled = true;
    user.totp_last = step;
    audit(req, user, 'totp_enrolled');
    startSession(req, res, user);
  }

  async function setup(req, res) {
    if (users.length) throw new HttpError(403, 'Владелец уже создан');
    if (!isLoopback(clientIp(req))) throw new HttpError(403, 'Первую учётную запись можно создать только на компьютере, где работает CRM');
    const { login = '', name = '', password = '' } = await readJson(req);
    if (String(login).trim().length < 3) throw new HttpError(400, 'Укажите логин (например, почту)');
    if (!String(name).trim()) throw new HttpError(400, 'Укажите имя');
    const weak = auth.checkPasswordStrength(password);
    if (weak) throw new HttpError(400, weak);
    const owner = {
      id: randomUUID(), login: String(login).trim(), name: String(name).trim(), role: 'owner', active: true,
      pass: auth.hashPassword(password), totp_enabled: false, created_at: new Date().toISOString(),
    };
    users.push(owner);
    store.saveUsers();
    audit(req, owner, 'owner_created');
    send(res, 200, enrollStage(owner));
  }

  // ---------- Данные ----------

  function dataFor(user) {
    return {
      me: publicUser(user),
      // Помощнику реквизиты и шаблоны нужны для документов; менять их он не может.
      settings: isOwner(user) ? data.settings : {
        report_period_default: data.settings.report_period_default,
        au_profile: data.settings.au_profile || {},
        addressees: data.settings.addressees || {},
        doc_templates: data.settings.doc_templates || [],
      },
      procedures: data.procedures.filter(p => canSee(user, p)),
      // Помощнику нужны имена коллег: он подключает их к своим процедурам.
      users: users.filter(u => isOwner(user) || u.active).map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active })),
      updated_at: data.updated_at,
    };
  }

  function getProcedure(user, id) {
    const p = data.procedures.find(x => x.id === id);
    if (!p || !canSee(user, p)) throw new HttpError(404, 'Процедура не найдена');
    return p;
  }

  async function updateProcedure(req, res, user, id) {
    const p = getProcedure(user, id);
    const body = await readJson(req);
    if (Number(body.rev) !== p.rev) {
      throw new HttpError(409, `Карточку только что изменил(а) ${p.updated_by || 'другой пользователь'}`, { procedure: p });
    }
    const incoming = normalizeProcedure({ ...body.procedure });
    for (const k of ['id', 'sirius_id', 'source', 'created_at', 'created_by', 'imported_at']) incoming[k] = p[k];
    if (isOwner(user)) incoming.assignees = incoming.assignees.filter(uid => users.some(u => u.id === uid));
    else {
      // Помощник подключает и снимает других активных помощников. Себя снять не может, отключённых коллег не трогает.
      const activeAssistant = uid => users.some(u => u.id === uid && u.role === 'assistant' && u.active);
      const kept = p.assignees.filter(uid => users.some(u => u.id === uid) && !activeAssistant(uid));
      incoming.assignees = [...new Set([...kept, user.id, ...incoming.assignees.filter(activeAssistant)])];
    }
    const changes = diffProcedure(p, incoming);
    if (!changes.length) return send(res, 200, { ok: true, rev: p.rev, updated_at: p.updated_at, updated_by: p.updated_by });
    incoming.rev = p.rev + 1;
    incoming.updated_at = new Date().toISOString();
    incoming.updated_by = user.name;
    data.procedures[data.procedures.indexOf(p)] = incoming;
    store.saveData();
    audit(req, user, 'procedure_update', { procedure_id: p.id, debtor: incoming.debtor.name || '', changes });
    send(res, 200, { ok: true, rev: incoming.rev, updated_at: incoming.updated_at, updated_by: incoming.updated_by });
  }

  async function createProcedure(req, res, user) {
    const body = await readJson(req);
    const now = new Date().toISOString();
    const p = normalizeProcedure({ ...body.procedure, id: randomUUID(), rev: 1, source: 'manual', created_at: now, created_by: user.name, updated_at: now, updated_by: user.name });
    // Процедуру помощника сразу закрепляем за ним, иначе он её не увидит.
    p.assignees = isOwner(user) ? p.assignees.filter(uid => users.some(u => u.id === uid)) : [user.id];
    data.procedures.push(p);
    store.saveData();
    audit(req, user, 'procedure_create', { procedure_id: p.id, debtor: p.debtor.name || '' });
    send(res, 200, { procedure: p });
  }

  function deleteProcedure(req, res, user, id) {
    const p = getProcedure(user, id);
    data.procedures.splice(data.procedures.indexOf(p), 1);
    store.saveData();
    audit(req, user, 'procedure_delete', { procedure_id: p.id, debtor: p.debtor.name || '' });
    send(res, 200, { ok: true });
  }

  async function updateSettings(req, res, user) {
    const { settings = {} } = await readJson(req);
    data.settings.report_period_default = Number(settings.report_period_default) || 3;
    if (Array.isArray(settings.au_docs)) data.settings.au_docs = settings.au_docs.map(d => ({ id: String(d.id), title: String(d.title), until: String(d.until || '') }));
    const str = (v, max) => String(v ?? '').slice(0, max);
    if (settings.au_profile && typeof settings.au_profile === 'object') {
      data.settings.au_profile = Object.fromEntries(Object.entries(settings.au_profile).slice(0, 60).map(([k, v]) => [str(k, 40), str(v, 500)]));
    }
    if (settings.addressees && typeof settings.addressees === 'object') {
      data.settings.addressees = Object.fromEntries(Object.entries(settings.addressees).slice(0, 100)
        .map(([k, v]) => [str(k, 40), { name: str(v?.name, 300), address: str(v?.address, 500) }]));
    }
    if (Array.isArray(settings.doc_templates)) {
      data.settings.doc_templates = settings.doc_templates.slice(0, 200).map(t => ({
        id: str(t.id, 60), title: str(t.title, 200), kind: t.kind === 'court' ? 'court' : 'letter', doc_title: str(t.doc_title, 200),
        addressee: str(t.addressee, 300), address: str(t.address, 500), body: str(t.body, 30000), attachments: str(t.attachments, 3000),
      }));
    }
    store.saveData();
    audit(req, user, 'settings_update');
    send(res, 200, { ok: true });
  }

  // ---------- Пользователи ----------

  async function createUser(req, res, user) {
    const { login = '', name = '' } = await readJson(req);
    const l = String(login).trim();
    if (l.length < 3) throw new HttpError(400, 'Укажите логин (например, почту помощника)');
    if (!String(name).trim()) throw new HttpError(400, 'Укажите имя помощника');
    if (users.some(u => u.login.toLowerCase() === l.toLowerCase())) throw new HttpError(400, 'Такой логин уже есть');
    const temp = auth.temporaryPassword();
    const u = {
      id: randomUUID(), login: l, name: String(name).trim(), role: 'assistant', active: true,
      pass: auth.hashPassword(temp), must_change_password: true, totp_enabled: false, created_at: new Date().toISOString(),
    };
    users.push(u);
    store.saveUsers();
    audit(req, user, 'user_create', { target: u.name });
    send(res, 200, { user: userRow(u), temp_password: temp });
  }

  async function updateUser(req, res, user, id) {
    const u = findUser(id);
    if (!u) throw new HttpError(404, 'Пользователь не найден');
    const body = await readJson(req);
    const done = [];
    let temp;
    if (body.name !== undefined && String(body.name).trim()) { u.name = String(body.name).trim(); done.push('имя'); }
    if (body.active !== undefined && u.id !== user.id) {
      u.active = !!body.active;
      if (!u.active) auth.dropUserSessions(u.id);
      done.push(u.active ? 'включён' : 'отключён');
    }
    if (body.reset_password && u.id !== user.id) {
      temp = auth.temporaryPassword();
      u.pass = auth.hashPassword(temp);
      u.must_change_password = true;
      auth.dropUserSessions(u.id);
      done.push('сброшен пароль');
    }
    if (body.reset_totp && u.id !== user.id) {
      u.totp_enabled = false;
      u.totp_secret = null;
      u.totp_last = -1;
      auth.dropUserSessions(u.id);
      done.push('сброшен код входа');
    }
    store.saveUsers();
    audit(req, user, 'user_update', { target: u.name, details: done.join(', ') });
    send(res, 200, { user: userRow(u), temp_password: temp });
  }

  async function setAssignments(req, res, user, id) {
    const u = findUser(id);
    if (!u) throw new HttpError(404, 'Пользователь не найден');
    const { procedure_ids = [] } = await readJson(req);
    const want = new Set(procedure_ids);
    let added = 0, removed = 0;
    const now = new Date().toISOString();
    for (const p of data.procedures) {
      const has = p.assignees.includes(u.id);
      if (want.has(p.id) && !has) { p.assignees.push(u.id); added++; }
      else if (!want.has(p.id) && has) { p.assignees = p.assignees.filter(x => x !== u.id); removed++; }
      else continue;
      p.rev += 1;
      p.updated_at = now;
      p.updated_by = user.name;
    }
    store.saveData();
    audit(req, user, 'assignments', { target: u.name, details: `назначено ${added}, снято ${removed}` });
    send(res, 200, { ok: true, added, removed });
  }

  async function changePassword(req, res, user) {
    const { current = '', password = '' } = await readJson(req);
    if (!auth.verifyPassword(current, user.pass)) throw new HttpError(400, 'Текущий пароль указан неверно');
    const weak = auth.checkPasswordStrength(password);
    if (weak) throw new HttpError(400, weak);
    if (current === password) throw new HttpError(400, 'Новый пароль должен отличаться от текущего');
    user.pass = auth.hashPassword(password);
    user.must_change_password = false;
    store.saveUsers();
    audit(req, user, 'password_change');
    send(res, 200, { ok: true, user: publicUser(user) });
  }

  // ---------- Разовый импорт из Сириуса (по токену из файла) ----------

  async function siriusImport(req, res, url) {
    const cors = req.headers.origin === SIRIUS_ORIGIN
      ? { 'Access-Control-Allow-Origin': SIRIUS_ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true' }
      : {};
    if (req.method === 'OPTIONS') return send(res, 204, '', cors);
    const token = fs.existsSync(store.tokenFile) ? fs.readFileSync(store.tokenFile, 'utf8').trim() : '';
    if (!token || url.searchParams.get('token') !== token) throw new HttpError(403, 'Импорт не разрешён');
    const raw = await readBody(req);
    const isForm = (req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded');
    const exported = JSON.parse(isForm ? new URLSearchParams(raw).get('payload') : raw);
    const stats = mergeProcedures(data, convertSiriusExport(exported));
    data.procedures.forEach(normalizeProcedure);
    store.saveData();
    fs.unlinkSync(store.tokenFile);
    store.audit({ user_id: '', user_name: 'Импорт из Сириуса', ip: clientIp(req), action: 'import', details: `добавлено ${stats.added}, обновлено ${stats.updated}` });
    if (isForm) return send(res, 303, '', { Location: `/crm/#/procedures?imported=${stats.added + stats.updated}` });
    send(res, 200, { ok: true, ...stats }, cors);
  }

  // ---------- Маршруты API ----------

  async function api(req, res, route, url) {
    const m = req.method;
    if (route === 'import/sirius') return siriusImport(req, res, url);
    // Изменяющие запросы принимаются только от интерфейса CRM (защита от подделки запросов с чужих сайтов).
    if (m !== 'GET' && req.headers['x-crm'] !== '1') throw new HttpError(403, 'Запрос отклонён');

    if (route === 'setup' && m === 'GET') return send(res, 200, { needed: users.length === 0 });
    if (route === 'setup' && m === 'POST') return setup(req, res);
    if (route === 'login' && m === 'POST') return login(req, res);
    if (route === 'login/totp' && m === 'POST') return loginTotp(req, res);
    if (route === 'login/enroll' && m === 'POST') return loginEnroll(req, res);

    const token = cookies(req)[COOKIE];
    const session = auth.getSession(token);
    const user = session && findUser(session.userId);
    if (!user || !user.active) throw new HttpError(401, 'Нужно войти');

    if (route === 'logout' && m === 'POST') {
      auth.dropSession(token);
      audit(req, user, 'logout');
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    if (route === 'session' && m === 'GET') return send(res, 200, { user: publicUser(user) });
    if (route === 'me/password' && m === 'POST') return changePassword(req, res, user);
    if (user.must_change_password) throw new HttpError(403, 'Сначала смените временный пароль');

    if (route === 'data' && m === 'GET') return send(res, 200, dataFor(user));
    let r = route.match(/^procedures\/([\w-]+)$/);
    if (r && m === 'PUT') return updateProcedure(req, res, user, r[1]);

    // Помощник создаёт процедуры (они закрепляются за ним) и удаляет закреплённые за ним: getProcedure отвечает 404 на чужие.
    if (route === 'procedures' && m === 'POST') return createProcedure(req, res, user);
    if (r && m === 'DELETE') return deleteProcedure(req, res, user, r[1]);

    if (!isOwner(user)) throw new HttpError(403, 'Недостаточно прав');
    if (route === 'settings' && m === 'PUT') return updateSettings(req, res, user);
    if (route === 'users' && m === 'GET') return send(res, 200, { users: users.map(userRow) });
    if (route === 'users' && m === 'POST') return createUser(req, res, user);
    r = route.match(/^users\/([\w-]+)$/);
    if (r && m === 'PATCH') return updateUser(req, res, user, r[1]);
    r = route.match(/^users\/([\w-]+)\/assignments$/);
    if (r && m === 'PUT') return setAssignments(req, res, user, r[1]);
    if (route === 'audit' && m === 'GET') {
      return send(res, 200, { entries: store.readAudit({ userId: url.searchParams.get('user') || '', procedureId: url.searchParams.get('procedure') || '', limit: 500 }) });
    }
    throw new HttpError(404, 'Нет такого запроса');
  }

  // sub — путь после /crm, например «/», «/app.js», «/api/data».
  return async function handle(req, res, sub, url) {
    try {
      if (sub === '') return send(res, 301, '', { Location: '/crm/' });
      if (sub.startsWith('/api/')) return await api(req, res, sub.slice(5), url);
      if (req.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
      const rel = sub === '/' ? 'index.html' : sub.replace(/^\/+/, '');
      const file = path.normalize(path.join(APP_DIR, rel));
      if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new HttpError(404, 'Не найдено');
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      const status = err instanceof HttpError ? err.status : 500;
      send(res, status, { error: err instanceof HttpError ? err.message : 'Внутренняя ошибка CRM', ...(err.extra || {}) });
    }
  };
}
