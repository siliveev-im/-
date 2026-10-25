'use strict';

// ---------- Справочники ----------

const STATUS = {
  active: 'Активная',
  completed: 'Завершена',
  terminated: 'Прекращена',
  released: 'АУ освобождён',
  removed: 'АУ отстранён',
};
const PROC_TYPES = [
  'Наблюдение', 'Финансовое оздоровление', 'Внешнее управление', 'Конкурсное производство',
  'Реструктуризация долгов гражданина', 'Реализация имущества гражданина',
];
const DEBTOR_CATEGORIES = [
  'Должник не относится к отдельным категориям', 'Градообразующая организация', 'Застройщик',
  'Иная финансовая организация', 'Кредитная организация', 'Ликвидируемый должник',
  'Негосударственный пенсионный фонд', 'Отсутствующий должник', 'Сельскохозяйственная организация',
  'Стратегическое предприятие и организация', 'Страховая организация', 'Субъект естественных монополий',
  'Управляющая компания многоквартирными домами',
];
const INVOLVE_TYPES = [
  'Оценщик', 'Юридическое сопровождение', 'Делопроизводство', 'Организатор торгов', 'Архиватор',
  'Аудитор', 'Эксперт', 'Оператор электронной площадки', 'Реестродержатель', 'Ответственный хранитель',
];
const PAYMENT_SOURCES = ['средства должника', 'средства кредитора', 'средства арбитражного управляющего', 'средства акционера/участника общества'];
const ACCOUNT_KINDS = [
  'Основной', 'Специальный — исполнение обязательств должника', 'Специальный — задатки по залогу',
  'Специальный — реализация залога', 'Специальный — резерв процентов по вознаграждению',
];
const PUB_KINDS = ['ЕФРСБ', 'Коммерсантъ', 'Местное издание'];
const PUB_TYPES = [
  'О введении наблюдения', 'О введении финансового оздоровления', 'О введении внешнего управления',
  'О признании банкротом', 'О введении реструктуризации долгов', 'О введении реализации имущества',
  'О собрании кредиторов', 'О результатах собрания кредиторов', 'О проведении торгов', 'О результатах торгов',
  'Об оценке имущества', 'О заключении договора купли-продажи', 'О прекращении производства',
  'О завершении процедуры', 'Об изменении полномочий АУ',
];
const CLAIM_QUEUES = ['1 очередь', '2 очередь', '3 очередь', 'За реестром'];
const DISPUTE_TYPES = ['Оспаривание сделки', 'Истребование документов', 'Истребование имущества', 'Дебиторская задолженность', 'Разрешение разногласий'];
const SENDING = ['кадарбитр', 'почтой', 'сдано нарочно'];
const APPLICANT_TYPES = ['физлицо', 'юрлицо', 'ФНС', 'банк'];
const SRO_STATUSES = ['На модерации', 'На доработке', 'Одобрено', 'Отклонено'];

// ---------- Утилиты ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const todayISO = () => new Date().toLocaleDateString('sv-SE');
const fmtDate = iso => (iso ? iso.split('-').reverse().join('.') : '');
const fmtMoney = v => (v === '' || v == null || isNaN(Number(v)) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const parseMoney = s => {
  const t = String(s ?? '').replace(/\s/g, '').replace(',', '.');
  return t === '' || isNaN(Number(t)) ? '' : Number(t);
};

function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}
const daysUntil = iso => Math.round((Date.parse(iso) - Date.parse(todayISO())) / 86400000);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
}

