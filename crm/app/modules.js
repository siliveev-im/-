'use strict';

// Разделы карточки процедуры по образцу Rafinad.ai: должник и семья, РТК, деньги, имущество, люди,
// документы, собрания, отчёт АУ и финанализ, типовые задачи, реквизиты для документов в настройках.
// Скрипт загружается раньше app.js: всё, что берётся из app.js, используется только внутри функций.

// Вкладки карточки. Третий элемент — вложенные вкладки.
const CARD_TABS = [
  ['main', 'Основное'],
  ['debtor', 'Должник и семья'],
  ['rtk', 'РТК'],
  ['money', 'Деньги', [['accounts', 'Счета'], ['costs', 'Текущие расходы'], ['payments', 'Поступления и платежи'], ['queues', 'Сводка по очередям']]],
  ['property', 'Имущество', [['assets', 'Имущество'], ['receivables', 'Дебиторка'], ['measures', 'Меры по сохранности']]],
  ['people', 'Люди', [['counterparties', 'Контрагенты'], ['involved', 'Привлечённые лица'], ['workers', 'Работники'], ['complaints', 'Жалобы']]],
  ['docs', 'Документы'],
  ['meetings', 'Собрания'],
  ['analysis', 'Отчёт и финанализ', [['report', 'Отчёт АУ'], ['finanalysis', 'Финанализ']]],
  ['court', 'Суд и публикации', [['hearings', 'Заседания'], ['disputes', 'Споры'], ['publications', 'Публикации']]],
  ['reports', 'Отчёты в СРО'],
  ['tasks', 'Задачи'],
  ['notes', 'Заметки'],
];

const TAB_COUNTS = { rtk: ['claims'], docs: ['documents'], meetings: ['meetings'], reports: ['reports'], tasks: ['tasks'] };

// «hearings» → ['court', 'hearings'], «claims» → ['rtk'], старые ссылки продолжают работать.
function resolveTab(tab, sub) {
  if (tab === 'claims') return ['rtk', ''];
  for (const [k, , subs] of CARD_TABS) {
    if (k === tab) return [k, sub || (subs ? subs[0][0] : '')];
    if (subs && subs.some(([s]) => s === tab)) return [k, tab];
  }
  return [tab, sub || ''];
}

function tabCount(p, key) {
  const [, , subs] = CARD_TABS.find(([k]) => k === key) || [];
  const lists = subs ? subs.map(([s]) => s).filter(s => Array.isArray(p[s])) : TAB_COUNTS[key] || [];
  return lists.reduce((s, k) => s + (k === 'tasks' ? p.tasks.filter(t => !t.done).length : p[k].length), 0);
}

function subTabsHtml(p, tab, sub) {
  const [, , subs] = CARD_TABS.find(([k]) => k === tab) || [];
  if (!subs) return '';
  return `<nav class="subtabs">${subs.map(([k, t]) => {
    const n = Array.isArray(p[k]) ? p[k].length : 0;
    return `<a href="#/p/${p.id}/${tab}/${k}" class="${k === sub ? 'active' : ''}">${esc(t)}${n ? ` <span class="n">${n}</span>` : ''}</a>`;
  }).join('')}</nav>`;
}

// Отрисовка вкладок, которых нет в app.js. Возвращает false, если вкладка не наша.
function renderModuleTab(body, p, tab, sub, rest) {
  const wrap = () => { body.innerHTML = subTabsHtml(p, tab, sub) + '<div id="sub-body"></div>'; return $('#sub-body', body); };
  if (tab === 'debtor') { renderDebtorTab(body, p); return true; }
  if (tab === 'rtk') { renderRtk(body, p); return true; }
  if (tab === 'money') {
    const b = wrap();
    if (sub === 'payments') renderPayments(b, p);
    else if (sub === 'queues') renderQueues(b, p);
    else if (sub === 'costs') renderSubtable(b, p, 'costs', { extraActions: '<span class="small muted">Оплата отмечается в разделе «Поступления и платежи» — там платёж распределяется по расходам.</span>' });
    else renderSubtable(b, p, 'accounts');
    return true;
  }
  if (tab === 'property') {
    const b = wrap();
    if (sub === 'receivables') renderSubtable(b, p, 'receivables');
    else if (sub === 'measures') renderSubtable(b, p, 'measures');
    else renderAssets(b, p);
    return true;
  }
  if (tab === 'people') {
    const b = wrap();
    if (sub === 'involved') renderSubtable(b, p, 'involved');
    else if (sub === 'workers') renderWorkers(b, p);
    else if (sub === 'complaints') renderSubtable(b, p, 'complaints');
    else renderCounterparties(b, p);
    return true;
  }
  if (tab === 'court') { renderSubtable(wrap(), p, sub || 'hearings'); return true; }
  if (tab === 'docs') { renderDocs(body, p); return true; }
  if (tab === 'meetings') { renderMeetings(body, p, sub, rest); return true; }
  if (tab === 'analysis') {
    const b = wrap();
    if (sub === 'finanalysis') renderFinanalysis(b, p);
    else renderReportTab(b, p);
    return true;
  }
  if (tab === 'tasks') { renderTasks(body, p); return true; }
  return false;
}

// ---------- Формы по объекту ----------

// Поля на объекте obj (пути вида «a» или «a.b»). onChange вызывается после каждой правки.
function objFormHtml(defs, obj, prefix = 'of') {
  return defs.map((d, i) => {
    if (d.heading) return `<h3 class="wide form-sub">${esc(d.heading)}</h3>`;
    if (d.computed) return `<div class="field small muted ${d.wide ? 'wide' : ''}">${esc(d.label)}<div class="computed" data-${prefix}-computed="${i}">${d.computed(obj)}</div></div>`;
    return fieldHtml(d, getPath(obj, d.f) ?? (d.type === 'bool' ? false : ''), `data-${prefix}="${i}"`);
  }).join('');
}

function bindObjForm(root, defs, obj, onChange, prefix = 'of') {
  root.addEventListener('change', e => {
    const el = e.target.closest(`[data-${prefix}]`);
    if (!el) return;
    const d = defs[Number(el.getAttribute(`data-${prefix}`))];
    const v = readInput(el, d.type);
    setPath(obj, d.f, v);
    if (d.type === 'money' || d.type === 'decimal') el.value = v === '' ? '' : fmtMoney(v);
    $$(`[data-${prefix}-computed]`, root).forEach(c => { c.innerHTML = defs[Number(c.getAttribute(`data-${prefix}-computed`))].computed(obj); });
    onChange(d, v);
  });
}

// ---------- Должник и семья ----------

const DEBTOR_FIELDS_IND = [
  { heading: 'Персональные данные' },
  { f: 'debtor.sex', label: 'Пол (для текстов документов)', type: 'select', options: [['м', 'мужской'], ['ж', 'женский']] },
  { f: 'debtor.prev_names', label: 'Прежние ФИО', wide: true },
  { f: 'debtor.passport', label: 'Паспорт: серия и номер' },
  { f: 'debtor.passport_date', label: 'Дата выдачи', type: 'date' },
  { f: 'debtor.passport_code', label: 'Код подразделения' },
  { f: 'debtor.passport_issued', label: 'Кем выдан', wide: true },
  { f: 'debtor.postal_address', label: 'Почтовый адрес', wide: true },
  { f: 'debtor.actual_address', label: 'Адрес фактического проживания', wide: true },
  { f: 'debtor.phone', label: 'Телефон' },
  { f: 'debtor.email', label: 'Электронная почта' },
  { f: 'debtor.ogrnip', label: 'ОГРНИП (если ИП)' },
  { f: 'debtor.employment', label: 'Место работы, должность', wide: true },
  { heading: 'Прожиточный минимум и необходимые расходы (в месяц)' },
  { f: 'subsistence.debtor', label: 'Прожиточный минимум на должника, ₽', type: 'money' },
  { f: 'subsistence.child', label: 'Прожиточный минимум на ребёнка, ₽', type: 'money' },
  { f: 'subsistence.source', label: 'Источник (постановление региона)', wide: true },
  { f: 'expenses.alimony', label: 'Алименты, ₽', type: 'money' },
  { f: 'expenses.medical', label: 'Лечение, ₽', type: 'money' },
  { f: 'expenses.other', label: 'Иные необходимые расходы, ₽', type: 'money' },
  { label: 'Платёжеспособность (по доходам ниже)', wide: true, computed: p => solvencyHtml(p) },
];

const DEBTOR_FIELDS_ENT = [
  { heading: 'Сведения о юрлице' },
  { f: 'debtor.kpp', label: 'КПП' },
  { f: 'debtor.okved', label: 'Основной ОКВЭД' },
  { f: 'debtor.head_name', label: 'Руководитель (ФИО)', wide: true },
  { f: 'debtor.head_position', label: 'Должность руководителя' },
  { f: 'debtor.postal_address', label: 'Почтовый адрес', wide: true },
  { f: 'debtor.phone', label: 'Телефон' },
  { f: 'debtor.email', label: 'Электронная почта' },
];

function solvencyHtml(p) {
  const s = solvency(p);
  if (!s.income) return '<span class="muted">Добавьте источники дохода в таблице ниже — здесь появится расчёт.</span>';
  return `Доход ${fmtMoney(s.income)} ₽ − необходимые расходы ${fmtMoney(s.need)} ₽ = <b>${fmtMoney(s.surplus)} ₽</b> в месяц.
    ${s.surplus > 0 && s.debts ? `За 36 месяцев можно погасить ${fmtMoney(Math.min(s.over3y, s.debts))} ₽ из ${fmtMoney(s.debts)} ₽ реестра (${fmtPct(s.share)}).` : ''}`;
}

function renderDebtorTab(body, p) {
  const ent = p.debtor_type === 'ent';
  const defs = ent ? DEBTOR_FIELDS_ENT : DEBTOR_FIELDS_IND;
  body.innerHTML = `<div class="panel"><div class="small muted" style="margin-bottom:10px">ФИО, ИНН, СНИЛС, дата и место рождения, адрес регистрации — на вкладке «Основное». Здесь — данные, которые нужны для документов и финанализа.</div>
    <div class="form-grid" id="deb-form">${objFormHtml(defs, p)}</div></div><div id="deb-lists"></div>`;
  bindObjForm($('#deb-form', body), defs, p, () => touch(p));
  const lists = $('#deb-lists', body);
  if (!ent) {
    renderSubtable(lists, p, 'spouses', { append: true, title: 'Супруги' });
    renderSubtable(lists, p, 'children', { append: true, title: 'Дети' });
  }
  renderSubtable(lists, p, 'incomes', { append: true, title: ent ? 'Источники поступлений' : 'Источники постоянного дохода' });
}

// ---------- РТК ----------

const MORATORIUM_CFG = {
  add: 'Добавить мораторные проценты',
  defaults: p => ({ moratorium: true, queue: '3 очередь', from: p.dates.introduction || '', to: todayISO(), included_date: todayISO() }),
  cols: [
    { f: 'base_id', label: 'Требование, на которое начисляются проценты', type: 'select', wide: true, rerender: true,
      options: p => activeClaims(p).filter(c => !c.moratorium && c.queue === '3 очередь').map(c => [c.id, `${c.creditor || '—'}: № ${c.number || '—'}, ${fmtMoney(c.amount)} ₽`]) },
    { f: 'rate', label: 'Ставка, % годовых (обычно ключевая ставка ЦБ на дату введения)', type: 'decimal', rerender: true },
    { f: 'from', label: 'Период начисления с', type: 'date', rerender: true },
    { f: 'to', label: 'по', type: 'date', rerender: true },
    { f: 'number', label: '№ требования по мораторным процентам' },
    { f: 'included_date', label: 'Дата внесения записи', type: 'date' },
    { f: 'amount', label: 'Сумма, ₽ (пусто — посчитать автоматически)', type: 'money' },
    { f: 'court_act', label: 'Реквизиты документа (ст. 95 / ст. 126 Закона о банкротстве, судебный акт, расчёт)', wide: true },
    { f: 'note', label: 'Примечание', type: 'textarea', wide: true },
  ],
  info: (d, p) => {
    const base = p.claims.find(c => c.id === d.base_id);
    const v = moratoriumAmount(base?.amount, d.rate, d.from, d.to);
    return base ? `Расчёт: ${fmtMoney(base.amount)} ₽ × ${d.rate || 0} % за ${d.from && d.to ? Math.round((Date.parse(d.to) - Date.parse(d.from)) / 86400000) + 1 : 0} дн. = <b>${fmtMoney(v)} ₽</b> (по дням с учётом високосных лет)` : 'Выберите требование.';
  },
  beforeSave: (d, p) => {
    const base = p.claims.find(c => c.id === d.base_id);
    if (base) d.creditor = base.creditor;
    d.obligation = '';
    if (d.amount === '' || d.amount == null) d.amount = moratoriumAmount(base?.amount, d.rate, d.from, d.to);
  },
};

function renderRtk(body, p) {
  p.rtk = p.rtk || {};
  const s = rtkSummary(p);
  const sv = securedVotesDefault(p);
  const close = rtkCloseDate(p);
  const defs = [
    { f: 'fedresurs_date', label: 'Публикация в ЕФРСБ', type: 'date' },
    { f: 'kommersant_date', label: 'Публикация в «Коммерсантъ»', type: 'date' },
    { f: 'close_date', label: 'Дата закрытия реестра (пусто — посчитать)', type: 'date' },
    { label: 'Реестр закрывается', computed: () => (close ? dueBadge(close) : '<span class="muted">укажите дату публикации</span>') },
  ];
  const rowsHtml = RTK_SECTIONS.map(([k, title]) => {
    const sec = s.sections[k];
    const head = `<tr class="sec"><td colspan="9">${esc(title)}</td></tr>`;
    const total = k === 'off' ? `<tr class="total"><td colspan="5">ИТОГО по реестру</td><td class="num">${fmtMoney(s.total.amount)}</td><td class="num">${fmtMoney(s.total.paid)}</td><td class="num">${fmtPct(pct(s.total.paid, s.total.amount))}</td><td class="num">${fmtMoney(s.total.amount - s.total.paid)}</td></tr>` : '';
    const rows = [...sec.rows].sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'ru', { numeric: true })).map(c => {
      const paid = claimPaid(p, c);
      return `<tr class="click" data-claim="${c.id}"><td>${esc(c.number)}</td><td class="nowrap">${fmtDate(c.included_date)}</td><td>${esc(c.creditor)}${c.creditor_no ? ` <span class="small muted">№ ${esc(c.creditor_no)}</span>` : ''}</td>
        <td class="small">${esc([c.obligation, c.moratorium && `ставка ${c.rate} %, ${fmtDate(c.from)}–${fmtDate(c.to)}`, c.court_act].filter(Boolean).join('; '))}</td>
        <td>${isVotingClaim(c, sv) ? '<span class="badge ok" title="Учитывается при голосовании">голос</span>' : ''}</td>
        <td class="num">${fmtMoney(c.amount)}</td><td class="num">${fmtMoney(paid)}</td><td class="num">${fmtPct(pct(paid, n(c.amount)))}</td><td class="num">${fmtMoney(n(c.amount) - paid)}</td></tr>`;
    }).join('');
    const sub = sec.rows.length ? `<tr class="subtotal"><td colspan="5">Итого</td><td class="num">${fmtMoney(sec.amount)}</td><td class="num">${fmtMoney(sec.paid)}</td><td class="num">${fmtPct(pct(sec.paid, sec.amount))}</td><td class="num">${fmtMoney(sec.amount - sec.paid)}</td></tr>` : '';
    return total + head + (rows || '<tr><td colspan="9" class="muted small">Требований нет</td></tr>') + sub;
  }).join('');
  const changes = p.claim_changes || [];
  body.innerHTML = `
    <div class="panel" style="margin-bottom:12px"><div class="form-grid" id="rtk-form">${objFormHtml(defs, p.rtk)}</div>
      <p class="small muted" style="margin:10px 0 0">Голосуют требования третьей очереди без неустоек, процентов за просрочку и мораторных процентов (п. 3 ст. 12 Закона о банкротстве).
      Залоговые кредиторы в процедуре «${esc(p.procedure_type || 'не указана')}» ${sv ? 'голосуют' : 'по общему правилу не голосуют'} (п. 1 ст. 12). Голоса считаются по непогашенному остатку.</p></div>
    <div class="actions" style="margin-bottom:12px">
      <button class="primary" id="add-claim">+ Требование</button>
      <button id="add-mor">+ Мораторные проценты</button>
      <button id="change-claim" ${activeClaims(p).length ? '' : 'disabled'}>Изменение требования</button>
      <button id="rtk-docx">Скачать РТК (.docx)</button>
      <span class="small muted">Кредиторов в реестре: ${s.creditors}</span>
    </div>
    <div class="panel table-wrap" style="padding:0"><table class="rtk">
      <thead><tr><th>№ треб.</th><th>Дата записи</th><th>Кредитор</th><th>Основание</th><th></th><th class="num">Сумма, ₽</th><th class="num">Погашено, ₽</th><th class="num">%</th><th class="num">Остаток, ₽</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td colspan="5">ВСЕГО с требованиями за реестром</td><td class="num">${fmtMoney(s.all.amount)}</td><td class="num">${fmtMoney(s.all.paid)}</td><td class="num">${fmtPct(pct(s.all.paid, s.all.amount))}</td><td class="num">${fmtMoney(s.all.amount - s.all.paid)}</td></tr></tfoot>
    </table></div>
    ${changes.length ? `<h2 style="margin-top:20px">Изменения требований</h2><div class="panel table-wrap" style="padding:0"><table>
      <thead><tr><th>Дата</th><th>Вид</th><th>Прежний кредитор</th><th>Новый кредитор</th><th class="num">Сумма, ₽</th><th>Судебный акт</th></tr></thead>
      <tbody>${changes.map(x => `<tr><td class="nowrap">${fmtDate(x.date)}</td><td>${esc(x.kind)}</td><td>${esc(x.creditor_from)}</td><td>${esc(x.creditor_to)}</td><td class="num">${fmtMoney(x.amount)}</td><td>${esc(x.act)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${p.claims.some(c => c.excluded) ? `<p class="small muted" style="margin-top:10px">Исключённые требования (${p.claims.filter(c => c.excluded).length}) в реестре не показаны, они видны в истории изменений.</p>` : ''}`;
  bindObjForm($('#rtk-form', body), defs, p.rtk, () => { touch(p); renderRtk(body, p); });
  $('#add-claim').onclick = () => editRow(p, 'claims', null);
  $('#add-mor').onclick = () => editRow(p, 'claims', null, { cfg: MORATORIUM_CFG });
  $('#change-claim').onclick = () => claimChangeModal(p);
  $('#rtk-docx').onclick = () => saveDocx(`РТК ${p.debtor.name || ''} ${todayISO()}`, rtkBlocks(p), { landscape: true });
  $('tbody', body).addEventListener('click', e => {
    const tr = e.target.closest('tr[data-claim]');
    if (!tr) return;
    const c = p.claims.find(x => x.id === tr.dataset.claim);
    editRow(p, 'claims', c, c.moratorium ? { cfg: MORATORIUM_CFG } : {});
  });
}

function claimChangeModal(p) {
  const claims = activeClaims(p);
  const m = modal(`<h2>Изменение требования</h2>
    <form id="cc-form" class="form-grid">
      <label class="field wide">Требование<select name="claim_id" required>${claims.map(c => `<option value="${c.id}">${esc(c.creditor || '—')} · № ${esc(c.number || '—')} · ${esc(c.queue || '')} · ${fmtMoney(c.amount)} ₽</option>`).join('')}</select></label>
      <label class="field wide">Вид изменения<select name="kind">${CLAIM_CHANGE_KINDS.map(k => `<option>${k}</option>`).join('')}</select></label>
      <label class="field">Дата судебного акта<input type="date" name="date" value="${todayISO()}" required></label>
      <label class="field wide">Судебный акт (определение от …)<input name="act"></label>
      <label class="field">Сумма изменения, ₽ (пусто — всё требование)<input name="amount" inputmode="decimal"></label>
      <label class="field wide">Новый кредитор (для замены)<input name="creditor_to" list="cp-names"></label>
      <label class="field">Новая очередь (для изменения очерёдности)<select name="queue"><option></option>${CLAIM_QUEUES.map(q => `<option>${q}</option>`).join('')}</select></label>
      <div class="auth-err wide" id="cc-err"></div>
      <div class="foot wide"><span class="small muted">Изменение сразу меняет реестр и записывается в историю.</span><div class="actions"><button type="button" data-act="close">Отмена</button><button class="primary">Применить</button></div></div>
    </form>`);
  $('#cc-form', m.el).addEventListener('submit', e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const c = p.claims.find(x => x.id === f.claim_id);
    const full = n(c.amount);
    const amt = parseMoney(f.amount) === '' ? full : Math.min(full, n(parseMoney(f.amount)));
    const rec = { id: uid(), date: f.date, act: f.act, kind: f.kind, claim_id: c.id, creditor_from: c.creditor, creditor_to: '', amount: amt };
    if (f.kind.startsWith('Замена')) {
      if (!f.creditor_to.trim()) { $('#cc-err', m.el).textContent = 'Укажите нового кредитора'; return; }
      rec.creditor_to = f.creditor_to.trim();
      if (amt >= full) c.creditor = rec.creditor_to;
      else {
        c.amount = full - amt;
        const copy = { ...structuredClone(c), id: uid(), creditor: rec.creditor_to, amount: amt, paid: '', included_date: f.date, court_act: f.act, from_claim: c.id };
        p.claims.push(copy);
        rec.new_claim_id = copy.id;
      }
    } else if (f.kind.startsWith('Уменьшение') || f.kind.startsWith('Исключение')) {
      c.amount = Math.max(0, full - amt);
      if (!c.amount) c.excluded = true;
    } else if (f.kind === 'Перевод за реестр') {
      c.queue = 'За реестром';
    } else if (f.kind === 'Изменение очерёдности') {
      if (!f.queue) { $('#cc-err', m.el).textContent = 'Выберите новую очередь'; return; }
      rec.creditor_to = f.queue;
      c.queue = f.queue;
    } else if (f.kind === 'Признание обеспеченным залогом') c.secured = true;
    else if (f.kind === 'Снятие залога') c.secured = false;
    p.claim_changes.push(rec);
    touch(p);
    m.close();
    route();
  });
}

// ---------- Деньги ----------

function renderPayments(body, p) {
  const rows = [...p.payments].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const accName = id => { const a = p.accounts.find(x => x.id === id); return a ? [a.bank, a.number && '…' + String(a.number).slice(-4)].filter(Boolean).join(' ') : ''; };
  const inSum = sumBy(p.payments.filter(x => x.dir === 'in'), 'amount');
  const outSum = sumBy(p.payments.filter(x => x.dir === 'out'), 'amount');
  body.innerHTML = `
    <div class="actions" style="margin-bottom:12px">
      <button class="primary" data-new="in">+ Поступление</button><button class="primary" data-new="out">+ Платёж</button>
      <button id="cash-docx">Отчёт об использовании денег (.docx)</button>
    </div>
    <div class="panel table-wrap" style="padding:0"><table>
      <thead><tr><th>Дата</th><th>Вид</th><th>№ док.</th><th class="num">Сумма, ₽</th><th>Счёт</th><th>Контрагент</th><th>Назначение</th><th>Погашение</th></tr></thead>
      <tbody>${rows.length ? rows.map(x => {
        const alloc = sumBy(x.allocations || [], 'amount');
        const warn = x.dir === 'out' && x.allocations?.length && Math.abs(alloc - n(x.amount)) > 0.009;
        return `<tr class="click" data-pay="${x.id}"><td class="nowrap">${fmtDate(x.date)}</td><td>${x.dir === 'in' ? '<span class="badge ok">поступление</span>' : '<span class="badge">платёж</span>'}</td><td>${esc(x.doc_no)}</td>
          <td class="num">${x.dir === 'in' ? '+' : '−'}${fmtMoney(x.amount)}</td><td class="small">${esc(accName(x.account_id))}</td><td>${esc(x.counterparty)}</td><td class="small">${esc(x.purpose || x.in_kind || x.out_kind)}</td>
          <td class="small">${x.dir === 'out' ? (x.allocations?.length ? `${x.allocations.length} назнач. на ${fmtMoney(alloc)} ₽` : '<span class="muted">не распределён</span>') + (warn ? ' <span class="badge warn">не равно сумме</span>' : '') : ''}</td></tr>`;
      }).join('') : '<tr><td colspan="8" class="empty">Операций пока нет</td></tr>'}</tbody>
      ${rows.length ? `<tfoot><tr><td colspan="8">Поступило ${fmtMoney(inSum)} ₽ · списано ${fmtMoney(outSum)} ₽ · разница ${fmtMoney(inSum - outSum)} ₽</td></tr></tfoot>` : ''}
    </table></div>`;
  $$('[data-new]', body).forEach(b => { b.onclick = () => paymentModal(p, null, b.dataset.new); });
  $('#cash-docx').onclick = () => saveDocx(`Отчёт об использовании денежных средств ${p.debtor.name || ''}`, cashReportBlocks(p), { landscape: true });
  $('tbody', body).addEventListener('click', e => {
    const tr = e.target.closest('tr[data-pay]');
    if (tr) paymentModal(p, p.payments.find(x => x.id === tr.dataset.pay));
  });
}