function shortCourt(name) {
  return (name || '').replace(/^Арбитражный суд /, 'АС ');
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- Данные и сохранение ----------

let DATA = null;
let ME = null;
let USERS = [];
let saveTimer = null;
let saving = false;
let saveAgain = false;
const dirty = new Set();
let settingsDirty = false;

const isOwner = () => ME?.role === 'owner';
const userName = id => USERS.find(u => u.id === id)?.name || 'удалённый пользователь';
const assistants = () => USERS.filter(u => u.role === 'assistant' && u.active);

// Все запросы к серверу CRM. Заголовок X-CRM сервер требует для изменяющих запросов.
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('api/' + path, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CRM': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let res = {};
  try { res = await r.json(); } catch { /* пустой ответ */ }
  if (!r.ok) {
    const err = new Error(res.error || `Ошибка ${r.status}`);
    err.status = r.status;
    err.data = res;
    throw err;
  }
  return res;
}

async function loadData() {
  const d = await api('data');
  ME = d.me;
  USERS = d.users || [];
  DATA = { settings: d.settings || {}, procedures: d.procedures || [], updated_at: d.updated_at };
  DATA.settings.au_docs = DATA.settings.au_docs || [];
  DATA.settings.au_profile = DATA.settings.au_profile || {};
  DATA.settings.addressees = DATA.settings.addressees || {};
  DATA.settings.doc_templates = DATA.settings.doc_templates || [];
  for (const p of DATA.procedures) normalizeProcedure(p);
}

// Списки внутри процедуры. Тот же перечень — в lib/store.mjs.
const PROC_LISTS = [
  'reports', 'claims', 'involved', 'hearings', 'disputes', 'publications', 'accounts', 'tasks',
  'spouses', 'children', 'incomes', 'counterparties', 'costs', 'payments', 'assets', 'receivables',
  'measures', 'workers', 'complaints', 'documents', 'meetings', 'claim_changes',
];

function normalizeProcedure(p) {
  for (const k of PROC_LISTS) p[k] = p[k] || [];
  for (const k of ['rtk', 'analysis', 'report_cfg', 'subsistence', 'expenses']) p[k] = p[k] || {};
  p.debtor = p.debtor || {};
  p.court = p.court || {};
  p.dates = p.dates || {};
  p.applicant = p.applicant || {};
  p.assignees = p.assignees || [];
  return p;
}

function setSaveState(text, isError = false) {
  const el = $('#save-state');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', isError);
}

function scheduleSave() {
  setSaveState('Есть несохранённые изменения…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

// Каждая карточка сохраняется отдельно со своей версией, поэтому правки разных людей не затирают друг друга.
async function saveNow() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  setSaveState('Сохраняю…');
  try {
    for (const id of [...dirty]) {
      dirty.delete(id);
      const p = DATA.procedures.find(x => x.id === id);
      if (!p) continue;
      try {
        const r = await api('procedures/' + id, { method: 'PUT', body: { procedure: p, rev: p.rev } });
        Object.assign(p, { rev: r.rev, updated_at: r.updated_at, updated_by: r.updated_by });
        if ($('#card-head') && location.hash.startsWith(`#/p/${id}`)) drawCardHead(p);
      } catch (err) {
        if (err.status === 409 && err.data.procedure) {
          DATA.procedures[DATA.procedures.indexOf(p)] = normalizeProcedure(err.data.procedure);
          toast(`${err.message}. Показана свежая версия карточки — повторите свою правку.`);
          route();
          continue;
        }
        dirty.add(id);
        throw err;
      }
    }
    if (settingsDirty) {
      settingsDirty = false;
      try { await api('settings', { method: 'PUT', body: { settings: DATA.settings } }); }
      catch (err) { settingsDirty = true; throw err; }
    }
    setSaveState('Сохранено в ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  } catch (err) {
    if (err.status === 401) {
      setSaveState('Сессия закончилась — войдите снова', true);
      showLogin(() => { renderShell(); route(); saveNow(); });
    } else {
      setSaveState('Ошибка сохранения: ' + err.message, true);
    }
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; saveNow(); }
  }
}

function touch(p) {
  if (p) dirty.add(p.id);
  else settingsDirty = true;
  scheduleSave();
}

window.addEventListener('beforeunload', e => {
  if (saving || dirty.size || settingsDirty) e.preventDefault();
});

// ---------- Расчёт сроков ----------

function lastReportDate(p) {
  let best = '';
  for (const r of p.reports) for (const d of [r.meeting_date, r.report_date]) if (d && d > best) best = d;
  return best;
}

// Следующий отчёт: позднейшая из дат «вручную/из Сириуса» и «последний отчёт + период».
// Если отчётов ещё не было, считаем от назначения АУ (или введения процедуры).
// Дату раньше назначения не учитываем: она осталась от прежнего управляющего.
function nextReportDate(p) {
  if (p.status !== 'active') return '';
  const period = Number(p.report_period_months) || Number(DATA.settings.report_period_default) || 3;
  const base = p.dates.appointment || p.dates.introduction || '';
  const last = lastReportDate(p);
  const fromLast = last && last >= base ? addMonths(last, period) : '';
  const manual = p.next_report_date && p.next_report_date > base ? p.next_report_date : '';
  if (fromLast || manual) return [fromLast, manual].filter(Boolean).sort().at(-1);
  return base ? addMonths(base, period) : '';
}

function dueBadge(iso) {
  if (!iso) return '<span class="muted">—</span>';
  const n = daysUntil(iso);
  const cls = n < 0 ? 'bad' : n <= 14 ? 'warn' : '';
  const hint = n < 0 ? `просрочено на ${-n} дн.` : n === 0 ? 'сегодня' : `через ${n} дн.`;
  return `<span class="due ${cls}" title="${hint}">${fmtDate(iso)}</span>`;
}

function collectEvents() {
  const today = todayISO();
  const events = [];
  for (const p of DATA.procedures) {
    if (p.status !== 'active') continue;
    const nr = nextReportDate(p);
    if (nr) events.push({ date: nr, kind: 'Отчёт / собрание кредиторов', p, tab: 'reports' });
    if (p.dates.final_hearing && p.dates.final_hearing >= today) events.push({ date: p.dates.final_hearing, kind: 'СЗ по итогам процедуры', p, tab: 'main' });
    for (const h of p.hearings) if (h.date && h.date >= today) events.push({ date: h.date, kind: 'Судебное заседание', text: [h.time, h.subject].filter(Boolean).join(', '), p, tab: 'hearings' });
    for (const d of p.disputes) {
      if (d.hearing_date && d.hearing_date >= today) {
        events.push({ date: d.hearing_date, kind: 'Заседание по спору', text: [d.case_no, d.type, [d.plaintiff, d.defendant].filter(Boolean).join(' к ')].filter(Boolean).join(': '), p, tab: 'disputes' });
      }
    }
    for (const t of p.tasks) {
      if (t.done || !t.due) continue;
      events.push({ date: t.due, kind: t.dispute_id ? 'Задача по спору' : 'Задача', text: [disputeLabel(p, t.dispute_id), t.title].filter(Boolean).join(': '), p, tab: 'tasks' });
    }
    for (const m of p.meetings) {
      if (m.status === 'Запланировано' && m.date && m.date >= today) {
        events.push({ date: m.date, kind: m.kind === 'workers' ? 'Собрание работников' : 'Собрание кредиторов', text: m.time || '', p, tab: `meetings/${m.id}/params` });
      }
    }
    const close = rtkCloseDate(p);
    if (close && close >= today) events.push({ date: close, kind: 'Закрытие реестра требований', p, tab: 'rtk' });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function eventsList(events, empty = 'Ничего нет') {
  if (!events.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<ul class="events">${events.map(e => `
    <li>
      <div>${dueBadge(e.date)}</div>
      <div>
        <a href="#/p/${e.p.id}/${e.tab}">${esc(e.p.debtor.name || 'Без названия')}</a>
        <div class="what">${esc(e.kind)}${e.text ? ' · ' + esc(e.text) : ''} · ${esc(e.p.case_number || '')}</div>
      </div>
    </li>`).join('')}</ul>`;
}

function overdueReports() {
  const today = todayISO();
  return DATA.procedures.filter(p => p.status === 'active').map(p => ({ p, d: nextReportDate(p) })).filter(x => x.d && x.d < today);
}

// ---------- Каркас и маршрутизация ----------

function renderShell() {
  document.body.innerHTML = `
    <div class="layout">
      <aside class="side">
        <div class="brand">CRM АУ<span>${isOwner() ? 'учёт процедур банкротства' : 'кабинет помощника'}</span></div>
        <nav class="nav">
          <a href="#/" data-nav="home">Сводка</a>
          <a href="#/procedures" data-nav="procedures">Процедуры <span class="count" id="nav-overdue" hidden></span></a>
          <a href="#/deadlines" data-nav="deadlines">Сроки</a>
          ${isOwner() ? `
          <a href="#/users" data-nav="users">Помощники</a>
          <a href="#/audit" data-nav="audit">Журнал</a>
          <a href="#/settings" data-nav="settings">Настройки</a>` : ''}
        </nav>
        <div class="me">
          <a href="#/profile" data-nav="profile">${esc(ME.name)}</a>
          <span class="small muted">${isOwner() ? 'владелец' : 'помощник'}</span>
          <div class="actions small"><a href="/">На сайт</a><button class="linklike" id="logout">Выйти</button></div>
        </div>
        <div class="save-state" id="save-state">Данные загружены</div>
      </aside>
      <main id="main"></main>
    </div>`;
  $('#logout').onclick = async () => {
    if (dirty.size || settingsDirty) await saveNow();
    await api('logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    location.reload();
  };
}

function updateNav(section) {
  $$('.side a[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === section));
  const n = overdueReports().length;
  const badge = $('#nav-overdue');
  badge.hidden = !n;
  badge.textContent = n;
  badge.title = 'Просроченных отчётов';
}

function route() {
  const main = $('#main');
  if (!main || !DATA) return;
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  window.scrollTo(0, 0);
  const ownerOnly = ['users', 'audit', 'settings'];
  if (ownerOnly.includes(parts[0]) && !isOwner()) { location.hash = '#/'; return; }
  if (parts[0] === 'procedures') { updateNav('procedures'); renderList(main, params); }
  else if (parts[0] === 'p' && parts[1]) {
    updateNav('procedures');
    const p = DATA.procedures.find(x => x.id === parts[1]);
    if (!p) { main.innerHTML = '<div class="empty">Процедура не найдена или не назначена вам. <a href="#/procedures">К списку</a></div>'; return; }
    renderCard(main, p, parts[2] || 'main', parts[3], parts[4]);
  }
  else if (parts[0] === 'deadlines') { updateNav('deadlines'); renderDeadlines(main, params); }
  else if (parts[0] === 'settings') { updateNav('settings'); renderSettings(main); }
  else if (parts[0] === 'users') { updateNav('users'); renderUsers(main); }
  else if (parts[0] === 'audit') { updateNav('audit'); renderAudit(main, params); }
  else if (parts[0] === 'profile') { updateNav('profile'); renderProfile(main); }
  else { updateNav('home'); renderHome(main); }
}

// ---------- Сводка ----------

function renderHome(main) {
  const active = DATA.procedures.filter(p => p.status === 'active');
  const overdue = overdueReports();
  const events = collectEvents();
  const today = todayISO();
  const in30 = addMonths(today, 1);
  const soonReports = events.filter(e => e.tab === 'reports' && e.date >= today && e.date <= in30);
  const in14 = new Date(Date.parse(today) + 14 * 86400000).toISOString().slice(0, 10);
  const nearHearings = events.filter(e => (e.tab === 'hearings' || e.tab === 'disputes' || e.kind === 'СЗ по итогам процедуры') && e.date <= in14);
  const openTasks = DATA.procedures.reduce((n, p) => n + (p.status === 'active' ? p.tasks.filter(t => !t.done).length : 0), 0);
  const docs = DATA.settings.au_docs;
  const docsRisk = docs.filter(d => !d.until || daysUntil(d.until) <= 60).length;
  const overdueMonth = overdue.filter(x => daysUntil(x.d) < -30).length;
  const noDate = active.filter(p => !nextReportDate(p)).length;

  if (!isOwner() && !DATA.procedures.length) {
    main.innerHTML = `<div class="page-head"><div><h1>Здравствуйте, ${esc(ME.name)}</h1></div>
      <div class="actions"><button class="primary" id="new-proc">+ Новая процедура</button></div></div>
      <div class="panel empty">Вам пока не назначены процедуры. Когда Илья Михайлович закрепит их за вами, они появятся здесь. Новую процедуру можно создать самому.</div>`;
    $('#new-proc').onclick = createProcedure;
    return;
  }
  main.innerHTML = `
    <div class="page-head"><div><h1>Сводка</h1><div class="muted">${fmtDate(today)} · ${isOwner() ? 'процедур в базе' : 'назначено вам процедур'}: ${DATA.procedures.length}</div></div>
      <div class="actions"><button class="primary" id="new-proc">+ Новая процедура</button></div></div>
    <div class="grid kpis">
      <a class="panel kpi" href="#/procedures?status=active"><div class="num">${active.length}</div><div class="lbl">активных процедур</div></a>
      <a class="panel kpi ${overdue.length ? 'bad' : ''}" href="#/procedures?status=active&due=overdue"><div class="num">${overdue.length}</div><div class="lbl">срок отчёта прошёл, из них больше месяца назад — ${overdueMonth}</div></a>
      <a class="panel kpi ${soonReports.length ? 'warn' : ''}" href="#/deadlines?range=30"><div class="num">${soonReports.length}</div><div class="lbl">отчётов в ближайшие 30 дней</div></a>
      <a class="panel kpi" href="#/deadlines?range=14"><div class="num">${nearHearings.length}</div><div class="lbl">заседаний за 2 недели</div></a>
      <a class="panel kpi" href="#/deadlines?range=all"><div class="num">${openTasks}</div><div class="lbl">открытых задач</div></a>
      ${isOwner() ? `<a class="panel kpi ${docsRisk ? 'warn' : ''}" href="#/settings"><div class="num">${docsRisk}</div><div class="lbl">моих документов истекает или без даты</div></a>` : ''}
    </div>
    ${noDate ? `<div class="panel" style="margin-bottom:14px">У ${noDate} активных процедур не заполнены даты введения или назначения, поэтому срок отчёта по ним не считается.
      <a href="#/procedures?status=active&due=nodate">Показать и заполнить</a></div>` : ''}
    <div class="grid two">
      <section class="panel"><h2>Просроченные отчёты</h2>
        ${eventsList(overdue.sort((a, b) => a.d.localeCompare(b.d)).map(x => ({ date: x.d, kind: 'Отчёт / собрание кредиторов', p: x.p, tab: 'reports' })), 'Просроченных отчётов нет')}
      </section>
      <section class="panel"><h2>Ближайшие 14 дней</h2>
        ${eventsList(events.filter(e => e.date >= today && e.date <= in14), 'На ближайшие две недели ничего не запланировано')}
      </section>
      ${isOwner() ? `<section class="panel"><h2>Мои документы</h2>
        <ul class="events">${docs.map(d => `
          <li><div>${d.until ? dueBadge(d.until) : '<span class="badge warn">нет даты</span>'}</div><div>${esc(d.title)}<div class="what">действует до</div></div></li>`).join('')}
        </ul>
        <div class="small muted" style="margin-top:8px">Даты меняются в <a href="#/settings">настройках</a>.</div>
      </section>` : ''}
    </div>`;
  $('#new-proc').onclick = createProcedure;
}

// ---------- Список процедур ----------

const LIST = { q: '', status: 'active', dtype: '', ptype: '', due: '', who: '', sort: 'next', dir: 1 };

function listRows() {
  const q = LIST.q.trim().toLowerCase();
  const today = todayISO();
  const rows = DATA.procedures.map(p => ({ p, next: nextReportDate(p), last: lastReportDate(p) })).filter(({ p, next }) => {
    if (LIST.status && p.status !== LIST.status) return false;
    if (LIST.dtype && p.debtor_type !== LIST.dtype) return false;
    if (LIST.ptype && p.procedure_type !== LIST.ptype) return false;
    if (LIST.due === 'overdue' && !(next && next < today)) return false;
    if (LIST.due === '30' && !(next && next >= today && daysUntil(next) <= 30)) return false;
    if (LIST.due === 'nodate' && next) return false;
    if (LIST.who === 'none' && p.assignees.length) return false;
    if (LIST.who && LIST.who !== 'none' && !p.assignees.includes(LIST.who)) return false;
    if (q) {
      const hay = [p.debtor.name, p.debtor.full_name, p.debtor.inn, p.case_number, p.court.name, p.judge, p.debtor2?.name].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const key = {
    debtor: r => (r.p.debtor.name || '').toLowerCase(),
    case: r => r.p.case_number || '',
    type: r => r.p.procedure_type || '',
    status: r => r.p.status,
    next: r => r.next || '9999',
    last: r => r.last || '',
    appointment: r => r.p.dates.appointment || '',
  }[LIST.sort];
  rows.sort((a, b) => key(a).localeCompare(key(b), 'ru') * LIST.dir);
  return rows;
}

function renderList(main, params) {
  for (const k of ['status', 'dtype', 'ptype', 'due', 'who']) if (params.has(k)) LIST[k] = params.get(k);
  if (!isOwner()) LIST.who = '';
  const imported = params.get('imported');
  main.innerHTML = `
    <div class="page-head"><div><h1>${isOwner() ? 'Процедуры' : 'Мои процедуры'}</h1><div class="muted" id="list-count"></div></div>
      <div class="actions">${isOwner() ? '<button id="csv">Выгрузить в Excel (CSV)</button>' : ''}<button class="primary" id="new-proc">+ Новая процедура</button></div></div>
    <div class="filters ${isOwner() ? 'owner' : ''}">
      ${isOwner() ? `<select id="f-who"><option value="">Любой помощник</option><option value="none" ${LIST.who === 'none' ? 'selected' : ''}>Без помощника</option>${assistants().map(u => `<option value="${u.id}" ${LIST.who === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
      <input type="search" id="f-q" placeholder="Поиск: должник, ИНН, номер дела, суд, судья" value="${esc(LIST.q)}">
      <select id="f-status"><option value="">Все статусы</option>${Object.entries(STATUS).map(([v, t]) => `<option value="${v}" ${LIST.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="f-dtype"><option value="">Любой должник</option><option value="ind" ${LIST.dtype === 'ind' ? 'selected' : ''}>Физлица и ИП</option><option value="ent" ${LIST.dtype === 'ent' ? 'selected' : ''}>Юрлица</option></select>
      <select id="f-ptype"><option value="">Любая процедура</option>${PROC_TYPES.map(t => `<option ${LIST.ptype === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="f-due"><option value="">Любой срок отчёта</option><option value="overdue" ${LIST.due === 'overdue' ? 'selected' : ''}>Отчёт просрочен</option><option value="30" ${LIST.due === '30' ? 'selected' : ''}>Отчёт в ближайшие 30 дней</option><option value="nodate" ${LIST.due === 'nodate' ? 'selected' : ''}>Срок не рассчитан (нет дат)</option></select>
    </div>
    <div class="panel table-wrap" style="padding:0"><table>
      <thead><tr>
        ${[['debtor', 'Должник'], ['case', 'Дело / суд'], ['type', 'Процедура'], ['status', 'Статус'], ['appointment', 'Назначение'], ['last', 'Посл. отчёт'], ['next', 'След. отчёт']]
          .map(([k, t]) => `<th class="sortable" data-sort="${k}">${t}${LIST.sort === k ? (LIST.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const draw = () => {
    const rows = listRows();
    $('#list-count').textContent = `Показано ${rows.length} из ${DATA.procedures.length}`;
    $('#rows').innerHTML = rows.length ? rows.map(({ p, next, last }) => `
      <tr class="click" data-id="${p.id}">
        <td><div>${esc(p.debtor.name || 'Без названия')}</div><div class="small muted">${p.debtor.inn ? 'ИНН ' + esc(p.debtor.inn) : ''}${p.debtor2?.name ? ' · + ' + esc(p.debtor2.name) : ''}</div></td>
        <td class="nowrap"><div>${esc(p.case_number)}</div><div class="small muted">${esc(shortCourt(p.court.name))}${p.judge ? ' · ' + esc(p.judge) : ''}</div></td>
        <td>${esc(p.procedure_type) || '<span class="muted">не указана</span>'}${p.is_io ? ' <span class="badge gray">и. о.</span>' : ''}</td>
        <td>${statusBadge(p)}${isOwner() && p.assignees.length ? `<div class="small muted">${p.assignees.map(id => esc(userName(id))).join(', ')}</div>` : ''}</td>
        <td class="nowrap">${fmtDate(p.dates.appointment)}</td>
        <td class="nowrap">${fmtDate(last)}</td>
        <td>${p.status === 'active' ? dueBadge(next) : ''}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty">Ничего не найдено</td></tr>';
  };
  draw();
  if (imported) toast(`Загружено из кабинета Сириуса: ${imported} процедур`);

  $('#f-q').addEventListener('input', e => { LIST.q = e.target.value; draw(); });
  for (const [id, k] of [['f-status', 'status'], ['f-dtype', 'dtype'], ['f-ptype', 'ptype'], ['f-due', 'due'], ['f-who', 'who']]) {
    $('#' + id)?.addEventListener('change', e => { LIST[k] = e.target.value; draw(); });
  }
  $$('th[data-sort]', main).forEach(th => th.addEventListener('click', () => {
    LIST.dir = LIST.sort === th.dataset.sort ? -LIST.dir : 1;
    LIST.sort = th.dataset.sort;
    renderList(main, new URLSearchParams());
  }));
  $('#rows').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/p/${tr.dataset.id}`;
  });
  $('#new-proc').onclick = createProcedure;
  if (isOwner()) $('#csv').onclick = () => exportCsv(listRows());
}

function statusBadge(p) {
  const cls = { active: 'ok', completed: 'gray', terminated: 'gray', released: 'warn', removed: 'bad' }[p.status] || 'gray';
  return `<span class="badge ${cls}" title="${esc(p.status_note || '')}">${STATUS[p.status] || p.status}</span>`;
}

function exportCsv(rows) {
  const head = ['Должник', 'ИНН', 'Тип должника', 'Суд', 'Номер дела', 'Судья', 'Процедура', 'Статус', 'Дата введения', 'Дата назначения АУ', 'Последний отчёт', 'Следующий отчёт', 'СЗ по итогам'];
  const lines = rows.map(({ p, next, last }) => [
    p.debtor.name, p.debtor.inn, p.debtor_type === 'ent' ? 'юрлицо' : 'физлицо', p.court.name, p.case_number, p.judge,
    p.procedure_type, STATUS[p.status], fmtDate(p.dates.introduction), fmtDate(p.dates.appointment), fmtDate(last), fmtDate(next), fmtDate(p.dates.final_hearing),
  ]);
  const csv = [head, ...lines].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`процедуры-${todayISO()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function createProcedure() {
  const draft = {
    debtor_type: 'ind', debtor: { name: '' }, debtor2: null, court: { name: '' }, case_number: '', judge: '', case_url: '',
    procedure_type: '', debtor_category: '', status: 'active', status_note: '', is_io: false, dates: {}, applicant: {},
    report_period_months: Number(DATA.settings.report_period_default) || 3, next_report_date: '', comment: '', notes: '', assignees: [],
  };
  try {
    const { procedure } = await api('procedures', { method: 'POST', body: { procedure: draft } });
    DATA.procedures.push(normalizeProcedure(procedure));
    location.hash = `#/p/${procedure.id}/main`;
  } catch (err) {
    toast('Не удалось создать процедуру: ' + err.message);
  }
}

// ---------- Карточка процедуры ----------

// Названия списков для журнала действий. Вкладки карточки — CARD_TABS в modules.js.
const LIST_LABELS = {
  reports: 'Отчёты в СРО', claims: 'РТК', involved: 'Привлечённые лица', hearings: 'Заседания', disputes: 'Судебные споры',
  publications: 'Публикации', accounts: 'Счета', tasks: 'Задачи', spouses: 'Супруги', children: 'Дети', incomes: 'Доходы',
  counterparties: 'Контрагенты', costs: 'Текущие расходы', payments: 'Поступления и платежи', assets: 'Имущество',
  receivables: 'Дебиторка', measures: 'Меры по сохранности', workers: 'Работники', complaints: 'Жалобы',
  documents: 'Документы', meetings: 'Собрания', claim_changes: 'Изменения требований', rtk: 'Даты РТК',
  analysis: 'Финанализ', report_cfg: 'Отчёт АУ', subsistence: 'Прожиточный минимум', expenses: 'Расходы должника',
};

const MAIN_GROUPS = [
  { title: 'Должник', fields: [
    { path: 'debtor_type', label: 'Тип должника', type: 'select', options: [['ind', 'Физлицо / ИП'], ['ent', 'Юрлицо']] },
    { path: 'debtor.name', label: 'ФИО / краткое наименование', wide: true },
    { path: 'debtor.full_name', label: 'Полное наименование', wide: true, show: p => p.debtor_type === 'ent' },
    { path: 'debtor.inn', label: 'ИНН' },
    { path: 'debtor.ogrn', label: 'ОГРН / ОГРНИП' },
    { path: 'debtor.snils', label: 'СНИЛС', show: p => p.debtor_type !== 'ent' },
    { path: 'debtor.birth_date', label: 'Дата рождения', type: 'date', show: p => p.debtor_type !== 'ent' },
    { path: 'debtor.birth_place', label: 'Место рождения', wide: true, show: p => p.debtor_type !== 'ent' },
    { path: 'debtor.address', label: 'Адрес', wide: true },
    { path: 'debtor2.name', label: 'Второй должник (супруг)', show: p => p.debtor_type !== 'ent' },
    { path: 'debtor2.inn', label: 'ИНН второго должника', show: p => p.debtor_type !== 'ent' },
  ] },
  { title: 'Дело', fields: [
    { path: 'court.name', label: 'Арбитражный суд', wide: true, list: 'courts' },
    { path: 'court.address', label: 'Адрес суда (для ходатайств)', wide: true },
    { path: 'case_number', label: 'Номер дела' },
    { path: 'judge', label: 'Судья' },
    { path: 'case_url', label: 'Ссылка на дело (kad.arbitr.ru)', wide: true },
    { path: 'doc_place', label: 'Место составления документов' },
    { path: 'doc_prefix', label: 'Префикс исходящих номеров (например, К-)' },
  ] },
  { title: 'Процедура', fields: [
    { path: 'procedure_type', label: 'Процедура', type: 'select', options: PROC_TYPES },
    { path: 'debtor_category', label: 'Категория должника', type: 'select', options: DEBTOR_CATEGORIES, show: p => p.debtor_type === 'ent' },
    { path: 'status', label: 'Статус', type: 'select', options: Object.entries(STATUS) },
    { path: 'status_note', label: 'Примечание к статусу' },
    { path: 'is_io', label: 'Исполняющий обязанности', type: 'bool' },
  ] },
  { title: 'Даты', fields: [
    { path: 'dates.application_accept', label: 'Принятие заявления судом', type: 'date' },
    { path: 'dates.introduction', label: 'Введение процедуры (рез. часть)', type: 'date' },
    { path: 'dates.introduction_motivated', label: 'Введение процедуры (мотив. часть)', type: 'date' },
    { path: 'dates.appointment', label: 'Назначение АУ (рез. часть)', type: 'date' },
    { path: 'dates.appointment_motivated', label: 'Назначение АУ (мотив. часть)', type: 'date' },
    { path: 'dates.final_hearing', label: 'СЗ по итогам процедуры', type: 'date' },
    { path: 'dates.completion', label: 'Завершение / прекращение', type: 'date' },
    { path: 'dates.ruling', label: 'Дата определения', type: 'date' },
    { path: 'dates.docs_sending', label: 'Отправка документов', type: 'date' },
    { path: 'docs_sending_type', label: 'Способ отправки', type: 'select', options: SENDING },
  ] },
  { title: 'Заявитель по делу', fields: [
    { path: 'applicant.type', label: 'Тип заявителя', type: 'select', options: APPLICANT_TYPES },
    { path: 'applicant.name', label: 'ФИО / наименование заявителя', wide: true },
    { path: 'applicant.inn', label: 'ИНН заявителя' },
    { path: 'debtor_is_applicant', label: 'Заявитель — сам должник', type: 'bool' },
  ] },
  { title: 'Отчётность', fields: [
    { path: 'report_period_months', label: 'Периодичность отчёта, мес.', type: 'number' },
    { path: 'next_report_date', label: 'Следующий отчёт (вручную / из Сириуса)', type: 'date' },
    { computed: p => dueBadge(nextReportDate(p)), label: 'Расчётная дата следующего отчёта' },
  ] },
  { title: 'Прочее', fields: [
    { path: 'book_value', label: 'Балансовая стоимость активов, ₽', type: 'money' },
    { path: 'book_value_date', label: 'На дату', type: 'date' },
    { path: 'comment', label: 'Комментарий', type: 'textarea', wide: true },
  ] },
];

const SUBTABLES = {
  reports: {
    add: 'Добавить запись об отчёте или собрании для СРО',
    sort: (a, b) => (b.meeting_date || b.report_date || '').localeCompare(a.meeting_date || a.report_date || ''),
    cols: [
      { f: 'meeting_date', label: 'Дата собрания (комитета)', type: 'date' },
      { f: 'report_date', label: 'Дата отчёта', type: 'date' },
      { f: 'agenda', label: 'Повестка', type: 'textarea', wide: true },
      { f: 'is_report', label: 'Отчёт', type: 'bool' },
      { f: 'is_meeting', label: 'Собрание', type: 'bool' },
      { f: 'is_final', label: 'Итоговый', type: 'bool' },
      { f: 'out_of_time', label: 'С нарушением срока', type: 'bool' },
      { f: 'sro_status', label: 'Статус в СРО', type: 'select', options: SRO_STATUSES },
      { f: 'files', label: 'Файлы / где лежат', wide: true, hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
  claims: {
    add: 'Добавить требование',
    sort: (a, b) => (a.queue || '').localeCompare(b.queue || '') || (a.creditor || '').localeCompare(b.creditor || '', 'ru'),
    defaults: p => ({ queue: '3 очередь', obligation: 'Основной долг', included_date: todayISO(), number: String(p.claims.filter(c => !c.moratorium).length + 1) }),
    cols: [
      { f: 'number', label: '№ требования' },
      { f: 'creditor', label: 'Кредитор', wide: true, list: 'cp-names' },
      { f: 'creditor_no', label: '№ кредитора' },
      { f: 'queue', label: 'Очередь', type: 'select', options: CLAIM_QUEUES, rerender: true },
      { f: 'obligation', label: 'Вид обязательства', type: 'select', options: () => OBLIGATIONS, show: d => d.queue === '3 очередь' || d.queue === 'За реестром' },
      { f: 'secured', label: 'Обеспечено залогом', type: 'bool', rerender: true, show: d => d.queue === '3 очередь' },
      { f: 'pledge', label: 'Предмет залога', wide: true, hidden: true, show: d => d.secured && d.queue === '3 очередь' },
      { f: 'amount', label: 'Сумма требования, ₽', type: 'money' },
      { f: 'included_date', label: 'Дата записи в реестр', type: 'date' },
      { f: 'court_act', label: 'Документ о включении (определение суда от …)', wide: true, hidden: true },
      { f: 'basis', label: 'Основание возникновения (договор, решение суда)', wide: true, hidden: true },
      { f: 'no_vote', label: 'Не учитывать при голосовании', type: 'bool', hidden: true },
      { f: 'paid', label: 'Погашено до ведения в CRM, ₽', type: 'money', hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    info: (d, p) => (d.id && p.claims.some(c => c.id === d.id) ? `Погашено платежами из раздела «Деньги»: ${fmtMoney(allocated(p, 'claim', d.id))} ₽` : ''),
    onDelete: (row, p) => { for (const pay of p.payments) pay.allocations = (pay.allocations || []).filter(a => !(a.type === 'claim' && a.id === row.id)); },
    footer: rows => {
      const sum = f => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
      const byQ = CLAIM_QUEUES.map(q => {
        const rs = rows.filter(r => r.queue === q);
        return rs.length ? `${q}: ${fmtMoney(rs.reduce((s, r) => s + (Number(r.amount) || 0), 0))}` : '';
      }).filter(Boolean).join(' · ');
      const total = sum('amount');
      const paid = sum('paid');
      return `Всего требований: ${fmtMoney(total)} ₽, погашено ${fmtMoney(paid)} ₽${total ? ` (${(paid / total * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %)` : ''}${byQ ? `<div class="small muted">${byQ}</div>` : ''}`;
    },
  },
  involved: {
    add: 'Добавить привлечённое лицо',
    sort: (a, b) => (a.contract_date || '').localeCompare(b.contract_date || ''),
    cols: [
      { f: 'type', label: 'Вид услуг', type: 'select', options: INVOLVE_TYPES },
      { f: 'name', label: 'ФИО / наименование', wide: true },
      { f: 'contract', label: '№ договора' },
      { f: 'contract_date', label: 'Дата договора', type: 'date' },
      { f: 'amount', label: 'Сумма, ₽', type: 'money' },
      { f: 'payment_source', label: 'Источник оплаты', type: 'select', options: PAYMENT_SOURCES },
      { f: 'accredited', label: 'Аккредитован при СРО', type: 'bool' },
      { f: 'court_ruling_date', label: 'Дата определения суда о привлечении', type: 'date', hidden: true },
      { f: 'periodicity', label: 'Периодичность оплаты', type: 'select', options: ['Разово', 'Ежемесячно', 'По актам'], hidden: true },
      { f: 'accrual_from', label: 'Начисления с', type: 'date', hidden: true },
      { f: 'accrual_to', label: 'Начисления по', type: 'date', hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    footer: rows => `Итого по договорам: ${fmtMoney(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))} ₽`,
  },
  hearings: {
    add: 'Добавить заседание',
    sort: (a, b) => (b.date || '').localeCompare(a.date || ''),
    cols: [
      { f: 'date', label: 'Дата', type: 'date' },
      { f: 'time', label: 'Время' },
      { f: 'subject', label: 'Что рассматривается', wide: true },
      { f: 'result', label: 'Результат', wide: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
  disputes: {
    add: 'Добавить спор',
    sort: (a, b) => (b.hearing_date || '').localeCompare(a.hearing_date || ''),
    // Номер дела: банкротное дело этой процедуры по умолчанию, можно выбрать другой номер из ранее введённых или ввести свой.
    defaults: p => ({ case_no: p.case_number || '' }),
    prepare: (d, p) => disputePrepare(d, p),
    beforeSave: (d, p) => disputeBeforeSave(d, p),
    onDelete: (row, p) => disputeOnDelete(row, p),
    drawExtra: (box, d, p) => disputeDrawExtra(box, d, p),
    cols: [
      { f: 'plaintiff', label: 'Истец', wide: true },
      { f: 'defendant', label: 'Ответчик', wide: true },
      { f: 'case_no', label: '№ дела', type: 'select', options: p => disputeCaseOptions(p), rerender: true, cell: (r, p) => esc(r.case_no || p.case_number || '') },
      { f: 'case_no_other', label: 'Номер другого дела (например, А19-12345/2026)', hidden: true, show: d => d.case_no === '__other' },
      { f: 'type', label: 'Вид спора', type: 'select', options: DISPUTE_TYPES },
      { f: 'amount', label: 'Сумма, ₽', type: 'money' },
      { f: 'court', label: 'Суд', list: 'courts' },
      { f: 'judge', label: 'Судья' },
      { f: 'hearing_date', label: 'Дата заседания', type: 'date' },
      { label: 'Задачи', tableOnly: true, cell: (r, p) => disputeTasksCell(p, r) },
      { f: 'note', label: 'Комментарий', type: 'textarea', wide: true, cell: r => commentCell(r.note) },
    ],
    footer: rows => {
      const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const byType = DISPUTE_TYPES.map(t => [t, rows.filter(r => r.type === t).length]).filter(([, n]) => n).map(([t, n]) => `${t}: ${n}`).join(' · ');
      return `Споров: ${rows.length}, на сумму ${fmtMoney(total)} ₽${byType ? `<div class="small muted">${byType}</div>` : ''}`;
    },
  },
  publications: {
    add: 'Добавить публикацию',
    sort: (a, b) => (b.date || '').localeCompare(a.date || ''),
    cols: [
      { f: 'kind', label: 'Где', type: 'select', options: PUB_KINDS },
      { f: 'type', label: 'Тип сообщения', list: 'pub-types', wide: true },
      { f: 'date', label: 'Дата публикации', type: 'date' },
      { f: 'number', label: 'Номер сообщения' },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
  accounts: {
    add: 'Добавить счёт',
    sort: (a, b) => (a.opened || '').localeCompare(b.opened || ''),
    cols: [
      { f: 'kind', label: 'Вид счёта', type: 'select', options: ACCOUNT_KINDS, wide: true },
      { f: 'bank', label: 'Банк, брокер, биржа', list: 'cp-names' },
      { f: 'number', label: 'Номер счёта' },
      { f: 'bik', label: 'БИК', hidden: true },
      { f: 'corr', label: 'Корреспондентский счёт', hidden: true },
      { f: 'currency', label: 'Валюта', hidden: true },
      { f: 'opened', label: 'Открыт', type: 'date' },
      { f: 'closed', label: 'Закрыт', type: 'date' },
      { f: 'balance_start', label: 'Остаток на дату введения процедуры, ₽', type: 'money', hidden: true },
      { label: 'Текущий остаток, ₽', tableOnly: true, num: true, cell: (r, p) => fmtMoney(accountBalance(p, r)) },
      { f: 'is_main', label: 'Основной счёт должника (реквизиты идут в письма)', type: 'bool', hidden: true },
      { f: 'close_notice', label: 'Направлено требование о закрытии', type: 'bool', hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    footer: (rows, p) => `Остаток на всех счетах: ${fmtMoney(rows.reduce((s, r) => s + accountBalance(p, r), 0))} ₽`,
  },
  tasks: {
    add: 'Добавить задачу',
    sort: (a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999'),
    cols: [
      { f: 'title', label: 'Задача', wide: true },
      { label: 'Относится к спору', tableOnly: true, cell: (r, p) => esc(disputeLabel(p, r.dispute_id)) },
      { f: 'dispute_id', label: 'Относится к спору (необязательно)', type: 'select', hidden: true, wide: true, options: p => p.disputes.map(d => [d.id, disputeLabel(p, d.id)]) },
      { f: 'due', label: 'Срок', type: 'date', due: true },
      { f: 'done', label: 'Выполнено', type: 'bool' },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
};
Object.assign(SUBTABLES, EXTRA_SUBTABLES);

function renderCard(main, p, rawTab, rawSub, rest) {
  const [tab, sub] = resolveTab(rawTab, rawSub);
  const tabs = [...CARD_TABS, ...(isOwner() ? [['history', 'История']] : [])].map(([k, t]) => {
    const n = k === 'history' ? 0 : tabCount(p, k);
    return `<a href="#/p/${p.id}/${k}" class="${k === tab ? 'active' : ''}">${t}${n ? `<span class="n">${n}</span>` : ''}</a>`;
  }).join('');
  const names = [...new Set([...p.counterparties.map(c => c.name), ...p.claims.map(c => c.creditor)].filter(Boolean))].sort();
  main.innerHTML = `
    <div class="page-head card-head" id="card-head"></div>
    <nav class="tabs">${tabs}</nav>
    <div id="tab-body"></div>
    <datalist id="courts">${[...new Set(DATA.procedures.map(x => x.court.name).filter(Boolean))].sort().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="pub-types">${PUB_TYPES.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <datalist id="cp-names">${names.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
  drawCardHead(p);
  const body = $('#tab-body');
  if (tab === 'main') renderMainForm(body, p);
  else if (tab === 'notes') renderNotes(body, p);
  else if (tab === 'history' && isOwner()) renderHistory(body, p);
  else if (tab === 'reports') renderSubtable(body, p, 'reports');
  else if (!renderModuleTab(body, p, tab, sub, rest) && SUBTABLES[tab]) renderSubtable(body, p, tab);
}

async function renderHistory(body, p) {
  body.innerHTML = '<div class="panel empty">Загружаю историю…</div>';
  try {
    const { entries } = await api('audit?procedure=' + encodeURIComponent(p.id));
    body.innerHTML = `<div class="panel">${auditTable(entries, false)}</div>`;
  } catch (err) {
    body.innerHTML = `<div class="banner">Не удалось загрузить историю: ${esc(err.message)}</div>`;
  }
}

function drawCardHead(p) {
  const next = nextReportDate(p);
  $('#card-head').innerHTML = `
    <div>
      <div class="small"><a href="#/procedures">← Все процедуры</a></div>
      <h1>${esc(p.debtor.name || 'Новая процедура')}</h1>
      <div class="meta">
        ${statusBadge(p)}
        ${p.procedure_type ? `<span>${esc(p.procedure_type)}</span>` : ''}
        ${p.case_number ? `<span>${p.case_url ? `<a href="${esc(p.case_url)}" target="_blank" rel="noopener">${esc(p.case_number)}</a>` : esc(p.case_number)}</span>` : ''}
        ${p.court.name ? `<span>${esc(shortCourt(p.court.name))}${p.judge ? ', судья ' + esc(p.judge) : ''}</span>` : ''}
        ${p.status === 'active' ? `<span>След. отчёт: ${dueBadge(next)}</span>` : ''}
        ${p.source === 'sirius' ? '<span class="badge gray" title="Загружено из ЛК ААУ «СИРИУС»">из Сириуса</span>' : ''}
      </div>
      ${p.updated_by ? `<div class="small muted" style="margin-top:4px">Изменено ${new Date(p.updated_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}, ${esc(p.updated_by)}</div>` : ''}
    </div>
    <div class="actions"><button class="danger" id="del-proc">Удалить процедуру</button></div>`;
  $('#del-proc').onclick = () => confirmModal(
    `Удалить процедуру «${p.debtor.name || 'без названия'}» со всеми отчётами, требованиями и задачами? ${isOwner() ? 'Восстановить можно только из архивной копии в папке «crm/данные/архив».' : 'Восстановить её сможет только владелец из архивной копии.'}`,
    'Удалить',
    async () => {
      try {
        await api('procedures/' + p.id, { method: 'DELETE' });
        DATA.procedures = DATA.procedures.filter(x => x !== p);
        dirty.delete(p.id);
        location.hash = '#/procedures';
      } catch (err) {
        toast('Не удалось удалить: ' + err.message);
      }
    },
  );
}

function fieldHtml(def, value, attr) {
  const id = 'f-' + Math.random().toString(36).slice(2);
  const wide = def.wide ? ' wide' : '';
  if (def.type === 'bool') {
    return `<label class="field check${wide}"><input type="checkbox" ${attr} ${value ? 'checked' : ''}> ${esc(def.label)}</label>`;
  }
  let input;
  if (def.type === 'select') {
    const opts = def.options.map(o => (Array.isArray(o) ? o : [o, o]));
    const known = opts.some(([v]) => v === value);
    input = `<select id="${id}" ${attr}><option value=""></option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`).join('')}${value && !known ? `<option selected value="${esc(value)}">${esc(value)}</option>` : ''}</select>`;
  } else if (def.type === 'textarea') {
    input = `<textarea id="${id}" ${attr}>${esc(value)}</textarea>`;
  } else if (def.type === 'date') {
    input = `<input type="date" id="${id}" ${attr} value="${esc(value)}">`;
  } else if (def.type === 'number') {
    input = `<input type="number" min="1" max="12" id="${id}" ${attr} value="${esc(value)}">`;
  } else if (def.type === 'money') {
    input = `<input inputmode="decimal" id="${id}" ${attr} value="${esc(value === '' || value == null ? '' : fmtMoney(value))}">`;
  } else if (def.type === 'decimal') {
    input = `<input inputmode="decimal" id="${id}" ${attr} value="${esc(String(value ?? '').replace('.', ','))}">`;
  } else {
    input = `<input id="${id}" ${def.list ? `list="${def.list}"` : ''} ${attr} value="${esc(value)}">`;
  }
  return `<label class="field${wide}" for="${id}">${esc(def.label)}${input}</label>`;
}

function readInput(el, type) {
  if (type === 'bool') return el.checked;
  if (type === 'money' || type === 'decimal') return parseMoney(el.value);
  if (type === 'number') return el.value === '' ? '' : Number(el.value);
  return el.value.trim();
}

function renderMainForm(body, p) {
  const flat = [];
  body.innerHTML = `<div class="panel">${MAIN_GROUPS.map(g => `
    <div class="form-group"><h3>${esc(g.title)}</h3><div class="form-grid">
      ${g.fields.filter(f => !f.show || f.show(p)).map(f => {
        if (f.computed) return `<div class="field small muted">${esc(f.label)}<div class="computed" data-computed="${flat.push(f) - 1}">${f.computed(p)}</div></div>`;
        flat.push(f);
        return fieldHtml(f, getPath(p, f.path) ?? '', `data-i="${flat.length - 1}"`);
      }).join('')}
    </div></div>`).join('')}
    <div class="form-group"><h3>Помощники по процедуре</h3>
      ${assistants().length ? `<div class="checks">${assistants().map(u => {
        const me = !isOwner() && u.id === ME.id;
        return `<label class="field check"><input type="checkbox" data-assignee="${u.id}" ${p.assignees.includes(u.id) || me ? 'checked' : ''} ${me ? 'disabled' : ''}> ${esc(u.name)}${me ? ' (вы)' : ''}</label>`;
      }).join('')}</div>${isOwner() ? '' : '<p class="small muted">Вы можете подключить к процедуре других помощников или снять их. Себя снять нельзя: это сделает владелец.</p>'}`
        : `<p class="small muted">Помощников пока нет.${isOwner() ? ' Их можно добавить в разделе <a href="#/users">«Помощники»</a>.' : ''}</p>`}
    </div></div>`;

  body.addEventListener('change', e => {
    if (e.target.dataset.assignee) {
      const id = e.target.dataset.assignee;
      p.assignees = e.target.checked ? [...new Set([...p.assignees, id])] : p.assignees.filter(x => x !== id);
      touch(p);
      return;
    }
    const el = e.target.closest('[data-i]');
    if (!el) return;
    const def = flat[Number(el.dataset.i)];
    const value = readInput(el, def.type);
    if (def.path.startsWith('debtor2.') && !p.debtor2) p.debtor2 = {};
    setPath(p, def.path, value);
    if (p.debtor2 && !p.debtor2.name && !p.debtor2.inn) p.debtor2 = null;
    if (def.type === 'money') el.value = value === '' ? '' : fmtMoney(value);
    if (def.path === 'case_number' && value && !p.case_url) {
      p.case_url = `https://kad.arbitr.ru/Card?number=${encodeURIComponent(value)}`;
      const urlInput = $$('[data-i]', body).find(x => flat[Number(x.dataset.i)].path === 'case_url');
      if (urlInput) urlInput.value = p.case_url;
    }
    $$('[data-computed]', body).forEach(c => { c.innerHTML = flat[Number(c.dataset.computed)].computed(p); });
    touch(p);
    drawCardHead(p);
    updateNav('procedures');
    if (def.path === 'debtor_type') renderCard($('#main'), p, 'main');
  });
}

function renderNotes(body, p) {
  body.innerHTML = `<div class="panel"><label class="field">Заметки по процедуре (сохраняются автоматически)
    <textarea id="notes" style="min-height:360px">${esc(p.notes || '')}</textarea></label></div>`;
  let t;
  $('#notes').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => { p.notes = e.target.value; touch(p); }, 400);
  });
}

function cellHtml(col, row, p) {
  if (col.cell) return col.cell(row, p);
  const v = row[col.f];
  if (col.type === 'date') return col.due && !row.done ? dueBadge(v) : fmtDate(v);
  if (col.type === 'money') return fmtMoney(v);
  if (col.type === 'bool') return v ? '✓' : '';
  if (col.type === 'select' && Array.isArray(col.options)) {
    const o = col.options.find(x => Array.isArray(x) && x[0] === v);
    if (o) return esc(o[1]);
  }
  return esc(v);
}

// Таблица списка процедуры. append — добавить ниже уже нарисованного (несколько таблиц на одной вкладке).
function renderSubtable(body, p, key, { append = false, title = '', extraActions = '' } = {}) {
  const cfg = SUBTABLES[key];
  const visible = cfg.cols.filter(c => !c.hidden);
  const rows = cfg.sort ? [...p[key]].sort(cfg.sort) : [...p[key]];
  const numCls = c => (c.type === 'money' || c.num ? 'num' : '');
  const sec = document.createElement('section');
  sec.className = 'list-section';
  sec.innerHTML = `${title ? `<h2>${esc(title)}</h2>` : ''}
    <div class="actions" style="margin-bottom:12px"><button class="primary" data-add>+ ${esc(cfg.add)}</button>${extraActions}</div>
    <div class="panel table-wrap" style="padding:0"><table>
      <thead><tr>${visible.map(c => `<th class="${numCls(c)}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr class="click" data-row="${r.id}">${visible.map(c => `<td class="${numCls(c)}">${cellHtml(c, r, p)}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${visible.length}" class="empty">Записей пока нет</td></tr>`}</tbody>
      ${cfg.footer && rows.length ? `<tfoot><tr><td colspan="${visible.length}">${cfg.footer(rows, p)}</td></tr></tfoot>` : ''}
    </table></div>`;
  if (!append) body.innerHTML = '';
  body.appendChild(sec);
  $('[data-add]', sec).onclick = () => editRow(p, key, null);
  $('tbody', sec).addEventListener('click', e => {
    const tr = e.target.closest('tr[data-row]');
    if (tr) editRow(p, key, p[key].find(r => r.id === tr.dataset.row));
  });
  return sec;
}

// Окно записи списка. Поля с show(draft, p) появляются по условию, с rerender — перестраивают форму при изменении.
function editRow(p, key, row, { cfg = SUBTABLES[key] } = {}) {
  const isNew = !row;
  const draft = row ? structuredClone(row) : { id: uid(), ...(cfg.defaults ? cfg.defaults(p) : {}) };
  if (cfg.prepare) cfg.prepare(draft, p);
  const formCols = cfg.cols.map((c, i) => [c, i]).filter(([c]) => !c.tableOnly);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${isNew ? esc(cfg.add) : 'Изменить запись'}</h2>
      <div class="form-grid" id="row-form"></div>
      <div id="row-extra"></div>
      <div class="foot">
        <div>${isNew ? '' : '<button class="danger" data-act="delete">Удалить</button>'}</div>
        <div class="actions"><button data-act="cancel">Отмена</button><button class="primary" data-act="save">Сохранить</button></div>
      </div>
    </div>`;
  const resolve = c => (typeof c.options === 'function' ? { ...c, options: c.options(p, draft) } : c);
  const info = () => (cfg.info ? cfg.info(draft, p) : '');
  const draw = () => {
    $('#row-form', overlay).innerHTML = formCols.filter(([c]) => !c.show || c.show(draft, p))
      .map(([c, i]) => fieldHtml(resolve(c), draft[c.f] ?? (c.type === 'bool' ? false : ''), `data-c="${i}"`)).join('')
      + (cfg.info ? `<div class="wide small muted" id="row-info">${info()}</div>` : '');
  };
  const readAll = () => {
    for (const el of $$('[data-c]', overlay)) {
      const c = cfg.cols[Number(el.dataset.c)];
      draft[c.f] = readInput(el, c.type);
    }
  };
  draw();
  if (cfg.drawExtra) cfg.drawExtra($('#row-extra', overlay), draft, p);
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('input, select, textarea', overlay)?.focus();
  overlay.addEventListener('change', e => {
    const el = e.target.closest('[data-c]');
    if (!el) return;
    const c = cfg.cols[Number(el.dataset.c)];
    readAll();
    if (c.type === 'money') el.value = draft[c.f] === '' ? '' : fmtMoney(draft[c.f]);
    if (cfg.onChange) cfg.onChange(draft, c.f, p);
    if (c.rerender) draw();
    else if (cfg.info) $('#row-info', overlay).innerHTML = info();
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) return close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') close();
    if (act === 'save') {
      readAll();
      if (cfg.beforeSave) cfg.beforeSave(draft, p, isNew);
      if (isNew) p[key].push(draft);
      else Object.assign(row, draft);
      touch(p);
      close();
      route();
    }
    if (act === 'delete') {
      const btn = e.target.closest('[data-act]');
      if (btn.dataset.confirm) {
        if (cfg.onDelete) cfg.onDelete(row, p);
        p[key] = p[key].filter(r => r !== row);
        touch(p);
        close();
        route();
      } else {
        btn.dataset.confirm = '1';
        btn.textContent = 'Точно удалить?';
        btn.classList.add('solid');
      }
    }
  });
}

function confirmModal(text, okLabel, onOk) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><p>${esc(text)}</p>
    <div class="foot"><span></span><div class="actions"><button data-act="cancel">Отмена</button><button class="danger solid" data-act="ok">${esc(okLabel)}</button></div></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target === overlay || act === 'cancel') overlay.remove();
    if (act === 'ok') { overlay.remove(); onOk(); }
  });
}

// ---------- Сроки ----------

function renderDeadlines(main, params) {
  const range = params.get('range') || '30';
  const today = todayISO();
  const events = collectEvents().filter(e => {
    if (range === 'overdue') return e.date < today;
    if (range === 'all') return true;
    return e.date <= new Date(Date.parse(today) + Number(range) * 86400000).toISOString().slice(0, 10);
  });
  const opt = (v, t) => `<a class="btn ${range === v ? 'primary' : ''}" href="#/deadlines?range=${v}">${t}</a>`;
  main.innerHTML = `
    <div class="page-head"><div><h1>Сроки</h1><div class="muted">Отчёты и собрания, заседания и задачи по активным процедурам. Прошедшие даты — красным.</div></div></div>
    <div class="actions" style="margin-bottom:12px">${opt('overdue', 'Просрочено')}${opt('7', '7 дней')}${opt('14', '14 дней')}${opt('30', '30 дней')}${opt('90', '90 дней')}${opt('all', 'Все')}</div>
    <section class="panel">${eventsList(events, 'В выбранном периоде сроков нет')}</section>`;
}

// ---------- Настройки ----------

function renderSettings(main) {
  const s = DATA.settings;
  main.innerHTML = `
    <div class="page-head"><div><h1>Настройки</h1></div></div>
    <div class="grid two" id="settings">
      <section class="panel"><h2>Мои документы и сроки их действия</h2>
        <div class="form-grid">${s.au_docs.map((d, i) => `
          <label class="field wide">${esc(d.title)}<input type="date" data-doc="${i}" value="${esc(d.until)}"></label>`).join('')}
        </div>
      </section>
      <section class="panel"><h2>Отчётность</h2>
        <label class="field">Периодичность отчёта для новых процедур, мес.
          <input type="number" min="1" max="12" id="def-period" value="${esc(s.report_period_default || 3)}"></label>
        <p class="small muted">Срок следующего отчёта = последний отчёт или собрание + периодичность. Если указана дата вручную (или пришла из Сириуса), берётся более поздняя из двух.</p>
      </section>
      <section class="panel"><h2>Данные</h2>
        <p>Все данные хранятся в файле <b>siliveev-site\\crm\\данные\\crm.json</b> на компьютере, где работает CRM. Каждый день перед первым изменением сервер кладёт копию в <b>данные\\архив</b> (хранятся последние 60).</p>
        <p class="small muted">Последнее изменение: ${DATA.updated_at ? new Date(DATA.updated_at).toLocaleString('ru-RU') : '—'}</p>
        <div class="actions"><button id="backup">Скачать резервную копию (JSON)</button></div>
      </section>
    </div>
    <div class="grid" id="settings-extra" style="margin-top:14px"></div>`;
  renderSettingsExtra($('#settings-extra'));
  $('#settings').addEventListener('change', e => {
    if (e.target.dataset.doc != null) { s.au_docs[Number(e.target.dataset.doc)].until = e.target.value; touch(); }
    if (e.target.id === 'def-period') { s.report_period_default = Number(e.target.value) || 3; touch(); }
  });
  $('#backup').onclick = () => download(`crm-резерв-${todayISO()}.json`, JSON.stringify(DATA, null, 1), 'application/json');
}

// ---------- Помощники ----------

async function renderUsers(main) {
  main.innerHTML = '<div class="empty">Загружаю…</div>';
  let list;
  try { ({ users: list } = await api('users')); }
  catch (err) { main.innerHTML = `<div class="banner">${esc(err.message)}</div>`; return; }
  main.innerHTML = `
    <div class="page-head"><div><h1>Помощники</h1>
      <div class="muted">Помощник видит только закреплённые за ним процедуры. Он может создавать процедуры (они закрепляются за ним), удалять закреплённые за ним и подключать к ним других помощников. Менять настройки, добавлять помощников и смотреть журнал может только владелец.</div></div>
      <div class="actions"><button class="primary" id="add-user">+ Добавить помощника</button></div></div>
    <div class="panel table-wrap" style="padding:0"><table>
      <thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Код входа</th><th>Доступ</th><th>Последний вход</th><th class="num">Процедур</th></tr></thead>
      <tbody>${list.map(u => `
        <tr class="click" data-user="${u.id}">
          <td>${esc(u.name)}</td><td>${esc(u.login)}</td>
          <td>${u.role === 'owner' ? 'владелец' : 'помощник'}</td>
          <td>${u.totp_enabled ? '<span class="badge ok">подключён</span>' : '<span class="badge warn">ещё не подключён</span>'}</td>
          <td>${u.active ? '<span class="badge ok">включён</span>' : '<span class="badge gray">отключён</span>'}${u.must_change_password ? ' <span class="badge warn">временный пароль</span>' : ''}</td>
          <td class="nowrap">${u.last_login ? new Date(u.last_login).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
          <td class="num">${u.role === 'owner' ? 'все' : u.assigned}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  $('#add-user').onclick = () => addUserModal();
  $('tbody', main).addEventListener('click', e => {
    const tr = e.target.closest('tr[data-user]');
    if (tr) userModal(list.find(u => u.id === tr.dataset.user));
  });
}

function modal(html) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-act=close]')) close(); });
  return { el: overlay, close };
}

function credentialsNote(name, login, temp) {
  const url = location.origin + location.pathname;
  return `<p>Передайте ${esc(name)} лично или в мессенджере:</p>
    <div class="panel creds"><div>Адрес: <b>${esc(url)}</b></div><div>Логин: <b>${esc(login)}</b></div><div>Временный пароль: <b>${esc(temp)}</b></div></div>
    <p class="small muted">Пароль показан один раз. При первом входе помощник сменит его на свой и подключит код в приложении Яндекс Ключ или Google Authenticator.</p>`;
}

function addUserModal() {
  const m = modal(`<h2>Новый помощник</h2>
    <form id="u-form" class="form-grid">
      <label class="field wide">Имя и фамилия<input name="name" required></label>
      <label class="field wide">Логин (удобно — почта помощника)<input name="login" required autocomplete="off"></label>
      <div class="auth-err wide" id="u-err"></div>
      <div class="foot wide"><span></span><div class="actions"><button type="button" data-act="close">Отмена</button><button class="primary">Создать</button></div></div>
    </form>`);
  $('#u-form', m.el).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('users', { method: 'POST', body: fd });
      USERS.push({ id: r.user.id, name: r.user.name, role: r.user.role, active: true });
      m.el.querySelector('.modal').innerHTML = `<h2>Помощник создан</h2>${credentialsNote(r.user.name, r.user.login, r.temp_password)}
        <div class="foot"><span></span><div class="actions"><button data-act="assign" class="primary">Назначить процедуры</button><button data-act="close">Готово</button></div></div>`;
      $('[data-act=assign]', m.el).onclick = () => { m.close(); assignModal(r.user); };
      renderUsers($('#main'));
    } catch (err) { $('#u-err', m.el).textContent = err.message; }
  });
}

function userModal(u) {
  const self = u.id === ME.id;
  const m = modal(`<h2>${esc(u.name)}</h2>
    <p class="small muted">${esc(u.login)} · ${u.role === 'owner' ? 'владелец' : 'помощник'}</p>
    <form id="n-form" class="form-grid"><label class="field wide">Имя<input name="name" value="${esc(u.name)}" required></label></form>
    <div class="auth-err" id="u-err"></div>
    <div class="actions" style="margin-top:14px">
      <button data-act="save-name">Сохранить имя</button>
      ${u.role === 'assistant' ? `<button data-act="assign">Назначить процедуры (${u.assigned})</button>` : ''}
      ${self ? '' : `<button data-act="reset-pass">Сбросить пароль</button><button data-act="reset-totp">Сбросить код входа</button>
        <button data-act="toggle" class="${u.active ? 'danger' : ''}">${u.active ? 'Отключить доступ' : 'Включить доступ'}</button>`}
    </div>
    <div id="u-result"></div>
    <div class="foot"><a href="#/audit?user=${u.id}" data-act="close">Действия в журнале</a><button data-act="close">Закрыть</button></div>`);
  const patch = async (body, done) => {
    try {
      const r = await api('users/' + u.id, { method: 'PATCH', body });
      Object.assign(u, r.user);
      const local = USERS.find(x => x.id === u.id);
      if (local) Object.assign(local, { name: r.user.name, active: r.user.active });
      done(r);
      renderUsers($('#main'));
    } catch (err) { $('#u-err', m.el).textContent = err.message; }
  };
  m.el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'save-name') patch({ name: $('#n-form input', m.el).value }, () => toast('Имя сохранено'));
    if (act === 'assign') { m.close(); assignModal(u); }
    if (act === 'reset-pass') patch({ reset_password: true }, r => { $('#u-result', m.el).innerHTML = credentialsNote(u.name, u.login, r.temp_password); });
    if (act === 'reset-totp') patch({ reset_totp: true }, () => { $('#u-result', m.el).innerHTML = '<p>Код входа сброшен. При следующем входе помощник подключит его заново.</p>'; });
    if (act === 'toggle') patch({ active: !u.active }, () => { m.close(); toast(u.active ? 'Доступ включён' : 'Доступ отключён, сеансы помощника завершены'); });
  });
}

function assignModal(u) {
  const procs = [...DATA.procedures].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.debtor.name || '').localeCompare(b.debtor.name || '', 'ru'));
  const chosen = new Set(procs.filter(p => p.assignees.includes(u.id)).map(p => p.id));
  const m = modal(`<h2>Процедуры: ${esc(u.name)}</h2>
    <div class="actions" style="margin-bottom:10px"><input type="search" id="a-q" placeholder="Поиск по должнику или делу" style="flex:1">
      <button data-act="all">Отметить найденные</button><button data-act="none">Снять найденные</button></div>
    <div class="assign-list" id="a-list"></div>
    <div class="auth-err" id="a-err"></div>
    <div class="foot"><span class="small muted" id="a-count"></span><div class="actions"><button data-act="close">Отмена</button><button class="primary" data-act="save">Сохранить</button></div></div>`);
  const visible = () => {
    const q = $('#a-q', m.el).value.trim().toLowerCase();
    return procs.filter(p => !q || [p.debtor.name, p.case_number, p.debtor.inn].join(' ').toLowerCase().includes(q));
  };
  const draw = () => {
    $('#a-list', m.el).innerHTML = visible().map(p => `
      <label class="field check"><input type="checkbox" data-pid="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}>
        <span>${esc(p.debtor.name || 'Без названия')} <span class="small muted">${esc(p.case_number || '')} · ${STATUS[p.status] || ''}</span></span></label>`).join('') || '<div class="empty">Ничего не найдено</div>';
    $('#a-count', m.el).textContent = `Отмечено: ${chosen.size}`;
  };
  draw();
  $('#a-q', m.el).addEventListener('input', draw);
  $('#a-list', m.el).addEventListener('change', e => {
    const id = e.target.dataset.pid;
    if (id) { e.target.checked ? chosen.add(id) : chosen.delete(id); $('#a-count', m.el).textContent = `Отмечено: ${chosen.size}`; }
  });
  m.el.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'all') { visible().forEach(p => chosen.add(p.id)); draw(); }
    if (act === 'none') { visible().forEach(p => chosen.delete(p.id)); draw(); }
    if (act === 'save') {
      try {
        if (dirty.size) await saveNow();
        const r = await api(`users/${u.id}/assignments`, { method: 'PUT', body: { procedure_ids: [...chosen] } });
        await loadData();
        m.close();
        toast(`Назначено ${r.added}, снято ${r.removed}`);
        route();
      } catch (err) { $('#a-err', m.el).textContent = err.message; }
    }
  });
}

// ---------- Журнал действий ----------

const ACTIONS = {
  login: 'Вход', logout: 'Выход', login_failed: 'Неудачный вход', totp_failed: 'Неверный код входа', totp_enrolled: 'Подключил(а) код входа',
  owner_created: 'Создан владелец', procedure_create: 'Создал(а) процедуру', procedure_update: 'Изменил(а) процедуру',
  procedure_delete: 'Удалил(а) процедуру', settings_update: 'Изменил(а) настройки', user_create: 'Добавил(а) помощника',
  user_update: 'Изменил(а) доступ помощника', assignments: 'Назначил(а) процедуры', password_change: 'Сменил(а) пароль', import: 'Импорт из Сириуса',
};

function fieldLabel(path) {
  for (const g of MAIN_GROUPS) for (const f of g.fields) if (f.path === path) return f.label;
  if (LIST_LABELS[path]) return LIST_LABELS[path];
  for (const f of [...DEBTOR_FIELDS_IND, ...DEBTOR_FIELDS_ENT]) if (f.f === path) return f.label;
  const [head, sub] = path.split('.');
  if (sub && LIST_LABELS[head]) return `${LIST_LABELS[head]}: ${sub}`;
  return { assignees: 'Помощники', notes: 'Заметки', 'debtor.name': 'Должник', doc_seq: 'Счётчик исходящих номеров', inventory_date: 'Дата описи', inventory_no: '№ описи' }[path] || path;
}

function showValue(path, v) {
  if (v === '' || v == null) return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (path === 'assignees' && Array.isArray(v)) return v.map(userName).join(', ') || '—';
  if (path === 'status') return STATUS[v] || v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

function describeChanges(changes = []) {
  return changes.map(c => {
    if ('added' in c) {
      const parts = [c.added && `+${c.added}`, c.removed && `−${c.removed}`, c.changed && `изм. ${c.changed}`].filter(Boolean).join(', ');
      return `${esc(fieldLabel(c.f))}: ${parts}`;
    }
    if (c.f === 'notes') return 'Заметки изменены';
    return `${esc(fieldLabel(c.f))}: ${esc(showValue(c.f, c.from))} → ${esc(showValue(c.f, c.to))}`;
  }).join('<br>');
}

function auditTable(entries, withProcedure = true) {
  if (!entries.length) return '<div class="empty">Записей пока нет</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th>${withProcedure ? '<th>Процедура</th>' : ''}<th>Подробности</th></tr></thead>
    <tbody>${entries.map(e => {
      const p = e.procedure_id && DATA.procedures.find(x => x.id === e.procedure_id);
      return `<tr>
        <td class="nowrap">${new Date(e.ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' })}</td>
        <td>${esc(e.user_name || '—')}</td>
        <td>${esc(ACTIONS[e.action] || e.action)}</td>
        ${withProcedure ? `<td>${p ? `<a href="#/p/${p.id}/history">${esc(p.debtor.name || 'без названия')}</a>` : esc(e.debtor || '')}</td>` : ''}
        <td class="small">${e.changes ? describeChanges(e.changes) : esc([e.target, e.details].filter(Boolean).join(': '))}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

async function renderAudit(main, params) {
  const who = params.get('user') || '';
  main.innerHTML = `
    <div class="page-head"><div><h1>Журнал действий</h1><div class="muted">Кто, когда и что изменил. Показаны последние 500 записей.</div></div>
      <div class="actions"><select id="who"><option value="">Все пользователи</option>${USERS.map(u => `<option value="${u.id}" ${who === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div></div>
    <section class="panel" id="audit-body"><div class="empty">Загружаю…</div></section>`;
  $('#who').onchange = e => { location.hash = '#/audit' + (e.target.value ? '?user=' + e.target.value : ''); };
  try {
    const { entries } = await api('audit' + (who ? '?user=' + encodeURIComponent(who) : ''));
    $('#audit-body').innerHTML = auditTable(entries);
  } catch (err) {
    $('#audit-body').innerHTML = `<div class="banner">${esc(err.message)}</div>`;
  }
}

// ---------- Профиль ----------

function passwordForm(withCurrentLabel = 'Текущий пароль') {
  return `<form id="pw-form" class="form-grid">
    <label class="field wide">${esc(withCurrentLabel)}<input type="password" name="current" autocomplete="current-password" required></label>
    <label class="field wide">Новый пароль (не короче 10 символов, буквы и цифры)<input type="password" name="password" autocomplete="new-password" required></label>
    <label class="field wide">Новый пароль ещё раз<input type="password" name="repeat" autocomplete="new-password" required></label>
    <div class="auth-err wide" id="pw-err"></div>
    <div class="wide"><button class="primary">Сменить пароль</button></div>
  </form>`;
}

function bindPasswordForm(root, onDone) {
  $('#pw-form', root).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (fd.password !== fd.repeat) { $('#pw-err', root).textContent = 'Новые пароли не совпадают'; return; }
    try {
      const r = await api('me/password', { method: 'POST', body: { current: fd.current, password: fd.password } });
      ME = { ...ME, ...r.user };
      onDone();
    } catch (err) { $('#pw-err', root).textContent = err.message; }
  });
}

function renderProfile(main) {
  main.innerHTML = `
    <div class="page-head"><div><h1>${esc(ME.name)}</h1><div class="muted">${esc(ME.login)} · ${isOwner() ? 'владелец' : 'помощник'}</div></div></div>
    <div class="grid two">
      <section class="panel"><h2>Смена пароля</h2>${passwordForm()}</section>
      <section class="panel"><h2>Код входа</h2>
        <p>Код из приложения на телефоне подключён.</p>
        <p class="small muted">${isOwner()
          ? 'Если вы потеряли или сменили телефон, закройте CRM и выполните команду из раздела «Восстановление доступа» в crm\\README.md: она сбросит код, и при следующем входе вы подключите его заново.'
          : 'Если вы сменили телефон, попросите Илью Михайловича сбросить код входа: при следующем входе вы подключите его заново.'}</p>
      </section>
    </div>`;
  bindPasswordForm(main, () => { toast('Пароль изменён'); renderProfile(main); });
}

// ---------- Вход ----------

function authScreen(inner) {
  document.body.innerHTML = `<div class="auth"><div class="auth-card panel">
    <div class="brand">CRM АУ<span>кабинет Ильи Силивеева и помощников</span></div>${inner}
    <p class="small muted" style="margin-top:18px"><a href="/">← На сайт</a></p></div></div>`;
}

function bindAuthForm(handler) {
  const form = $('#auth-form');
  form.querySelector('input')?.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try { await handler(Object.fromEntries(new FormData(form))); }
    catch (err) { $('#auth-err').textContent = err.message; btn.disabled = false; }
  });
}

function showLogin(after) {
  authScreen(`<h2>Вход</h2>
    <form id="auth-form" class="auth-form">
      <label class="field">Логин<input name="login" autocomplete="username" required></label>
      <label class="field">Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="auth-err" id="auth-err"></div>
      <button class="primary">Войти</button>
    </form>`);
  bindAuthForm(async fd => nextStage(await api('login', { method: 'POST', body: fd }), after));
}

function nextStage(r, after) {
  if (r.stage === 'totp') showTotp(r.ticket, after);
  else if (r.stage === 'enroll') showEnroll(r, after);
}

function codeField() {
  return '<label class="field">Код из приложения<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required class="code"></label>';
}

function showTotp(ticket, after) {
  authScreen(`<h2>Код подтверждения</h2>
    <p class="muted">Откройте Яндекс Ключ или Google Authenticator и введите шестизначный код для «Siliveev CRM».</p>
    <form id="auth-form" class="auth-form">${codeField()}<div class="auth-err" id="auth-err"></div><button class="primary">Подтвердить</button></form>`);
  bindAuthForm(async fd => afterLogin((await api('login/totp', { method: 'POST', body: { ticket, code: fd.code } })).user, after));
}

function showEnroll(r, after) {
  let qrSvg = '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(r.uri);
    qr.make();
    qrSvg = qr.createSvgTag(5, 2);
  } catch { /* без QR остаётся ввод ключа вручную */ }
  authScreen(`<h2>Подключите код входа</h2>
    <ol class="steps">
      <li>Установите на телефон приложение <b>Яндекс Ключ</b> или <b>Google Authenticator</b>.</li>
      <li>В приложении добавьте аккаунт и отсканируйте QR-код. Если сканировать нечем, введите ключ вручную.</li>
      <li>Введите шестизначный код, который покажет приложение.</li>
    </ol>
    <div class="qr">${qrSvg}</div>
    <p class="small muted">Ключ: <code class="secret">${esc(r.secret.match(/.{1,4}/g).join(' '))}</code></p>
    <form id="auth-form" class="auth-form">${codeField()}<div class="auth-err" id="auth-err"></div><button class="primary">Подключить и войти</button></form>`);
  bindAuthForm(async fd => afterLogin((await api('login/enroll', { method: 'POST', body: { ticket: r.ticket, code: fd.code } })).user, after));
}

function afterLogin(user, after) {
  ME = user;
  if (user.must_change_password) return showChangePassword(after);
  after ? after() : boot();
}

function showChangePassword(after) {
  authScreen(`<h2>Придумайте свой пароль</h2>
    <p class="muted">Вы вошли по временному паролю. Замените его на свой — временный перестанет работать.</p>${passwordForm('Временный пароль')}`);
  bindPasswordForm(document.body, () => (after ? after() : boot()));
}

function showSetup() {
  authScreen(`<h2>Первый запуск</h2>
    <p class="muted">Создайте учётную запись владельца CRM. Затем подключите код входа в приложении на телефоне.</p>
    <form id="auth-form" class="auth-form">
      <label class="field">Ваше имя<input name="name" value="Илья Силивеев" required></label>
      <label class="field">Логин (удобно — почта)<input name="login" autocomplete="username" required></label>
      <label class="field">Пароль (не короче 10 символов, буквы и цифры)<input name="password" type="password" autocomplete="new-password" required></label>
      <label class="field">Пароль ещё раз<input name="repeat" type="password" autocomplete="new-password" required></label>
      <div class="auth-err" id="auth-err"></div>
      <button class="primary">Создать и продолжить</button>
    </form>`);
  bindAuthForm(async fd => {
    if (fd.password !== fd.repeat) throw new Error('Пароли не совпадают');
    nextStage(await api('setup', { method: 'POST', body: { name: fd.name, login: fd.login, password: fd.password } }));
  });
}

async function startAuth() {
  const { needed } = await api('setup');
  needed ? showSetup() : showLogin();
}

// ---------- Запуск ----------

let routeBound = false;

async function boot() {
  try {
    await loadData();
  } catch (err) {
    if (err.status === 401) return startAuth();
    if (err.status === 403 && ME?.must_change_password) return showChangePassword();
    document.body.innerHTML = `<div class="auth"><div class="banner">Не удалось загрузить данные: ${esc(err.message)}</div></div>`;
    return;
  }
  renderShell();
  if (!routeBound) { window.addEventListener('hashchange', route); routeBound = true; }
  route();
}

(async function start() {
  try {
    ME = (await api('session')).user;
    if (ME.must_change_password) return showChangePassword();
    boot();
  } catch (err) {
    if (err.status === 401) startAuth().catch(e => { document.body.innerHTML = `<div class="auth"><div class="banner">${esc(e.message)}</div></div>`; });
    else document.body.innerHTML = `<div class="auth"><div class="banner">CRM не отвечает: ${esc(err.message)}. Запустите её ярлыком «Сайт и CRM».</div></div>`;
  }
})();