function paymentModal(p, row, dir) {
  const isNew = !row;
  const d = row ? structuredClone(row) : { id: uid(), dir, date: todayISO(), amount: '', allocations: [] };
  d.allocations = d.allocations || [];
  const accOpts = p.accounts.map(a => [a.id, [a.bank, a.number].filter(Boolean).join(', ') || 'счёт без названия']);
  const defs = [
    { f: 'date', label: 'Дата', type: 'date' },
    { f: 'doc_no', label: '№ платёжного документа' },
    { f: 'amount', label: 'Сумма, ₽', type: 'money' },
    { f: 'account_id', label: d.dir === 'in' ? 'Счёт, куда поступили деньги' : 'Счёт списания', type: 'select', options: accOpts },
    { f: 'counterparty', label: d.dir === 'in' ? 'Плательщик' : 'Получатель', list: 'cp-names', wide: true },
    d.dir === 'in' ? { f: 'in_kind', label: 'Вид поступления', type: 'select', options: IN_KINDS } : { f: 'out_kind', label: 'Вид платежа', type: 'select', options: OUT_KINDS },
    d.dir === 'in' ? { f: 'asset_id', label: 'Оплата за имущество', type: 'select', options: p.assets.map(a => [a.id, a.name || a.kind || 'объект']) } : null,
    d.dir === 'in' ? { f: 'receivable_id', label: 'Взыскание дебиторки', type: 'select', options: p.receivables.map(r => [r.id, r.debtor_name || 'дебитор']) } : null,
    { f: 'purpose', label: 'Назначение платежа', wide: true },
    { f: 'note', label: 'Примечание', type: 'textarea', wide: true },
  ].filter(Boolean);
  const m = modal(`<h2>${isNew ? (d.dir === 'in' ? 'Новое поступление' : 'Новый платёж') : 'Изменить операцию'}</h2>
    <div class="form-grid" id="pay-form">${objFormHtml(defs, d, 'pf')}</div>
    ${d.dir === 'out' ? `<div class="form-group"><h3>Что погашено этим платежом</h3><div id="alloc"></div>
      <div class="actions" style="margin-top:8px">
        <select id="alloc-add" style="width:auto"><option value="">+ Добавить погашение…</option>
          <optgroup label="Текущие расходы">${p.costs.map(c => `<option value="cost:${c.id}">${esc(c.creditor || '—')}: ${esc(c.kind || '')}, долг ${fmtMoney(n(c.amount) - costPaid(p, c))} ₽</option>`).join('')}</optgroup>
          <optgroup label="Реестр требований">${activeClaims(p).map(c => `<option value="claim:${c.id}">${esc(c.creditor || '—')}: № ${esc(c.number || '—')}, остаток ${fmtMoney(claimRest(p, c))} ₽</option>`).join('')}</optgroup>
        </select>
        <select id="prorata" style="width:auto"><option value="">Распределить сумму пропорционально по очереди…</option>${RTK_SECTIONS.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select>
      </div></div>` : ''}
    <div class="foot"><div>${isNew ? '' : '<button class="danger" data-act="delete">Удалить</button>'}</div>
      <div class="actions"><button data-act="close">Отмена</button><button class="primary" data-act="save">Сохранить</button></div></div>`);
  bindObjForm($('#pay-form', m.el), defs, d, () => drawAlloc(), 'pf');
  const label = a => {
    const r = a.type === 'claim' ? p.claims.find(x => x.id === a.id) : p.costs.find(x => x.id === a.id);
    return r ? `${a.type === 'claim' ? 'РТК' : 'Текущие'}: ${r.creditor || '—'}${a.type === 'claim' ? ` (№ ${r.number || '—'}, ${r.queue})` : ` (${r.kind || ''})`}` : 'удалённая запись';
  };
  function drawAlloc() {
    const box = $('#alloc', m.el);
    if (!box) return;
    const total = sumBy(d.allocations, 'amount');
    box.innerHTML = d.allocations.length ? `<table class="compact"><tbody>${d.allocations.map((a, i) => `<tr><td>${esc(label(a))}</td>
      <td style="width:150px"><input inputmode="decimal" data-alloc="${i}" value="${fmtMoney(a.amount)}"></td><td style="width:40px"><button class="linklike" data-rm="${i}">✕</button></td></tr>`).join('')}</tbody></table>
      <div class="small ${Math.abs(total - n(d.amount)) > 0.009 ? 'warn-text' : 'muted'}">Распределено ${fmtMoney(total)} ₽ из ${fmtMoney(n(d.amount))} ₽</div>`
      : '<div class="small muted">Платёж пока не привязан к расходам или требованиям.</div>';
  }
  drawAlloc();
  m.el.addEventListener('change', e => {
    if (e.target.dataset.alloc != null) { d.allocations[Number(e.target.dataset.alloc)].amount = n(parseMoney(e.target.value)); drawAlloc(); }
    if (e.target.id === 'alloc-add' && e.target.value) {
      const [type, id] = e.target.value.split(':');
      const r = type === 'claim' ? p.claims.find(x => x.id === id) : p.costs.find(x => x.id === id);
      const left = Math.max(0, n(d.amount) - sumBy(d.allocations, 'amount'));
      const debt = type === 'claim' ? claimRest(p, r) : n(r.amount) - costPaid(p, r);
      d.allocations.push({ type, id, amount: Math.min(left || debt, debt) });
      e.target.value = '';
      drawAlloc();
    }
    if (e.target.id === 'prorata' && e.target.value) {
      const claims = rtkSummary(p).sections[e.target.value].rows;
      d.allocations = d.allocations.filter(a => !(a.type === 'claim' && claims.some(c => c.id === a.id)));
      const left = Math.max(0, n(d.amount) - sumBy(d.allocations, 'amount'));
      d.allocations.push(...prorata(p, claims, left));
      e.target.value = '';
      drawAlloc();
    }
  });
  m.el.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { d.allocations.splice(Number(rm.dataset.rm), 1); drawAlloc(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'save') {
      if (isNew) p.payments.push(d); else Object.assign(row, d);
      touch(p); m.close(); route();
    }
    if (act === 'delete') {
      const btn = e.target.closest('[data-act]');
      if (!btn.dataset.confirm) { btn.dataset.confirm = '1'; btn.textContent = 'Точно удалить?'; btn.classList.add('solid'); return; }
      p.payments = p.payments.filter(x => x !== row);
      touch(p); m.close(); route();
    }
  });
}

function renderQueues(body, p) {
  const cur = currentSummary(p);
  const s = rtkSummary(p);
  body.innerHTML = `<div class="grid two">
    <section class="panel"><h2>Текущие платежи (п. 2 ст. 134)</h2><table>
      <thead><tr><th>Очередь</th><th class="num">Начислено</th><th class="num">Оплачено</th><th class="num">Долг</th></tr></thead>
      <tbody>${cur.map(r => `<tr><td>${esc(r.q)}${r.count ? ` <span class="small muted">(${r.count})</span>` : ''}</td><td class="num">${fmtMoney(r.accrued)}</td><td class="num">${fmtMoney(r.paid)}</td><td class="num">${fmtMoney(r.debt)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Итого</td><td class="num">${fmtMoney(sumBy(cur, 'accrued'))}</td><td class="num">${fmtMoney(sumBy(cur, 'paid'))}</td><td class="num">${fmtMoney(sumBy(cur, 'debt'))}</td></tr></tfoot></table></section>
    <section class="panel"><h2>Реестр требований</h2><table>
      <thead><tr><th>Очередь</th><th class="num">Включено</th><th class="num">Погашено</th><th class="num">%</th></tr></thead>
      <tbody>${RTK_SECTIONS.map(([k, t]) => `<tr><td>${esc(t)}</td><td class="num">${fmtMoney(s.sections[k].amount)}</td><td class="num">${fmtMoney(s.sections[k].paid)}</td><td class="num">${fmtPct(pct(s.sections[k].paid, s.sections[k].amount))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Итого по реестру</td><td class="num">${fmtMoney(s.total.amount)}</td><td class="num">${fmtMoney(s.total.paid)}</td><td class="num">${fmtPct(pct(s.total.paid, s.total.amount))}</td></tr></tfoot></table></section>
    <section class="panel"><h2>Счета</h2><table>
      <thead><tr><th>Счёт</th><th class="num">Остаток</th></tr></thead>
      <tbody>${p.accounts.length ? p.accounts.map(a => `<tr><td>${esc([a.bank, a.number].filter(Boolean).join(', ') || 'счёт')}${a.closed ? ' <span class="badge gray">закрыт</span>' : ''}</td><td class="num">${fmtMoney(accountBalance(p, a))}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">Счетов нет</td></tr>'}</tbody>
      <tfoot><tr><td>Итого</td><td class="num">${fmtMoney(sumBy(p.accounts, a => accountBalance(p, a)))}</td></tr></tfoot></table></section>
  </div>`;
}

// ---------- Имущество ----------

function renderAssets(body, p) {
  body.innerHTML = `<div class="panel" style="margin-bottom:12px"><div class="form-grid" id="inv-form"></div></div><div id="assets-list"></div>`;
  const defs = [
    { f: 'inventory_no', label: '№ описи (инвентаризационной описи)' },
    { f: 'inventory_date', label: 'Дата описи', type: 'date' },
    { label: 'Итого', computed: () => `балансовая ${fmtMoney(sumBy(p.assets, 'book_value'))} ₽ · рыночная ${fmtMoney(sumBy(p.assets, 'market_value'))} ₽` },
  ];
  $('#inv-form', body).innerHTML = objFormHtml(defs, p);
  bindObjForm($('#inv-form', body), defs, p, () => touch(p));
  renderSubtable($('#assets-list', body), p, 'assets', { extraActions: '<button data-inv>Скачать опись (.docx)</button>' });
  $('[data-inv]', body).onclick = () => saveDocx(`Опись имущества ${p.debtor.name || ''}`, inventoryBlocks(p), { landscape: true });
}

// ---------- Люди ----------

function claimCreditors(p) {
  return [...new Set(activeClaims(p).map(c => (c.creditor || '').trim()).filter(Boolean))];
}

function findCounterparty(p, name) {
  const k = String(name || '').trim().toLowerCase();
  return p.counterparties.find(c => (c.name || '').trim().toLowerCase() === k);
}

function renderCounterparties(body, p) {
  const missing = claimCreditors(p).filter(name => !findCounterparty(p, name));
  renderSubtable(body, p, 'counterparties', { extraActions: missing.length ? `<button data-from-rtk>Добавить кредиторов из РТК (${missing.length})</button>` : '' });
  const btn = $('[data-from-rtk]', body);
  if (btn) btn.onclick = () => {
    for (const name of missing) p.counterparties.push({ id: uid(), name, role: 'Кредитор', kind: /ООО|АО|ПАО|банк|ФНС|ИФНС|общество|компания/i.test(name) ? 'Юрлицо' : '' });
    touch(p);
    route();
    toast(`Добавлено кредиторов: ${missing.length}. Заполните их почтовые адреса — они попадут в уведомления.`);
  };
}

function renderWorkers(body, p) {
  renderSubtable(body, p, 'workers', { extraActions: '<button data-paste>Вставить список из Excel</button>' });
  $('[data-paste]', body).onclick = () => {
    const m = modal(`<h2>Вставить работников из Excel</h2>
      <p class="small muted">Скопируйте в Excel строки с колонками: ФИО, должность, дата приказа об увольнении (ДД.ММ.ГГГГ), долг до принятия заявления, долг после — и вставьте сюда.</p>
      <textarea id="w-paste" style="min-height:220px"></textarea>
      <div class="foot"><span class="small muted" id="w-count"></span><div class="actions"><button data-act="close">Отмена</button><button class="primary" id="w-ok">Добавить</button></div></div>`);
    $('#w-ok', m.el).onclick = () => {
      const rows = $('#w-paste', m.el).value.split(/\r?\n/).map(l => l.split('\t')).filter(r => (r[0] || '').trim());
      for (const r of rows) {
        const dm = String(r[2] || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        p.workers.push({ id: uid(), name: r[0].trim(), position: (r[1] || '').trim(), dismissal_date: dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : '', debt_before: parseMoney(r[3]), debt_after: parseMoney(r[4]) });
      }
      touch(p); m.close(); route();
      toast(`Добавлено работников: ${rows.length}`);
    };
  };
}

// ---------- Документы ----------

const DOC_FILTER = { status: '', q: '' };

function nextDocNumber(p) {
  p.doc_seq = (Number(p.doc_seq) || 0) + 1;
  return `${p.doc_prefix || ''}${p.doc_seq}`;
}

function renderDocs(body, p) {
  const q = DOC_FILTER.q.trim().toLowerCase();
  const rows = [...p.documents]
    .filter(d => (!DOC_FILTER.status || d.status === DOC_FILTER.status) && (!q || [d.title, d.addressee, d.number].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number), 'ru', { numeric: true }));
  const waiting = p.documents.filter(d => d.status === 'Отправлен' && d.sent_date && daysUntil(d.sent_date) < -10);
  body.innerHTML = `
    <div class="actions" style="margin-bottom:12px">
      <button class="primary" id="doc-new">+ Создать документы</button>
      <button id="doc-post">Почтовый реестр (.docx)</button>
      <select id="doc-status" style="width:auto"><option value="">Все статусы</option>${DOC_STATUSES.map(s => `<option ${DOC_FILTER.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input type="search" id="doc-q" placeholder="Поиск" value="${esc(DOC_FILTER.q)}" style="width:220px">
      ${waiting.length ? `<span class="badge warn" title="Отправлены больше 10 дней назад, ответ не отмечен">без ответа больше 10 дней: ${waiting.length}</span>` : ''}
    </div>
    ${!DATA.settings.au_profile?.full_name ? '<div class="banner">Заполните свои реквизиты в <a href="#/settings">Настройках</a> — они подставляются во все документы.</div>' : ''}
    <div class="panel table-wrap" style="padding:0"><table>
      <thead><tr><th>№</th><th>Дата</th><th>Документ</th><th>Адресат</th><th>Статус</th><th>Отправлен</th><th>Ответ</th></tr></thead>
      <tbody>${rows.length ? rows.map(d => `<tr class="click" data-doc="${d.id}"><td class="nowrap">${esc(d.number)}</td><td class="nowrap">${fmtDate(d.date)}</td><td>${esc(d.title)}</td><td class="small">${esc(d.addressee)}</td>
        <td>${docStatusBadge(d)}</td><td class="nowrap small">${fmtDate(d.sent_date)}${d.track ? `<div class="muted">${esc(d.track)}</div>` : ''}</td><td class="small">${d.answer_date ? fmtDate(d.answer_date) : ''}${d.answer_summary ? `<div class="muted">${esc(d.answer_summary.slice(0, 80))}${d.answer_summary.length > 80 ? '…' : ''}</div>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty">Документов пока нет. Нажмите «Создать документы» и отметьте адресатов — черновики заполнятся из карточки.</td></tr>'}</tbody>
    </table></div>`;
  $('#doc-new').onclick = () => createDocsModal(p);
  $('#doc-post').onclick = () => postalModal(p);
  $('#doc-status').onchange = e => { DOC_FILTER.status = e.target.value; renderDocs(body, p); };
  $('#doc-q').oninput = e => { DOC_FILTER.q = e.target.value; clearTimeout(renderDocs.t); renderDocs.t = setTimeout(() => { renderDocs(body, p); $('#doc-q').focus(); $('#doc-q').setSelectionRange(99, 99); }, 300); };
  $('tbody', body).addEventListener('click', e => {
    const tr = e.target.closest('tr[data-doc]');
    if (tr) docModal(p, p.documents.find(d => d.id === tr.dataset.doc));
  });
}

function docStatusBadge(d) {
  const cls = { 'Черновик': 'gray', 'Готов': '', 'Отправлен': 'warn', 'Ответ получен': 'ok', 'Не требует ответа': 'gray' }[d.status] ?? 'gray';
  return `<span class="badge ${cls}">${esc(d.status || 'Черновик')}</span>`;
}

function createDocsModal(p) {
  const T = allTemplates();
  const group = g => Object.entries(T).filter(([, t]) => t.group === g && !t.per);
  const creditors = [...new Set([...claimCreditors(p), ...p.counterparties.filter(c => ['Кредитор', 'Уполномоченный орган'].includes(c.role)).map(c => c.name)])].filter(Boolean);
  const banks = [...new Set([...p.accounts.map(a => a.bank), ...p.counterparties.filter(c => c.role === 'Банк').map(c => c.name)].filter(Boolean))];
  const box = (val, label, checked = false) => `<label class="field check"><input type="checkbox" data-tpl="${esc(val)}" ${checked ? 'checked' : ''}> ${esc(label)}</label>`;
  const m = modal(`<h2>Создать документы</h2>
    <p class="small muted">Отметьте адресатов: по каждому создастся черновик с данными процедуры. Его можно поправить и скачать в Word.</p>
    <div class="actions" style="margin-bottom:8px"><button data-all="requests">Все запросы в госорганы</button><button data-none>Снять все</button></div>
    <div class="tpl-groups">
      <section><h3>Запросы и уведомления</h3>${group('requests').map(([k, t]) => box(k, t.title)).join('')}
        ${creditors.length ? `<h4>Кредиторы</h4>${creditors.map(c => box('creditor|' + c, c)).join('')}` : '<p class="small muted">Уведомления кредиторам появятся, когда в РТК или контрагентах будут кредиторы.</p>'}</section>
      <section><h3>Банки и биржи</h3>${banks.map(b => box('bank|' + b, b)).join('')}${box('bank|', 'Банк (без названия)')}${group('banks').map(([k, t]) => box(k, t.title)).join('')}
        <h3 style="margin-top:14px">В арбитражный суд</h3>${group('court').map(([k, t]) => box(k, t.title)).join('')}
        <h3 style="margin-top:14px">Прочее</h3>${[...group('other'), ...group('own')].map(([k, t]) => box(k, t.title + (t.group === 'own' ? ' (свой шаблон)' : ''))).join('')}</section>
    </div>
    ${p.spouses.length && p.debtor_type !== 'ent' ? `<label class="field check" style="margin-top:10px"><input type="checkbox" id="with-spouse" checked> Запросить также сведения о супруге (${esc(p.spouses[0].name || 'без имени')}) — п. 7 ст. 213.9</label>` : ''}
    <div class="foot"><span class="small muted" id="tpl-count">Выбрано: 0</span><div class="actions"><button data-act="close">Отмена</button><button class="primary" id="tpl-create">Создать черновики</button></div></div>`);
  const count = () => { $('#tpl-count', m.el).textContent = `Выбрано: ${$$('[data-tpl]:checked', m.el).length}`; };
  m.el.addEventListener('change', count);
  m.el.addEventListener('click', e => {
    const all = e.target.closest('[data-all]');
    if (all) { $$('[data-tpl]', m.el).forEach(x => { if (T[x.dataset.tpl]?.addresseeKey) x.checked = true; }); count(); }
    if (e.target.closest('[data-none]')) { $$('[data-tpl]', m.el).forEach(x => { x.checked = false; }); count(); }
  });
  $('#tpl-create', m.el).onclick = () => {
    const spouse = $('#with-spouse', m.el)?.checked ? p.spouses[0] : null;
    let made = 0;
    for (const el of $$('[data-tpl]:checked', m.el)) {
      const [key, who] = el.dataset.tpl.split('|');
      let extra = {};
      if (key === 'creditor') {
        const cp = findCounterparty(p, who);
        extra = { addressee: who, address: cp?.address || '', titleSuffix: ': ' + who };
      } else if (key === 'bank') {
        const cp = findCounterparty(p, who);
        extra = { addressee: who || '[наименование банка]', address: cp?.address || '', titleSuffix: who ? ': ' + who : '' };
      } else if (T[key].spouseAware && spouse) extra = { spouse };
      const doc = draftFromTemplate(p, key, extra);
      doc.number = nextDocNumber(p);
      p.documents.push(doc);
      made++;
    }
    if (!made) return;
    touch(p); m.close(); route();
    toast(`Создано черновиков: ${made}`);
  };
}

function docModal(p, d) {
  const defs = [
    { f: 'number', label: 'Исх. №' },
    { f: 'date', label: 'Дата', type: 'date' },
    { f: 'status', label: 'Статус', type: 'select', options: DOC_STATUSES },
    { f: 'title', label: 'Название в списке', wide: true },
    { f: 'heading', label: 'Заголовок в документе' },
    { f: 'subheading', label: 'Подзаголовок', wide: true },
    { f: 'addressee', label: 'Адресат', wide: true },
    { f: 'address', label: 'Адрес адресата', wide: true },
    { f: 'text', label: 'Текст (абзацы разделяются пустой строкой)', type: 'textarea', wide: true, big: true },
    { f: 'attachments', label: 'Приложения (по одному в строке)', type: 'textarea', wide: true },
    { heading: 'Отправка и ответ' },
    { f: 'send_method', label: 'Способ отправки', type: 'select', options: SEND_METHODS },
    { f: 'sent_date', label: 'Дата отправки', type: 'date' },
    { f: 'track', label: 'Почтовый идентификатор (трек)' },
    { f: 'answer_date', label: 'Дата ответа', type: 'date' },
    { f: 'in_report', label: 'Показывать в отчёте АУ', type: 'bool' },
    { f: 'answer_summary', label: 'Содержание ответа (для отчёта и финанализа)', type: 'textarea', wide: true },
  ];
  const draft = structuredClone(d);
  const m = modal(`<h2>${esc(d.title || 'Документ')}</h2>
    <div class="form-grid" id="doc-form">${objFormHtml(defs, draft, 'df')}</div>
    <div class="foot"><div class="actions"><button class="danger" data-act="delete">Удалить</button><button data-act="rebuild" title="Заново собрать текст из шаблона и текущих данных карточки">Пересобрать текст</button></div>
      <div class="actions"><button data-act="docx">Скачать .docx</button><button data-act="close">Отмена</button><button class="primary" data-act="save">Сохранить</button></div></div>`);
  m.el.querySelector('.modal').classList.add('wide-modal');
  $$('textarea', m.el).forEach(t => { if (t.closest('label')?.textContent.startsWith('Текст')) t.style.minHeight = '320px'; });
  bindObjForm($('#doc-form', m.el), defs, draft, (def, v) => {
    if (def.f === 'sent_date' && v && draft.status !== 'Ответ получен') draft.status = 'Отправлен';
    if (def.f === 'answer_date' && v) draft.status = 'Ответ получен';
    const st = $('[data-df="2"]', m.el);
    if (st) st.value = draft.status;
  }, 'df');
  m.el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'save') { Object.assign(d, draft); touch(p); m.close(); route(); }
    if (act === 'docx') { Object.assign(d, draft); touch(p); saveDocx(`${d.number ? d.number + ' ' : ''}${d.title || 'документ'}`, documentBlocks(p, d)); }
    if (act === 'rebuild') {
      const t = allTemplates()[d.template];
      if (!t) { toast('Шаблон этого документа больше не существует'); return; }
      const fresh = draftFromTemplate(p, d.template, { addressee: draft.addressee, address: draft.address, spouse: p.spouses.find(s => s.id === d.spouse_id) });
      draft.text = d.template === 'meeting_notice' ? draft.text : fresh.text;
      draft.attachments = fresh.attachments || draft.attachments;
      $('#doc-form', m.el).innerHTML = objFormHtml(defs, draft, 'df');
      toast('Текст собран заново из карточки. Сохраните, если всё верно.');
    }
    if (act === 'delete') {
      const btn = e.target.closest('[data-act]');
      if (!btn.dataset.confirm) { btn.dataset.confirm = '1'; btn.textContent = 'Точно удалить?'; btn.classList.add('solid'); return; }
      p.documents = p.documents.filter(x => x !== d);
      touch(p); m.close(); route();
    }
  });
}

function postalModal(p) {
  const docs = [...p.documents].sort((a, b) => String(a.number).localeCompare(String(b.number), 'ru', { numeric: true }));
  const m = modal(`<h2>Почтовый реестр</h2>
    <p class="small muted">Отметьте документы, которые отправляете одним списком. В реестр попадут адресат, адрес, исходящий номер и трек.</p>
    <div class="assign-list">${docs.map(d => `<label class="field check"><input type="checkbox" data-pd="${d.id}" ${!d.sent_date && d.status !== 'Черновик' ? 'checked' : ''}> <span>${esc(d.number)} · ${esc(d.title)} <span class="small muted">${esc(d.addressee)}</span></span></label>`).join('') || '<div class="empty">Документов нет</div>'}</div>
    <label class="field check"><input type="checkbox" id="pd-mark" checked> Отметить выбранные как отправленные сегодня</label>
    <div class="foot"><span></span><div class="actions"><button data-act="close">Отмена</button><button class="primary" id="pd-ok">Скачать реестр</button></div></div>`);
  $('#pd-ok', m.el).onclick = () => {
    const chosen = $$('[data-pd]:checked', m.el).map(x => p.documents.find(d => d.id === x.dataset.pd));
    if (!chosen.length) return;
    if ($('#pd-mark', m.el).checked) {
      for (const d of chosen) { d.sent_date = d.sent_date || todayISO(); if (d.status === 'Черновик' || d.status === 'Готов') d.status = 'Отправлен'; d.send_method = d.send_method || 'Почта России, заказное'; }
      touch(p);
    }
    saveDocx(`Почтовый реестр ${todayISO()}`, postalRegistryBlocks(p, chosen), { landscape: true });
    m.close();
    route();
  };
}

// ---------- Собрания ----------

const MEETING_STEPS = [['params', 'Параметры'], ['agenda', 'Повестка'], ['people', 'Участники и регистрация'], ['vote', 'Голосование'], ['docs', 'Документы']];

const QUESTION_PRESETS = [
  { title: 'Отчёт управляющего', wording: 'Об отчёте арбитражного управляющего о своей деятельности и о результатах проведения процедуры', decision: 'Принять к сведению отчёт арбитражного управляющего.' },
  { title: 'Положение о продаже имущества', wording: 'Об утверждении Положения о порядке, сроках и условиях продажи имущества должника', decision: 'Утвердить Положение о порядке, сроках и условиях продажи имущества должника в редакции, предложенной арбитражным управляющим.' },
  { title: 'Комитет кредиторов', wording: 'Об образовании комитета кредиторов', decision: 'Комитет кредиторов не образовывать.', majority: 'total' },
  { title: 'Периодичность собраний', wording: 'Об определении периодичности проведения собраний кредиторов', decision: 'Проводить собрания кредиторов не реже одного раза в три месяца.' },
  { title: 'Место проведения собраний', wording: 'Об определении места проведения последующих собраний кредиторов', decision: 'Проводить последующие собрания кредиторов по адресу: [адрес].' },
  { title: 'Реализация имущества гражданина', wording: 'Об обращении в арбитражный суд с ходатайством о признании гражданина банкротом и введении процедуры реализации имущества', decision: 'Обратиться в арбитражный суд с ходатайством о признании гражданина банкротом и введении процедуры реализации имущества гражданина.' },
  { title: 'Конкурсное производство', wording: 'Об обращении в арбитражный суд с ходатайством о признании должника банкротом и об открытии конкурсного производства', decision: 'Обратиться в арбитражный суд с ходатайством о признании должника банкротом и об открытии конкурсного производства.', majority: 'total' },
  { title: 'Выбор СРО / кандидатуры АУ', wording: 'О выборе арбитражного управляющего или саморегулируемой организации, из членов которой арбитражным судом утверждается арбитражный управляющий', decision: '', majority: 'total', variants: '[СРО или АУ № 1]\n[СРО или АУ № 2]' },
];

function renderMeetings(body, p, mid, step) {
  const m = mid && p.meetings.find(x => x.id === mid);
  if (m) return renderMeeting(body, p, m, step || 'params');
  const rows = [...p.meetings].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  body.innerHTML = `
    <div class="actions" style="margin-bottom:12px"><button class="primary" data-mk="creditors">+ Собрание кредиторов</button><button data-mk="workers">+ Собрание работников</button></div>
    <div class="panel table-wrap" style="padding:0"><table>
      <thead><tr><th>Дата</th><th>Собрание</th><th>Форма</th><th>Вопросов</th><th>Участников</th><th>Кворум</th><th>Статус</th></tr></thead>
      <tbody>${rows.length ? rows.map(x => {
        const t = meetingTotals(p, x);
        return `<tr class="click" data-meeting="${x.id}"><td class="nowrap">${x.status === 'Запланировано' ? dueBadge(x.date) : fmtDate(x.date)}</td><td>${x.kind === 'workers' ? 'работников' : 'кредиторов'}${x.first ? ' <span class="badge gray">первое</span>' : ''}</td><td>${esc(x.form)}</td>
          <td>${(x.questions || []).length}</td><td>${(x.participants || []).length}</td><td>${(x.participants || []).some(y => y.present) ? (t.quorum ? '<span class="badge ok">есть</span>' : '<span class="badge bad">нет</span>') : ''}</td><td>${esc(x.status)}</td></tr>`;
      }).join('') : '<tr><td colspan="7" class="empty">Собраний пока нет</td></tr>'}</tbody></table></div>`;
  $$('[data-mk]', body).forEach(b => {
    b.onclick = () => {
      const x = { id: uid(), kind: b.dataset.mk, form: 'Очная', status: 'Запланировано', first: !p.meetings.some(y => y.kind === b.dataset.mk), secured_vote: securedVotesDefault(p), date: '', time: '', questions: [], participants: [], chair: DATA.settings.au_profile?.full_name || '' };
      p.meetings.push(x);
      touch(p);
      location.hash = `#/p/${p.id}/meetings/${x.id}/params`;
    };
  });
  $('tbody', body).addEventListener('click', e => {
    const tr = e.target.closest('tr[data-meeting]');
    if (tr) location.hash = `#/p/${p.id}/meetings/${tr.dataset.meeting}/params`;
  });
}

function renderMeeting(body, p, m, step) {
  const t = meetingTotals(p, m);
  body.innerHTML = `
    <div class="small" style="margin-bottom:6px"><a href="#/p/${p.id}/meetings">← Все собрания</a></div>
    <h2>Собрание ${m.kind === 'workers' ? 'работников' : 'кредиторов'} ${m.date ? 'от ' + fmtDate(m.date) : '(дата не назначена)'} <span class="badge gray">${esc(m.status)}</span>
      ${(m.participants || []).some(x => x.present) ? (t.quorum ? '<span class="badge ok">кворум есть</span>' : '<span class="badge bad">кворума нет</span>') : ''}</h2>
    <nav class="subtabs">${MEETING_STEPS.map(([k, l], i) => `<a href="#/p/${p.id}/meetings/${m.id}/${k}" class="${k === step ? 'active' : ''}">${i + 1}. ${l}</a>`).join('')}</nav>
    <div id="m-body"></div>`;
  const b = $('#m-body', body);
  const save = () => touch(p);
  if (step === 'agenda') return meetingAgenda(b, p, m, save);
  if (step === 'people') return meetingPeople(b, p, m, save);
  if (step === 'vote') return meetingVote(b, p, m, save);
  if (step === 'docs') return meetingDocs(b, p, m, save);
  const defs = [
    { f: 'status', label: 'Статус', type: 'select', options: MEETING_STATUSES },
    { f: 'first', label: 'Первое собрание', type: 'bool' },
    { f: 'form', label: 'Форма', type: 'select', options: ['Очная', 'Заочная (бюллетени)'] },
    { f: 'date', label: 'Дата', type: 'date' },
    { f: 'time', label: 'Время начала' },
    { f: 'reg_time', label: 'Время регистрации (например, с 10:30 до 11:00)' },
    { f: 'place', label: 'Адрес проведения', wide: true },
    { f: 'ballots_address', label: 'Адрес для направления бюллетеней (заочная форма)', wide: true },
    { f: 'ballots_deadline', label: 'Бюллетени принимаются до', type: 'date' },
    { f: 'materials_from', label: 'Ознакомление с материалами с', type: 'date' },
    { f: 'materials_time', label: 'Время ознакомления (рабочие дни)' },
    { f: 'materials_place', label: 'Адрес ознакомления с материалами', wide: true },
    { f: 'basis', label: 'Основание созыва', wide: true },
    { f: 'chair', label: 'Председатель' },
    { f: 'secretary', label: 'Секретарь' },
    { f: 'secured_vote', label: 'Залоговые кредиторы голосуют', type: 'bool' },
    { heading: 'Публикации в ЕФРСБ' },
    { f: 'efrsb_notice_no', label: '№ сообщения о проведении' },
    { f: 'efrsb_notice_date', label: 'Дата сообщения', type: 'date' },
    { f: 'efrsb_result_no', label: '№ сообщения о результатах' },
    { f: 'efrsb_result_date', label: 'Дата сообщения', type: 'date' },
    { f: 'note', label: 'Примечание', type: 'textarea', wide: true },
  ];
  b.innerHTML = `<div class="panel"><div class="form-grid" id="mp-form">${objFormHtml(defs, m, 'mp')}</div>
    <p class="small muted" style="margin:12px 0 0">Уведомить участников нужно не позднее чем за 14 дней до собрания (п. 1 ст. 13 Закона о банкротстве; для граждан — с учётом ст. 213.8). ${m.date ? `Крайний срок для уведомлений: <b>${fmtDate(addDays(m.date, -14))}</b>.` : ''}</p>
    <div class="actions" style="margin-top:14px"><button class="danger" id="m-del">Удалить собрание</button><button id="m-dup">Назначить повторное</button></div></div>`;
  bindObjForm($('#mp-form', b), defs, m, () => { save(); }, 'mp');
  $('#m-del', b).onclick = () => confirmModal('Удалить собрание со всеми участниками и голосами?', 'Удалить', () => { p.meetings = p.meetings.filter(x => x !== m); save(); location.hash = `#/p/${p.id}/meetings`; });
  $('#m-dup', b).onclick = () => {
    const x = { ...structuredClone(m), id: uid(), status: 'Запланировано', date: '', first: false, basis: `Повторное собрание (собрание ${fmtDate(m.date)} не состоялось)`, efrsb_notice_no: '', efrsb_notice_date: '', efrsb_result_no: '', efrsb_result_date: '' };
    x.participants = x.participants.map(y => ({ ...y, present: false, votes: {} }));
    p.meetings.push(x);
    save();
    location.hash = `#/p/${p.id}/meetings/${x.id}/params`;
  };
}

function meetingAgenda(b, p, m, save) {
  const qDefs = [
    { f: 'title', label: 'Краткое название' },
    { f: 'majority', label: 'Как принимается решение', type: 'select', options: [['present', 'большинством от присутствующих (п. 1 ст. 15)'], ['total', 'большинством от общего числа голосов (п. 2 ст. 15)']] },
    { f: 'wording', label: 'Формулировка вопроса', type: 'textarea', wide: true },
    { f: 'decision', label: 'Решение, поставленное на голосование (для «за / против / воздержался»)', type: 'textarea', wide: true },
    { f: 'variants', label: 'Варианты решения — по одному в строке (пусто: за / против / воздержался)', type: 'textarea', wide: true },
    { f: 'speech', label: 'Слушали (для протокола)', type: 'textarea', wide: true },
  ];
  b.innerHTML = `${(m.questions || []).map((q, i) => `
    <div class="panel q-card" data-q="${i}" style="margin-bottom:10px"><div class="q-head"><b>Вопрос ${i + 1}</b>
      <div class="actions"><button class="linklike" data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button class="linklike" data-down="${i}" ${i < m.questions.length - 1 ? '' : 'disabled'}>↓</button><button class="linklike danger" data-rmq="${i}">удалить</button></div></div>
      <div class="form-grid">${objFormHtml(qDefs, q, 'q' + i)}</div></div>`).join('') || '<div class="panel empty">Вопросов пока нет</div>'}
    <div class="actions" style="margin-top:10px"><button class="primary" id="q-add">+ Вопрос</button>
      <select id="q-preset" style="width:auto"><option value="">+ Типовой вопрос…</option>${QUESTION_PRESETS.map((x, i) => `<option value="${i}">${esc(x.title)}</option>`).join('')}</select></div>`;
  (m.questions || []).forEach((q, i) => bindObjForm($(`[data-q="${i}"]`, b), qDefs, q, save, 'q' + i));
  const redraw = () => { save(); meetingAgenda(b, p, m, save); };
  $('#q-add', b).onclick = () => { m.questions.push({ id: uid(), majority: 'present' }); redraw(); };
  $('#q-preset', b).onchange = e => { if (e.target.value === '') return; m.questions.push({ id: uid(), majority: 'present', ...QUESTION_PRESETS[Number(e.target.value)] }); redraw(); };
  // onclick, а не addEventListener: блок перерисовывается целиком, обработчик не должен копиться.
  b.onclick = e => {
    const t = e.target.closest('button');
    if (!t) return;
    const move = (i, j) => { const [x] = m.questions.splice(i, 1); m.questions.splice(j, 0, x); redraw(); };
    if (t.dataset.up) move(Number(t.dataset.up), Number(t.dataset.up) - 1);
    if (t.dataset.down) move(Number(t.dataset.down), Number(t.dataset.down) + 1);
    if (t.dataset.rmq) { m.questions.splice(Number(t.dataset.rmq), 1); redraw(); }
  };
}

function meetingPeople(b, p, m, save) {
  const workers = m.kind === 'workers';
  const draw = () => {
    const t = meetingTotals(p, m);
    b.innerHTML = `
      <div class="actions" style="margin-bottom:10px">
        <button class="primary" id="mp-fill">${workers ? 'Заполнить из списка работников' : 'Заполнить из РТК'}</button>
        <button id="mp-add">+ Участник вручную</button>
        <span class="small muted">${workers ? 'У каждого работника один голос.' : `Голоса — по непогашенным голосующим требованиям${m.secured_vote ? ', включая залоговые' : ', без залоговых'}.`}</span>
      </div>
      <div class="panel table-wrap" style="padding:0"><table class="compact">
        <thead><tr><th>Участник</th><th class="num">${workers ? 'Голосов' : 'Требования, ₽'}</th><th class="num">% голосов</th><th>Присутствует</th><th>Представитель</th><th>Доверенность</th><th></th></tr></thead>
        <tbody>${(m.participants || []).map((x, i) => `<tr>
          <td><input data-pp="${i}" data-k="name" value="${esc(x.name)}"></td>
          <td style="width:150px"><input data-pp="${i}" data-k="amount" inputmode="decimal" value="${workers ? esc(x.amount) : fmtMoney(x.amount)}"></td>
          <td class="num">${fmtPct(pct(n(x.amount), t.total))}</td>
          <td style="text-align:center"><input type="checkbox" data-pp="${i}" data-k="present" ${x.present ? 'checked' : ''}></td>
          <td><input data-pp="${i}" data-k="rep" value="${esc(x.rep)}" placeholder="ФИО"></td>
          <td><input data-pp="${i}" data-k="poa" value="${esc(x.poa)}" placeholder="№, дата"></td>
          <td><button class="linklike danger" data-rmp="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Участников нет</td></tr>'}</tbody>
        <tfoot><tr><td>Всего</td><td class="num">${workers ? t.total : fmtMoney(t.total)}</td><td class="num">100 %</td><td colspan="4">Зарегистрировано ${fmtPct(t.presentPct)} голосов — ${t.quorum ? '<span class="badge ok">кворум есть</span>' : '<span class="badge bad">кворума нет</span>'} (нужно больше 50 %, п. 4 ст. 12)</td></tr></tfoot>
      </table></div>`;
    $('#mp-fill', b).onclick = () => {
      const fill = () => {
        if (workers) m.participants = p.workers.map(w => ({ id: uid(), name: w.name, amount: 1, present: false, votes: {} }));
        else {
          const by = new Map();
          for (const c of p.claims) {
            if (!isVotingClaim(c, m.secured_vote)) continue;
            const rest = claimRest(p, c);
            if (rest > 0) by.set((c.creditor || '').trim(), (by.get((c.creditor || '').trim()) || 0) + rest);
          }
          m.participants = [...by].map(([name, amount]) => ({ id: uid(), name, amount: Math.round(amount * 100) / 100, present: false, votes: {} }));
        }
        save();
        draw();
      };
      if ((m.participants || []).length) confirmModal('Заменить текущий список участников (отметки о регистрации и голоса будут сброшены)?', 'Заменить', fill);
      else fill();
    };
    $('#mp-add', b).onclick = () => { m.participants.push({ id: uid(), name: '', amount: workers ? 1 : 0, present: true, votes: {} }); save(); draw(); };
  };
  draw();
  b.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.pp == null) return;
    const x = m.participants[Number(el.dataset.pp)];
    const k = el.dataset.k;
    x[k] = k === 'present' ? el.checked : k === 'amount' ? n(parseMoney(el.value)) : el.value.trim();
    save();
    draw();
  });
  b.addEventListener('click', e => {
    const r = e.target.closest('[data-rmp]');
    if (r) { m.participants.splice(Number(r.dataset.rmp), 1); save(); draw(); }
  });
}

function meetingVote(b, p, m, save) {
  const draw = () => {
    const t = meetingTotals(p, m);
    const present = (m.participants || []).filter(x => x.present);
    if (!(m.questions || []).length) { b.innerHTML = '<div class="panel empty">Сначала добавьте вопросы в повестку.</div>'; return; }
    if (!present.length) { b.innerHTML = '<div class="panel empty">Отметьте присутствующих на шаге «Участники и регистрация».</div>'; return; }
    b.innerHTML = `${!t.quorum ? '<div class="banner">Кворума нет: собрание неправомочно, решения не принимаются. Его можно назначить повторно на вкладке «Параметры».</div>' : ''}
      ${m.questions.map((q, qi) => {
        const r = questionResult(p, m, q);
        return `<section class="panel" style="margin-bottom:12px"><h3 style="margin:0 0 8px">${qi + 1}. ${esc(q.wording || q.title || 'Вопрос')}</h3>
          <table class="compact"><tbody>${present.map(x => `<tr><td>${esc(x.name)}</td><td class="num small">${fmtPct(pct(n(x.amount), t.total))}</td>
            <td style="width:220px"><select data-vote="${qi}" data-pid="${x.id}"><option value="">не голосовал</option>${r.opts.map(o => `<option ${(x.votes || {})[q.id] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>
          <div class="small" style="margin-top:8px">${r.opts.map(o => `${esc(o)}: ${fmtPct(pct(r.tally[o], t.present))} от присутствующих`).join(' · ')}</div>
          <div style="margin-top:6px"><b>${esc(r.text)}</b></div></section>`;
      }).join('')}`;
  };
  draw();
  b.addEventListener('change', e => {
    const el = e.target.closest('[data-vote]');
    if (!el) return;
    const q = m.questions[Number(el.dataset.vote)];
    const x = m.participants.find(y => y.id === el.dataset.pid);
    x.votes = x.votes || {};
    if (el.value) x.votes[q.id] = el.value; else delete x.votes[q.id];
    save();
    draw();
  });
}

function meetingDocs(b, p, m, save) {
  const name = `собрание ${m.kind === 'workers' ? 'работников' : 'кредиторов'} ${m.date ? fmtDate(m.date) : ''}`;
  b.innerHTML = `<div class="grid two">
    <section class="panel"><h2>До собрания</h2><div class="stack">
      <button data-md="notices">Создать уведомления участникам (в «Документы»)</button>
      <button data-md="efrsb">Текст сообщения в ЕФРСБ о проведении (.docx)</button>
      <button data-md="ballots">Бюллетени (.docx)</button>
      <button data-md="register">Журнал регистрации (.docx)</button></div>
      <p class="small muted">Уведомления получат адреса из раздела «Люди → Контрагенты».</p></section>
    <section class="panel"><h2>После собрания</h2><div class="stack">
      <button data-md="protocol">Протокол (.docx)</button>
      <button data-md="result">Текст сообщения в ЕФРСБ о результатах (.docx)</button>
      <button data-md="court">Ходатайство о приобщении материалов (в «Документы»)</button></div>
      <label class="field" style="margin-top:12px">Статус собрания<select id="md-status">${MEETING_STATUSES.map(s => `<option ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></section></div>`;
  $('#md-status', b).onchange = e => { m.status = e.target.value; save(); route(); };
  b.addEventListener('click', e => {
    const k = e.target.closest('[data-md]')?.dataset.md;
    if (!k) return;
    if (k === 'notices') {
      if (!(m.participants || []).length) { toast('Сначала заполните участников'); return; }
      const text = meetingNoticeText(p, m);
      for (const x of m.participants) {
        const cp = findCounterparty(p, x.name);
        p.documents.push({ id: uid(), template: 'meeting_notice', title: `Уведомление о собрании ${fmtDate(m.date)}: ${x.name}`, heading: 'УВЕДОМЛЕНИЕ', subheading: `о проведении ${meetingWord(m)}`, date: todayISO(), number: nextDocNumber(p), addressee: x.name, address: cp?.address || '', text, attachments: '', status: 'Черновик', in_report: false });
      }
      save();
      toast(`Создано уведомлений: ${m.participants.length}. Они в разделе «Документы».`);
    }
    if (k === 'efrsb') saveDocx(`ЕФРСБ — ${name}`, [{ text: 'Сообщение о проведении собрания', align: 'center', bold: true, after: 200 }, ...bodyBlocks(meetingNoticeText(p, m))]);
    if (k === 'ballots') saveDocx(`Бюллетени — ${name}`, meetingBallotsBlocks(p, m));
    if (k === 'register') saveDocx(`Журнал регистрации — ${name}`, meetingRegisterBlocks(p, m));
    if (k === 'protocol') saveDocx(`Протокол — ${name}`, meetingProtocolBlocks(p, m));
    if (k === 'result') saveDocx(`ЕФРСБ результаты — ${name}`, [{ text: 'Сообщение о результатах собрания', align: 'center', bold: true, after: 200 }, ...bodyBlocks(meetingResultText(p, m))]);
    if (k === 'court') {
      const doc = draftFromTemplate(p, 'court_meeting');
      doc.number = nextDocNumber(p);
      p.documents.push(doc);
      save();
      toast('Ходатайство создано в разделе «Документы»');
    }
  });
}

// ---------- Отчёт АУ и финанализ ----------

function renderReportTab(body, p) {
  p.report_cfg = p.report_cfg || {};
  const s = rtkSummary(p);
  const sent = p.documents.filter(d => d.in_report);
  const answered = sent.filter(d => d.answer_date || d.answer_summary);
  const defs = [
    { f: 'date', label: 'Отчёт по состоянию на', type: 'date' },
    { f: 'extra', label: 'Иные сведения (войдут отдельным разделом)', type: 'textarea', wide: true },
  ];
  body.innerHTML = `
    <div class="grid kpis">
      <div class="panel kpi"><div class="num">${p.assets.length}</div><div class="lbl">объектов имущества, ${fmtMoney(sumBy(p.assets, 'market_value'))} ₽</div></div>
      <div class="panel kpi"><div class="num">${s.creditors}</div><div class="lbl">кредиторов в РТК, ${fmtMoney(s.total.amount)} ₽</div></div>
      <div class="panel kpi"><div class="num">${fmtPct(pct(s.total.paid, s.total.amount))}</div><div class="lbl">реестра погашено</div></div>
      <div class="panel kpi"><div class="num">${answered.length}/${sent.length}</div><div class="lbl">ответов на запросы</div></div>
    </div>
    <div class="panel"><div class="form-grid" id="rep-form">${objFormHtml(defs, p.report_cfg)}</div>
      <div class="actions" style="margin-top:14px">
        <button class="primary" data-r="report">Отчёт АУ (.docx)</button>
        <button data-r="cash">Отчёт об использовании денег (.docx)</button>
        <button data-r="rtk">Реестр требований (.docx)</button>
        <button data-r="inv">Опись имущества (.docx)</button>
      </div>
      <p class="small muted" style="margin:12px 0 0">Отчёт собирается из всех разделов карточки: привлечённые лица, имущество, счета, дебиторка, продажи, поступления, текущие расходы, работники, РТК, меры, споры, запросы и ответы, жалобы, собрания, выводы финанализа.
      Это рабочая форма по составу типового отчёта; перед отправкой проверьте её в Word.</p></div>`;
  bindObjForm($('#rep-form', body), defs, p.report_cfg, () => touch(p));
  body.addEventListener('click', e => {
    const k = e.target.closest('[data-r]')?.dataset.r;
    if (k === 'report') saveDocx(`Отчёт АУ ${p.debtor.name || ''} ${p.report_cfg.date || todayISO()}`, reportBlocks(p, p.report_cfg), { landscape: true, fontSize: 11 });
    if (k === 'cash') saveDocx(`Отчёт об использовании денежных средств ${p.debtor.name || ''}`, cashReportBlocks(p, p.report_cfg), { landscape: true });
    if (k === 'rtk') saveDocx(`РТК ${p.debtor.name || ''} ${todayISO()}`, rtkBlocks(p, p.report_cfg.date), { landscape: true });
    if (k === 'inv') saveDocx(`Опись имущества ${p.debtor.name || ''}`, inventoryBlocks(p), { landscape: true });
  });
}

function renderFinanalysis(body, p) {
  p.analysis = p.analysis || {};
  const a = p.analysis;
  const ent = p.debtor_type === 'ent';
  const defs = [
    { f: 'date', label: 'Дата анализа', type: 'date' },
    { f: 'period_from', label: 'Анализируемый период с', type: 'date' },
    { f: 'sources', label: 'Источники информации (если пусто — из ответов на запросы)', type: 'textarea', wide: true },
    { f: 'income_text', label: 'Анализ доходов (дополнительно к таблице)', type: 'textarea', wide: true },
    { f: 'assets_text', label: 'Анализ имущества', type: 'textarea', wide: true },
    { f: 'debts_text', label: 'Анализ обязательств', type: 'textarea', wide: true },
    { f: 'solvency', label: 'Вывод о возможности восстановления платёжеспособности', type: 'textarea', wide: true },
    { f: 'conclusion', label: 'Иные выводы', type: 'textarea', wide: true },
    { heading: 'Признаки фиктивного и преднамеренного банкротства' },
    { f: 'deals_text', label: 'Проанализированные сделки (перечень)', type: 'textarea', wide: true },
    { f: 'fict', label: 'Есть признаки фиктивного банкротства', type: 'bool' },
    { f: 'delib', label: 'Есть признаки преднамеренного банкротства', type: 'bool' },
    { f: 'fict_text', label: 'Обоснование: фиктивное банкротство', type: 'textarea', wide: true },
    { f: 'delib_text', label: 'Обоснование: преднамеренное банкротство', type: 'textarea', wide: true },
    { heading: 'Оспаривание сделок' },
    { f: 'deals', label: 'Есть сделки, подлежащие оспариванию', type: 'bool' },
    { f: 'deals_challenge', label: 'Какие сделки и по каким основаниям', type: 'textarea', wide: true },
  ];
  body.innerHTML = `
    ${!ent ? `<div class="panel" style="margin-bottom:12px"><h2>Платёжеспособность</h2><div>${solvencyHtml(p)}</div>
      <p class="small muted" style="margin:8px 0 0">Доходы — в «Должник и семья → Источники дохода», прожиточный минимум и расходы — там же. Срок плана реструктуризации — до трёх лет.</p></div>` : ''}
    <div class="panel"><div class="form-grid" id="fa-form">${objFormHtml(defs, a)}</div>
      <div class="actions" style="margin-top:14px">
        <button class="primary" data-fa="analysis">Анализ финансового состояния (.docx)</button>
        <button data-fa="fict">Заключение о признаках банкротства (.docx)</button>
        <button data-fa="deals">Заключение об оспаривании сделок (.docx)</button>
      </div></div>`;
  bindObjForm($('#fa-form', body), defs, a, () => touch(p));
  body.addEventListener('click', e => {
    const k = e.target.closest('[data-fa]')?.dataset.fa;
    const nm = p.debtor.name || '';
    if (k === 'analysis') saveDocx(`Анализ финансового состояния ${nm}`, analysisBlocks(p));
    if (k === 'fict') saveDocx(`Заключение о признаках фиктивного и преднамеренного банкротства ${nm}`, fictBlocks(p));
    if (k === 'deals') saveDocx(`Заключение об оспаривании сделок ${nm}`, dealsBlocks(p));
  });
}

// ---------- Типовые задачи ----------

function addDays(iso, k) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

// Рабочие дни без учёта праздников.
function addWorkdays(iso, k) {
  const d = new Date(iso + 'T00:00:00Z');
  while (k > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) k--;
  }
  return d.toISOString().slice(0, 10);
}

function taskPresets(p) {
  const intro = p.dates.introduction;
  const appt = p.dates.appointment || intro;
  const t = p.procedure_type;
  const pub = p.rtk?.kommersant_date || p.rtk?.fedresurs_date;
  const L = [];
  const add = (key, title, due, note = '') => { if (due) L.push({ key, title, due, note }); };
  if (!intro) return L;
  if (t === 'Реструктуризация долгов гражданина' || t === 'Реализация имущества гражданина') {
    const rd = t === 'Реструктуризация долгов гражданина';
    add('efrsb', 'Включить в ЕФРСБ сообщение о введении процедуры', addWorkdays(intro, 3), 'срок по умолчанию — 3 рабочих дня; проверьте');
    add('kommersant', 'Направить объявление в «Коммерсантъ»', addDays(intro, 10), 'срок по умолчанию; п. 1 ст. 213.7');
    add('debtor_req', 'Направить должнику запрос-уведомление (ответ — 15 дней, п. 9 ст. 213.9)', addDays(intro, 3));
    add('requests', 'Направить запросы в госорганы (ответ — 7 дней, п. 1 ст. 20.3)', addDays(intro, 7));
    add('notify', 'Уведомить известных кредиторов, банки и дебиторов (5 рабочих дней с даты, когда стало известно, п. 8 ст. 213.9)', addWorkdays(appt, 5));
    add('bki', 'Направить сведения в бюро кредитных историй', addWorkdays(intro, 5), 'срок по умолчанию');
    if (pub) add('rtk_close', 'Закрытие реестра требований кредиторов (2 месяца с публикации)', addMonths(pub, 2), rd ? 'п. 2 ст. 213.8' : 'п. 4 ст. 213.24');
    if (rd) {
      add('refuse_deals', 'Последний день для отказа от исполнения сделок гражданина (3 месяца, п. 11 ст. 213.9)', addMonths(intro, 3));
      add('fin_analysis', 'Подготовить анализ финансового состояния и заключения', p.dates.final_hearing ? addDays(p.dates.final_hearing, -20) : addMonths(intro, 3), 'срок по умолчанию');
      add('first_meeting', 'Провести первое собрание кредиторов', p.dates.final_hearing ? addDays(p.dates.final_hearing, -10) : addMonths(intro, 4), 'срок по умолчанию; проверьте по ст. 213.8, 213.12');
    } else {
      add('inventory', 'Составить опись имущества гражданина', addMonths(intro, 1), 'срок по умолчанию');
      add('fin_analysis', 'Подготовить анализ финансового состояния и заключения', p.dates.final_hearing ? addDays(p.dates.final_hearing, -20) : addMonths(intro, 5), 'срок по умолчанию');
    }
    for (let i = 1; i <= 4; i++) add('report_q' + i, `Направить кредиторам отчёт финансового управляющего (не реже раза в квартал, п. 8 ст. 213.9), квартал ${i}`, addMonths(intro, 3 * i));
  } else if (t === 'Конкурсное производство') {
    add('docs_demand', 'Потребовать у руководителя документацию и имущество (передача — 3 дня, п. 2 ст. 126)', addDays(appt, 1));
    add('publish', 'Направить для опубликования сведения о признании банкротом (не позднее 10 дней с даты утверждения, ст. 128)', addDays(appt, 10));
    add('requests', 'Направить запросы в госорганы (ответ — 7 дней, п. 1 ст. 20.3)', addDays(appt, 7));
    add('notify_workers', 'Уведомить работников о предстоящем увольнении', addMonths(intro, 1), 'срок по умолчанию — месяц с даты введения КП; проверьте по ст. 129');
    add('inventory', 'Завершить инвентаризацию имущества (не более 3 месяцев, ст. 129)', addMonths(intro, 3));
    if (pub) add('rtk_close', 'Закрытие реестра требований кредиторов (2 месяца с публикации, п. 1 ст. 142)', addMonths(pub, 2));
    for (let i = 1; i <= 4; i++) add('report_q' + i, `Собрание кредиторов и отчёт конкурсного управляющего (не реже раза в 3 месяца, ст. 143), квартал ${i}`, addMonths(intro, 3 * i));
  } else if (t === 'Наблюдение') {
    add('publish', 'Направить для опубликования сведения о введении наблюдения', addDays(appt, 10), 'срок по умолчанию; проверьте по ст. 68');
    add('debtor_req', 'Запросить у руководителя документы и сведения о деятельности должника', addDays(appt, 3));
    add('requests', 'Направить запросы в госорганы (ответ — 7 дней, п. 1 ст. 20.3)', addDays(appt, 7));
    if (pub) add('rtk_close', 'Окончание срока предъявления требований для первого собрания (30 дней с публикации, п. 1 ст. 71)', addDays(pub, 30));
    add('fin_analysis', 'Подготовить финансовый анализ и заключения к первому собранию', p.dates.final_hearing ? addDays(p.dates.final_hearing, -25) : addMonths(intro, 3), 'срок по умолчанию');
    add('first_meeting', 'Провести первое собрание кредиторов (не позднее чем за 10 дней до окончания наблюдения)', p.dates.final_hearing ? addDays(p.dates.final_hearing, -10) : '', 'по дате заседания по итогам наблюдения');
  }
  if (p.dates.completion) add('final_report', 'Включить в ЕФРСБ отчёт о результатах процедуры (10 дней после завершения)', addDays(p.dates.completion, 10), t?.includes('гражданина') ? 'п. 2.1 ст. 213.7' : 'ст. 28');
  return L;
}

function renderTasks(body, p) {
  renderSubtable(body, p, 'tasks', { extraActions: '<button data-presets>Типовые задачи по процедуре</button>' });
  $('[data-presets]', body).onclick = () => {
    const list = taskPresets(p);
    if (!list.length) { toast('Укажите вид процедуры и дату введения на вкладке «Основное»'); return; }
    const have = new Set(p.tasks.map(x => x.preset).filter(Boolean));
    const m = modal(`<h2>Типовые задачи: ${esc(p.procedure_type || '')}</h2>
      <p class="small muted">Сроки посчитаны от дат на вкладке «Основное» (введение ${fmtDate(p.dates.introduction)}, назначение ${fmtDate(p.dates.appointment) || '—'}). Где написано «по умолчанию» — проверьте срок по закону и делу. Рабочие дни считаются без праздников.</p>
      <div class="assign-list">${list.map((x, i) => `<label class="field check"><input type="checkbox" data-ti="${i}" ${have.has(x.key) ? 'disabled' : 'checked'}>
        <span>${dueBadge(x.due)} ${esc(x.title)}${x.note ? ` <span class="small muted">(${esc(x.note)})</span>` : ''}${have.has(x.key) ? ' <span class="badge gray">уже есть</span>' : ''}</span></label>`).join('')}</div>
      <div class="foot"><span></span><div class="actions"><button data-act="close">Отмена</button><button class="primary" id="ti-ok">Добавить выбранные</button></div></div>`);
    $('#ti-ok', m.el).onclick = () => {
      const chosen = $$('[data-ti]:checked', m.el).map(x => list[Number(x.dataset.ti)]);
      for (const x of chosen) p.tasks.push({ id: uid(), title: x.title, due: x.due, done: false, note: x.note, preset: x.key });
      touch(p); m.close(); route();
      toast(`Добавлено задач: ${chosen.length}`);
    };
  };
}

// ---------- Споры: номер дела и задачи по спору ----------

const DISPUTE_TASK_PRESETS = [
  'Договориться с экспертом', 'Найти свидетеля', 'Сделать запрос', 'Представить документы в суд',
  'Подготовить отзыв (позицию по спору)', 'Подготовить ходатайство',
];

// «Иванов — Петров (А19-1/2026)»; пусто, если спора нет.
function disputeLabel(p, id) {
  const d = id && p.disputes.find(x => x.id === id);
  if (!d) return '';
  const parties = [d.plaintiff, d.defendant].filter(Boolean).join(' — ') || 'спор без названия';
  return d.case_no ? `${parties} (${d.case_no})` : parties;
}

// Номер банкротного дела этой процедуры, номера, уже введённые в других спорах, и «другой номер».
function disputeCaseOptions(p) {
  const own = p.case_number;
  const others = [...new Set(p.disputes.map(x => String(x.case_no || '').trim()).filter(c => c && c !== own && c !== '__other'))];
  return [...(own ? [[own, `Банкротное дело ${own}`]] : []), ...others.map(c => [c, c]), ['__other', 'Другой номер…']];
}

function disputeTasksCell(p, d) {
  const mine = p.tasks.filter(t => t.dispute_id === d.id);
  if (!mine.length) return '<span class="muted">—</span>';
  const open = mine.filter(t => !t.done).length;
  return `<span class="badge ${open ? 'warn' : 'ok'}" title="Открытых задач: ${open} из ${mine.length}">${open ? `${open} из ${mine.length}` : 'выполнены'}</span>`;
}

function commentCell(v) {
  const s = String(v || '');
  return s.length > 90 ? `<span title="${esc(s)}">${esc(s.slice(0, 90))}…</span>` : esc(s);
}

// Задачи спора правятся в копии и записываются в процедуру вместе со спором (Отмена ничего не меняет).
function disputePrepare(d, p) {
  if (!d.case_no) d.case_no = p.case_number || '';
  d._tasks = p.tasks.filter(t => t.dispute_id === d.id).map(t => ({ ...t }));
}

function disputeBeforeSave(d, p) {
  if (d.case_no === '__other') d.case_no = String(d.case_no_other || '').trim();
  delete d.case_no_other;
  const mine = (d._tasks || []).filter(t => String(t.title || '').trim());
  delete d._tasks;
  p.tasks = p.tasks.filter(t => t.dispute_id !== d.id).concat(mine.map(t => ({ ...t, dispute_id: d.id })));
}

// При удалении спора задачи остаются, а название спора переходит в их название.
function disputeOnDelete(row, p) {
  const label = disputeLabel(p, row.id);
  for (const t of p.tasks) {
    if (t.dispute_id !== row.id) continue;
    t.title = `[Спор ${label}] ${t.title}`;
    t.dispute_id = '';
  }
}

function disputeDrawExtra(box, d, p) {
  const draw = (focusLast = false) => {
    const rows = d._tasks.map((t, i) => `<tr>
      <td style="width:34px;text-align:center"><input type="checkbox" data-t="${i}" data-k="done" ${t.done ? 'checked' : ''}></td>
      <td><input data-t="${i}" data-k="title" value="${esc(t.title)}" placeholder="Что нужно сделать"></td>
      <td style="width:150px"><input type="date" data-t="${i}" data-k="due" value="${esc(t.due)}"></td>
      <td style="width:36px"><button type="button" class="linklike danger" data-t-rm="${i}" title="Убрать задачу">✕</button></td></tr>`).join('');
    box.innerHTML = `<div class="form-group"><h3>Задачи по спору</h3>
      ${rows ? `<table class="compact"><thead><tr><th></th><th>Задача</th><th>Срок</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="small muted">Задач пока нет.</div>'}
      <div class="actions" style="margin-top:8px">
        <button type="button" data-t-add>+ Задача</button>
        <select data-t-preset style="width:auto"><option value="">+ Типовая задача…</option>${DISPUTE_TASK_PRESETS.map(t => `<option>${esc(t)}</option>`).join('')}</select>
      </div>
      <p class="small muted" style="margin:8px 0 0">Задачи сохраняются вместе со спором. Они видны на вкладке «Задачи» и в «Сроках» с названием спора.</p></div>`;
    if (focusLast) $$('[data-k=title]', box).at(-1)?.focus();
  };
  const add = title => { d._tasks.push({ id: uid(), title, due: '', done: false, note: '', dispute_id: d.id }); draw(true); };
  draw();
  box.onclick = e => {
    if (e.target.closest('[data-t-add]')) add('');
    const rm = e.target.closest('[data-t-rm]');
    if (rm) { d._tasks.splice(Number(rm.dataset.tRm), 1); draw(); }
  };
  box.onchange = e => {
    const el = e.target;
    if (el.matches('[data-t-preset]')) { if (el.value) add(el.value); return; }
    if (el.dataset.t == null) return;
    d._tasks[Number(el.dataset.t)][el.dataset.k] = el.dataset.k === 'done' ? el.checked : el.value.trim();
  };
}

// ---------- Настройки: реквизиты, адресаты, свои шаблоны ----------

const AU_PROFILE_FIELDS = [
  { f: 'full_name', label: 'ФИО полностью', wide: true },
  { f: 'short_name', label: 'Для подписи (И. О. Фамилия)' },
  { f: 'sex', label: 'Пол (для текстов)', type: 'select', options: [['м', 'мужской'], ['ж', 'женский']] },
  { f: 'inn', label: 'ИНН' },
  { f: 'snils', label: 'СНИЛС' },
  { f: 'reg_no', label: 'Рег. номер в сводном реестре АУ' },
  { f: 'postal_address', label: 'Адрес для корреспонденции', wide: true },
  { f: 'phone', label: 'Телефон' },
  { f: 'email', label: 'Электронная почта' },
  { f: 'city', label: 'Место составления документов по умолчанию' },
  { f: 'sro_name', label: 'СРО (полное наименование)', wide: true },
  { f: 'sro_inn', label: 'ИНН СРО' },
  { f: 'sro_ogrn', label: 'ОГРН СРО' },
  { f: 'sro_address', label: 'Адрес СРО', wide: true },
  { f: 'insurer', label: 'Страховая компания (полис АУ)', wide: true },
  { f: 'policy', label: '№ и дата полиса' },
];

function renderSettingsExtra(container) {
  const s = DATA.settings;
  s.au_profile = s.au_profile || {};
  s.addressees = s.addressees || {};
  s.doc_templates = s.doc_templates || [];
  container.innerHTML = `
    <section class="panel wide-panel"><h2>Мои реквизиты для документов</h2>
      <div class="form-grid" id="au-form">${objFormHtml(AU_PROFILE_FIELDS, s.au_profile, 'au')}</div>
      <p class="small muted" style="margin:10px 0 0">Подставляются в запросы, уведомления, ходатайства, протоколы и отчёты. Срок полиса — в блоке «Мои документы».</p></section>
    <section class="panel wide-panel"><h2>Адресаты запросов</h2>
      <p class="small muted">Наименования и адреса госорганов для запросов. Можно оставить общие и поправлять адрес в каждом документе.</p>
      <div class="table-wrap"><table class="compact"><thead><tr><th>Кому</th><th>Наименование</th><th>Адрес</th></tr></thead><tbody>
        ${Object.keys(DEFAULT_ADDRESSEES).map(k => `<tr><td class="nowrap">${esc(ADDRESSEE_LABELS[k])}</td>
          <td><input data-ad="${k}" data-k="name" value="${esc(s.addressees[k]?.name || DEFAULT_ADDRESSEES[k])}"></td>
          <td><input data-ad="${k}" data-k="address" value="${esc(s.addressees[k]?.address || '')}" placeholder="индекс, город, улица, дом"></td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="panel wide-panel"><h2>Свои шаблоны документов</h2>
      <p class="small muted">Появляются в окне «Создать документы». В тексте можно использовать подстановки: ${Object.keys(PLACEHOLDERS).map(k => `<code>{{${esc(k)}}}</code>`).join(' ')}.</p>
      <div id="own-tpl"></div><div class="actions" style="margin-top:10px"><button class="primary" id="tpl-add">+ Шаблон</button></div></section>`;
  bindObjForm($('#au-form', container), AU_PROFILE_FIELDS, s.au_profile, () => touch(), 'au');
  container.addEventListener('change', e => {
    const el = e.target.closest('[data-ad]');
    if (!el) return;
    const k = el.dataset.ad;
    s.addressees[k] = { ...(s.addressees[k] || {}), [el.dataset.k]: el.value.trim() };
    touch();
  });
  const drawOwn = () => {
    $('#own-tpl', container).innerHTML = s.doc_templates.length ? `<table class="compact"><tbody>${s.doc_templates.map((t, i) => `<tr class="click" data-own="${i}"><td>${esc(t.title || 'Без названия')}</td><td class="small muted">${t.kind === 'court' ? 'в суд' : 'письмо'}${t.addressee ? ' · ' + esc(t.addressee) : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Своих шаблонов пока нет.</div>';
  };
  drawOwn();
  const edit = i => {
    const t = i == null ? { id: uid(), kind: 'letter', title: '', doc_title: 'ПИСЬМО', addressee: '', address: '', body: '{{вводная}}\n\n', attachments: '' } : structuredClone(s.doc_templates[i]);
    const defs = [
      { f: 'title', label: 'Название в списке', wide: true },
      { f: 'kind', label: 'Оформление', type: 'select', options: [['letter', 'Письмо (реквизиты слева, адресат справа)'], ['court', 'Документ в арбитражный суд']] },
      { f: 'doc_title', label: 'Заголовок в документе (ЗАПРОС, ХОДАТАЙСТВО…)' },
      { f: 'addressee', label: 'Адресат', wide: true },
      { f: 'address', label: 'Адрес', wide: true },
      { f: 'body', label: 'Текст (абзацы — через пустую строку)', type: 'textarea', wide: true },
      { f: 'attachments', label: 'Приложения (по одному в строке)', type: 'textarea', wide: true },
    ];
    const m = modal(`<h2>${i == null ? 'Новый шаблон' : 'Шаблон'}</h2><div class="form-grid" id="ot-form">${objFormHtml(defs, t, 'ot')}</div>
      <div class="foot"><div>${i == null ? '' : '<button class="danger" data-act="del">Удалить</button>'}</div><div class="actions"><button data-act="close">Отмена</button><button class="primary" data-act="ok">Сохранить</button></div></div>`);
    m.el.querySelector('.modal').classList.add('wide-modal');
    bindObjForm($('#ot-form', m.el), defs, t, () => {}, 'ot');
    m.el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') { if (i == null) s.doc_templates.push(t); else s.doc_templates[i] = t; touch(); m.close(); drawOwn(); }
      if (act === 'del') { s.doc_templates.splice(i, 1); touch(); m.close(); drawOwn(); }
    });
  };
  $('#tpl-add', container).onclick = () => edit(null);
  $('#own-tpl', container).addEventListener('click', e => {
    const tr = e.target.closest('[data-own]');
    if (tr) edit(Number(tr.dataset.own));
  });
}

// ---------- Таблицы новых списков (подключаются в SUBTABLES в app.js) ----------

const EXTRA_SUBTABLES = {
  spouses: {
    add: 'Добавить супруга',
    cols: [
      { f: 'name', label: 'ФИО', wide: true },
      { f: 'birth_date', label: 'Дата рождения', type: 'date' },
      { f: 'birth_place', label: 'Место рождения', wide: true, hidden: true },
      { f: 'inn', label: 'ИНН' },
      { f: 'snils', label: 'СНИЛС', hidden: true },
      { f: 'address', label: 'Адрес регистрации', wide: true, hidden: true },
      { f: 'marriage_cert', label: 'Свидетельство о браке (№, дата, ЗАГС)', wide: true, hidden: true },
      { f: 'marriage_date', label: 'Дата брака', type: 'date' },
      { f: 'divorce_date', label: 'Дата расторжения', type: 'date' },
      { f: 'prenup', label: 'Брачный договор (№, дата, нотариус)', wide: true, hidden: true },
      { f: 'division', label: 'Соглашение / судебный акт о разделе имущества', wide: true, hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
  children: {
    add: 'Добавить ребёнка',
    sort: (a, b) => (a.birth_date || '').localeCompare(b.birth_date || ''),
    cols: [
      { f: 'name', label: 'ФИО', wide: true },
      { f: 'birth_date', label: 'Дата рождения', type: 'date' },
      { f: 'birth_cert', label: 'Свидетельство о рождении (№, дата, ЗАГС)', wide: true, hidden: true },
      { f: 'inn', label: 'ИНН', hidden: true },
      { f: 'snils', label: 'СНИЛС', hidden: true },
      { f: 'adult', label: 'Совершеннолетний (не учитывать в прожиточном минимуме)', type: 'bool' },
      { f: 'alimony', label: 'Алименты (соглашение / судебный акт, сумма)', wide: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
  incomes: {
    add: 'Добавить источник дохода',
    cols: [
      { f: 'source', label: 'Источник (работодатель, пенсия, пособие…)', wide: true },
      { f: 'amount_month', label: 'Сумма в месяц, ₽', type: 'money' },
      { f: 'info_source', label: 'Откуда сведения (справка, ответ СФР…)', wide: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    footer: rows => `Итого в месяц: ${fmtMoney(sumBy(rows, 'amount_month'))} ₽`,
  },
  counterparties: {
    add: 'Добавить контрагента',
    sort: (a, b) => (a.role || '').localeCompare(b.role || '', 'ru') || (a.name || '').localeCompare(b.name || '', 'ru'),
    cols: [
      { f: 'name', label: 'Наименование / ФИО', wide: true },
      { f: 'role', label: 'Роль', type: 'select', options: CP_ROLES, rerender: true },
      { f: 'kind', label: 'Вид', type: 'select', options: ['Физлицо', 'Юрлицо', 'ИП', 'Госорган'] },
      { f: 'inn', label: 'ИНН' },
      { f: 'ogrn', label: 'ОГРН / ОГРНИП', hidden: true },
      { f: 'address', label: 'Почтовый адрес (для уведомлений)', wide: true },
      { f: 'email', label: 'Электронная почта', hidden: true },
      { f: 'phone', label: 'Телефон', hidden: true },
      { f: 'kdl_position', label: 'Должность / основание контроля', show: d => d.role === 'Контролирующее лицо (КДЛ)', hidden: true },
      { f: 'subsidiary', label: 'Привлекается к субсидиарной ответственности', type: 'bool', show: d => d.role === 'Контролирующее лицо (КДЛ)', hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
  costs: {
    add: 'Добавить расход',
    sort: (a, b) => (a.date || '').localeCompare(b.date || ''),
    defaults: () => ({ date: todayISO(), queue: '1' }),
    onChange: (d, f) => { if (f === 'kind') { const k = COST_KINDS.find(([t]) => t === d.kind); if (k) d.queue = k[1]; } },
    cols: [
      { f: 'date', label: 'Дата возникновения', type: 'date' },
      { f: 'creditor', label: 'Текущий кредитор (получатель)', list: 'cp-names', wide: true },
      { f: 'kind', label: 'Вид расхода', type: 'select', options: COST_KINDS.map(([t]) => t), rerender: true },
      { f: 'queue', label: 'Очередь текущих платежей', type: 'select', options: CURRENT_QUEUES },
      { f: 'amount', label: 'Начислено, ₽', type: 'money' },
      { label: 'Оплачено, ₽', tableOnly: true, num: true, cell: (r, p) => fmtMoney(costPaid(p, r)) },
      { label: 'Долг, ₽', tableOnly: true, num: true, cell: (r, p) => fmtMoney(n(r.amount) - costPaid(p, r)) },
      { f: 'basis', label: 'Основание (договор, счёт, определение)', wide: true, hidden: true },
      { f: 'approved', label: 'Согласовано собранием (протокол № и дата)', wide: true, hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    footer: (rows, p) => `Начислено ${fmtMoney(sumBy(rows, 'amount'))} ₽ · оплачено ${fmtMoney(sumBy(rows, r => costPaid(p, r)))} ₽ · долг ${fmtMoney(sumBy(rows, r => n(r.amount) - costPaid(p, r)))} ₽`,
    onDelete: (row, p) => { for (const pay of p.payments) pay.allocations = (pay.allocations || []).filter(a => !(a.type === 'cost' && a.id === row.id)); },
  },
  assets: {
    add: 'Добавить объект',
    defaults: () => ({ status: 'Выявлено', ownership: 'Единоличная' }),
    cols: [
      { f: 'kind', label: 'Вид имущества', type: 'select', options: ASSET_KINDS, rerender: true },
      { f: 'realty_kind', label: 'Вид объекта недвижимости', type: 'select', options: REALTY_KINDS, show: d => d.kind === 'Недвижимость', hidden: true },
      { f: 'name', label: 'Наименование, марка, модель', wide: true },
      { f: 'cadastral', label: 'Кадастровый номер', show: d => d.kind === 'Недвижимость' },
      { f: 'area', label: 'Площадь', show: d => d.kind === 'Недвижимость', hidden: true },
      { f: 'ident', label: 'VIN / госномер / заводской номер', show: d => ['Транспортное средство', 'Самоходная машина', 'Судно (маломерное)', 'Воздушное судно', 'Оружие'].includes(d.kind), hidden: true },
      { f: 'year', label: 'Год выпуска', show: d => ['Транспортное средство', 'Самоходная машина', 'Судно (маломерное)', 'Воздушное судно'].includes(d.kind), hidden: true },
      { f: 'org', label: 'Организация (наименование, ИНН)', wide: true, show: d => ['Доля в уставном капитале / акции', 'Ценные бумаги'].includes(d.kind), hidden: true },
      { f: 'location', label: 'Местонахождение', wide: true, hidden: true },
      { f: 'ownership', label: 'Вид собственности', type: 'select', options: ['Единоличная', 'Общая совместная (супругов)', 'Общая долевая'], hidden: true },
      { f: 'share', label: 'Доля должника', hidden: true },
      { f: 'basis', label: 'Основание приобретения', wide: true, hidden: true },
      { f: 'book_value', label: 'Балансовая (кадастровая) стоимость, ₽', type: 'money' },
      { f: 'market_value', label: 'Рыночная стоимость, ₽', type: 'money' },
      { f: 'valuer', label: 'Кто определил стоимость (оценщик, отчёт № …)', wide: true, hidden: true },
      { f: 'valuation_date', label: 'Дата оценки', type: 'date', hidden: true },
      { f: 'pledged', label: 'Предмет залога', type: 'bool', rerender: true },
      { f: 'pledgee', label: 'Залогодержатель', show: d => d.pledged, hidden: true },
      { f: 'pledge_contract', label: 'Договор залога (№, дата)', show: d => d.pledged, hidden: true },
      { f: 'only_housing', label: 'Единственное жильё', type: 'bool', show: d => d.kind === 'Недвижимость', hidden: true },
      { f: 'excluded', label: 'Исключено из конкурсной массы', type: 'bool', rerender: true, hidden: true },
      { f: 'excluded_basis', label: 'Основание исключения (определение суда, ст. 446 ГПК РФ)', wide: true, show: d => d.excluded, hidden: true },
      { f: 'status', label: 'Состояние', type: 'select', options: ASSET_STATUSES, rerender: true },
      { f: 'sale_method', label: 'Способ реализации', type: 'select', options: SALE_METHODS, show: d => ['Выставлено на торги', 'Продано', 'Передано кредитору (отступное)'].includes(d.status), hidden: true },
      { f: 'sale_date', label: 'Дата договора', type: 'date', show: d => ['Продано', 'Передано кредитору (отступное)'].includes(d.status), hidden: true },
      { f: 'buyer', label: 'Покупатель', show: d => ['Продано', 'Передано кредитору (отступное)'].includes(d.status), hidden: true },
      { f: 'sale_price', label: 'Цена продажи, ₽', type: 'money', show: d => ['Продано', 'Передано кредитору (отступное)'].includes(d.status) },
      { label: 'Оплачено, ₽', tableOnly: true, num: true, cell: (r, p) => (r.sale_price ? fmtMoney(assetPaid(p, r)) : '') },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    footer: rows => `Объектов: ${rows.length} · балансовая ${fmtMoney(sumBy(rows, 'book_value'))} ₽ · рыночная ${fmtMoney(sumBy(rows, 'market_value'))} ₽ · продано на ${fmtMoney(sumBy(rows, 'sale_price'))} ₽`,
  },
  receivables: {
    add: 'Добавить дебитора',
    defaults: () => ({ status: 'Выявлена' }),
    cols: [
      { f: 'debtor_name', label: 'Дебитор', list: 'cp-names', wide: true },
      { f: 'inn', label: 'ИНН дебитора', hidden: true },
      { f: 'amount', label: 'Сумма задолженности, ₽', type: 'money' },
      { label: 'Доля, %', tableOnly: true, num: true, cell: (r, p) => fmtPct(pct(n(r.amount), sumBy(p.receivables, 'amount'))) },
      { f: 'recovered', label: 'Взыскано до ведения в CRM, ₽', type: 'money', hidden: true },
      { label: 'Взыскано, ₽', tableOnly: true, num: true, cell: (r, p) => fmtMoney(receivableRecovered(p, r)) },
      { f: 'content', label: 'Содержание обязательства', wide: true, hidden: true },
      { f: 'basis', label: 'Основание возникновения', wide: true, hidden: true },
      { f: 'status', label: 'Состояние', type: 'select', options: RECEIVABLE_STATUSES },
      { f: 'measures', label: 'Меры по взысканию', type: 'textarea', wide: true, hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    footer: (rows, p) => `Всего ${fmtMoney(sumBy(rows, 'amount'))} ₽ · взыскано ${fmtMoney(sumBy(rows, r => receivableRecovered(p, r)))} ₽`,
  },
  measures: {
    add: 'Добавить меру',
    sort: (a, b) => (b.date || '').localeCompare(a.date || ''),
    defaults: () => ({ date: todayISO() }),
    cols: [
      { f: 'date', label: 'Дата', type: 'date' },
      { f: 'measure', label: 'Мера', type: 'select', options: MEASURE_KINDS, wide: true },
      { f: 'content', label: 'Содержание', type: 'textarea', wide: true },
      { f: 'result', label: 'Результат', wide: true },
      { f: 'court_act', label: 'Судебный акт по результату', wide: true, hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
  workers: {
    add: 'Добавить работника',
    sort: (a, b) => (a.name || '').localeCompare(b.name || '', 'ru'),
    cols: [
      { f: 'name', label: 'ФИО', wide: true },
      { f: 'position', label: 'Должность' },
      { f: 'dismissal_date', label: 'Дата приказа об увольнении', type: 'date' },
      { f: 'debt_before', label: 'Долг до принятия заявления, ₽ (2 очередь РТК)', type: 'money' },
      { f: 'debt_after', label: 'Долг после принятия заявления, ₽ (текущие)', type: 'money' },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
    footer: rows => `Работников: ${rows.length} · долг до ${fmtMoney(sumBy(rows, 'debt_before'))} ₽ · после ${fmtMoney(sumBy(rows, 'debt_after'))} ₽`,
  },
  complaints: {
    add: 'Добавить жалобу',
    sort: (a, b) => (b.received || '').localeCompare(a.received || ''),
    defaults: () => ({ decision: 'На рассмотрении' }),
    cols: [
      { f: 'received', label: 'Дата поступления', type: 'date' },
      { f: 'applicant', label: 'Заявитель', wide: true },
      { f: 'content', label: 'Содержание жалобы', type: 'textarea', wide: true },
      { f: 'article', label: 'Статья (КоАП, Закон о банкротстве)' },
      { f: 'reviewer', label: 'Кто рассматривает', type: 'select', options: COMPLAINT_REVIEWERS },
      { f: 'review_date', label: 'Дата рассмотрения', type: 'date' },
      { f: 'decision', label: 'Решение', type: 'select', options: COMPLAINT_DECISIONS, rerender: true },
      { f: 'fine', label: 'Сумма штрафа, ₽', type: 'money', show: d => d.decision === 'Административный штраф', hidden: true },
      { f: 'document', label: 'Документ по итогам (№, дата)', wide: true, hidden: true },
      { f: 'revision', label: 'Пересмотр / обжалование', wide: true, hidden: true },
      { f: 'note', label: 'Примечание', type: 'textarea', wide: true, hidden: true },
    ],
  },
};
