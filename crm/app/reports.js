'use strict';

// Расчёты по процедуре (РТК, деньги, голоса на собраниях) и печатные формы:
// РТК, опись имущества, отчёт АУ, отчёт о движении денег, финанализ и заключения, документы собраний, почтовый реестр.
// Скрипт загружается раньше app.js: всё, что берётся из app.js, используется только внутри функций.

// ---------- Справочники ----------

// Санкции не учитываются при определении числа голосов (п. 3 ст. 12 Закона о банкротстве).
const CLAIM_FINES = ['Неустойка (штрафы, пени)', 'Проценты за просрочку (ст. 395 ГК РФ)', 'Убытки в виде упущенной выгоды', 'Иные финансовые санкции'];
const OBLIGATIONS = ['Основной долг', 'Проценты по договору', 'Проценты за пользование займом', ...CLAIM_FINES, 'Судебные расходы', 'Госпошлина', 'Обязательные платежи (налоги, взносы)', 'Иное'];
const RTK_SECTIONS = [
  ['q1', 'Первая очередь'],
  ['q2', 'Вторая очередь'],
  ['q3s', 'Третья очередь: требования, обеспеченные залогом'],
  ['q3u', 'Третья очередь: требования, не обеспеченные залогом'],
  ['q3m', 'Третья очередь: мораторные проценты'],
  ['q3f', 'Третья очередь: неустойки (штрафы, пени) и иные санкции'],
  ['off', 'Требования, учитываемые за реестром'],
];
const CLAIM_CHANGE_KINDS = ['Замена кредитора (правопреемство)', 'Уменьшение (частичное исключение)', 'Исключение из реестра', 'Перевод за реестр', 'Изменение очерёдности', 'Признание обеспеченным залогом', 'Снятие залога'];

// Очереди текущих платежей (п. 2 ст. 134 Закона о банкротстве) и залоговые расходы (ст. 138).
const CURRENT_QUEUES = ['1', '2', '3', '4', '5', 'Залог (ст. 138)'];
const COST_KINDS = [
  ['Вознаграждение арбитражного управляющего', '1'],
  ['Судебные расходы', '1'],
  ['Публикации (ЕФРСБ, «Коммерсантъ»)', '1'],
  ['Почтовые расходы', '1'],
  ['Привлечённые лица, обязательные по закону', '1'],
  ['Оплата труда работников после возбуждения дела', '2'],
  ['Привлечённые лица по выбору АУ', '3'],
  ['Коммунальные и эксплуатационные платежи', '4'],
  ['Иные текущие платежи', '5'],
  ['Расходы на содержание и продажу предмета залога', 'Залог (ст. 138)'],
];
const IN_KINDS = ['Продажа имущества', 'Взыскание дебиторской задолженности', 'Доходы должника (зарплата, пенсия)', 'Возврат по оспоренной сделке', 'Остаток со счёта', 'Финансирование процедуры', 'Прочее'];
const OUT_KINDS = ['Погашение текущих платежей', 'Погашение реестровых требований', 'Выплата должнику (прожиточный минимум, исключённые средства)', 'Банковская комиссия', 'Прочее'];
const ASSET_KINDS = ['Недвижимость', 'Транспортное средство', 'Самоходная машина', 'Судно (маломерное)', 'Воздушное судно', 'Доля в уставном капитале / акции', 'Ценные бумаги', 'Оружие', 'Денежные средства, вклады', 'Имущественное право', 'Иное движимое имущество'];
const REALTY_KINDS = ['Квартира', 'Жилой дом', 'Комната', 'Земельный участок', 'Нежилое помещение', 'Нежилое здание', 'Гараж', 'Объект незавершённого строительства', 'Сооружение', 'Иное'];
const ASSET_STATUSES = ['Выявлено', 'Включено в опись', 'Оценено', 'Выставлено на торги', 'Продано', 'Исключено из конкурсной массы', 'Передано кредитору (отступное)', 'Оставлено за должником'];
const SALE_METHODS = ['Открытые торги (аукцион)', 'Торги посредством публичного предложения', 'Прямая продажа', 'Отступное', 'Иное'];
const RECEIVABLE_STATUSES = ['Выявлена', 'Направлена претензия', 'Взыскивается в суде', 'Исполнительное производство', 'Взыскана', 'Продана (уступлена)', 'Безнадёжная'];
const MEASURE_KINDS = [
  'Требование о передаче имущества и документации', 'Уведомление банков (блокировка, закрытие счетов)', 'Ходатайство об обеспечительных мерах',
  'Заявление об оспаривании сделки', 'Истребование имущества', 'Розыск имущества', 'Охрана, страхование, хранение имущества', 'Иное',
];
const COMPLAINT_REVIEWERS = ['Арбитражный суд', 'Росреестр', 'СРО', 'Прокуратура', 'Иное'];
const COMPLAINT_DECISIONS = ['На рассмотрении', 'Нарушений не установлено', 'Отказано', 'Удовлетворена', 'Предупреждение', 'Административный штраф', 'Дисквалификация', 'Отстранение'];
const CP_ROLES = ['Кредитор', 'Уполномоченный орган', 'Банк', 'Дебитор', 'Контролирующее лицо (КДЛ)', 'Участник (учредитель) должника', 'Работодатель должника', 'Покупатель имущества', 'Привлечённое лицо', 'Иное'];
const DOC_STATUSES = ['Черновик', 'Готов', 'Отправлен', 'Ответ получен', 'Не требует ответа'];
const SEND_METHODS = ['Почта России, заказное', 'Почта России, ценное с описью', 'Нарочно', 'Электронная почта', '«Мой арбитр»', 'ЕФРСБ', 'Иное'];
const MEETING_STATUSES = ['Запланировано', 'Проведено', 'Не состоялось (нет кворума)', 'Отменено'];

const n = v => Number(v) || 0;
const sumBy = (rows, f) => rows.reduce((s, r) => s + n(typeof f === 'function' ? f(r) : r[f]), 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const fmtPct = v => v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' %';
const money = v => fmtMoney(v === '' || v == null ? 0 : v);

// ---------- РТК ----------

function claimSection(c) {
  if (c.queue === '1 очередь') return 'q1';
  if (c.queue === '2 очередь') return 'q2';
  if (c.queue === 'За реестром') return 'off';
  if (c.moratorium) return 'q3m';
  if (CLAIM_FINES.includes(c.obligation)) return 'q3f';
  return c.secured ? 'q3s' : 'q3u';
}

function allocated(p, type, id) {
  let s = 0;
  for (const pay of p.payments) if (pay.dir === 'out') for (const a of pay.allocations || []) if (a.type === type && a.id === id) s += n(a.amount);
  return s;
}

const claimPaid = (p, c) => n(c.paid) + allocated(p, 'claim', c.id);
const claimRest = (p, c) => Math.max(0, n(c.amount) - claimPaid(p, c));
const costPaid = (p, c) => allocated(p, 'cost', c.id);
const activeClaims = p => p.claims.filter(c => !c.excluded);

function securedVotesDefault(p) {
  return ['Наблюдение', 'Реструктуризация долгов гражданина', 'Реализация имущества гражданина'].includes(p.procedure_type);
}

// Голосуют конкурсные кредиторы третьей очереди без санкций и мораторных процентов (ст. 12 Закона о банкротстве).
function isVotingClaim(c, securedVotes) {
  return c.queue === '3 очередь' && !c.moratorium && !CLAIM_FINES.includes(c.obligation) && !c.no_vote && !c.excluded && (!c.secured || securedVotes);
}

function moratoriumAmount(base, rate, from, to) {
  if (!n(base) || !n(rate) || !from || !to || to < from) return 0;
  let sum = 0;
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    const y = d.getUTCFullYear();
    const days = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
    sum += (n(base) * n(rate)) / 100 / days;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.round(sum * 100) / 100;
}

function rtkSummary(p) {
  const out = {};
  for (const [k] of RTK_SECTIONS) out[k] = { rows: [], amount: 0, paid: 0, creditors: new Set() };
  for (const c of activeClaims(p)) {
    const s = out[claimSection(c)];
    s.rows.push(c);
    s.amount += n(c.amount);
    s.paid += claimPaid(p, c);
    if (c.creditor) s.creditors.add(c.creditor.trim());
  }
  const reg = ['q1', 'q2', 'q3s', 'q3u', 'q3m', 'q3f'];
  const total = { amount: sumBy(reg.map(k => out[k]), 'amount'), paid: sumBy(reg.map(k => out[k]), 'paid') };
  const creditors = new Set(reg.flatMap(k => [...out[k].creditors]));
  return { sections: out, total, creditors: creditors.size, all: { amount: total.amount + out.off.amount, paid: total.paid + out.off.paid } };
}

function rtkCloseDate(p) {
  const r = p.rtk || {};
  if (r.close_date) return r.close_date;
  const pub = p.procedure_type === 'Наблюдение' ? '' : r.kommersant_date || r.fedresurs_date;
  return pub ? addMonths(pub, 2) : '';
}

// ---------- Деньги ----------

function accountBalance(p, a) {
  let s = n(a.balance_start);
  for (const pay of p.payments) if (pay.account_id === a.id) s += pay.dir === 'in' ? n(pay.amount) : -n(pay.amount);
  return s;
}

function currentSummary(p) {
  return CURRENT_QUEUES.map(q => {
    const rows = p.costs.filter(c => (c.queue || '5') === q);
    const accrued = sumBy(rows, 'amount');
    const paid = sumBy(rows, c => costPaid(p, c));
    return { q, accrued, paid, debt: accrued - paid, count: rows.length };
  });
}

// Пропорциональное распределение суммы между требованиями одной очереди (п. 3 ст. 142 Закона о банкротстве).
function prorata(p, claims, amount) {
  const rests = claims.map(c => ({ c, rest: claimRest(p, c) })).filter(x => x.rest > 0);
  const total = sumBy(rests, 'rest');
  if (!total) return [];
  const pay = Math.min(n(amount), total);
  let left = Math.round(pay * 100);
  const out = rests.map((x, i) => {
    const cents = i === rests.length - 1 ? left : Math.floor((x.rest / total) * pay * 100);
    left -= cents;
    return { type: 'claim', id: x.c.id, amount: cents / 100 };
  });
  return out.filter(a => a.amount > 0);
}

const assetPaid = (p, a) => sumBy(p.payments.filter(x => x.dir === 'in' && x.asset_id === a.id), 'amount');
const receivableRecovered = (p, r) => n(r.recovered) + sumBy(p.payments.filter(x => x.dir === 'in' && x.receivable_id === r.id), 'amount');

// ---------- Собрания ----------

function meetingTotals(p, m) {
  const parts = m.participants || [];
  const total = sumBy(parts, 'amount');
  const present = sumBy(parts.filter(x => x.present), 'amount');
  return { total, present, quorum: total > 0 && present > total / 2, presentPct: pct(present, total) };
}

function questionOptions(q) {
  const v = String(q.variants || '').split('\n').map(s => s.trim()).filter(Boolean);
  return v.length ? v : ['За', 'Против', 'Воздержался'];
}

function questionResult(p, m, q) {
  const t = meetingTotals(p, m);
  const opts = questionOptions(q);
  const tally = Object.fromEntries(opts.map(o => [o, 0]));
  for (const x of m.participants || []) {
    const v = x.present && (x.votes || {})[q.id];
    if (v && v in tally) tally[v] += n(x.amount);
  }
  const base = q.majority === 'total' ? t.total : t.present;
  const yesNo = !String(q.variants || '').trim();
  const [best, bestVotes] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const accepted = t.quorum && bestVotes > base / 2 && (!yesNo || best === 'За');
  const voted = Object.values(tally).reduce((s, v) => s + v, 0);
  let text;
  if (!t.quorum) text = 'Решение не принято: нет кворума.';
  else if (accepted) text = yesNo ? (q.decision || 'Решение принято.') : `Принят вариант: ${best}.`;
  else if (yesNo && best === 'Против' && bestVotes > base / 2) text = 'Решение не принято: большинство голосов «против».';
  else text = `Решение не принято: не набрано большинство голосов ${q.majority === 'total' ? 'от общего числа голосов' : 'от числа присутствующих'}.`;
  return { tally, base, accepted, best, voted, opts, text };
}

// ---------- Печатные формы ----------

function headerLines(c) {
  return [
    { text: `Должник: ${c.debName}${c.ident ? ` (${c.ident})` : ''}`, align: 'left' },
    { text: `Дело № ${c.caseNo}, ${c.court}`, align: 'left' },
    { text: `${c.Role}: ${c.auName}`, align: 'left', after: 160 },
  ];
}

function rtkBlocks(p, onDate) {
  const c = docCtx(p);
  const s = rtkSummary(p);
  const rows = [];
  for (const [k, title] of RTK_SECTIONS) {
    const sec = s.sections[k];
    if (k === 'off') rows.push([{ text: 'ИТОГО по реестру', span: 5, bold: true }, { text: money(s.total.amount), bold: true, align: 'right' }, { text: money(s.total.paid), bold: true, align: 'right' }, { text: fmtPct(pct(s.total.paid, s.total.amount)), bold: true, align: 'right' }, { text: money(s.total.amount - s.total.paid), bold: true, align: 'right' }]);
    rows.push([{ text: title, span: 9, bold: true }]);
    if (!sec.rows.length) { rows.push([{ text: 'Требований нет', span: 9 }]); continue; }
    for (const r of [...sec.rows].sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'ru', { numeric: true }))) {
      const paid = claimPaid(p, r);
      rows.push([
        r.number || '', fmtDate(r.included_date), r.creditor || '', r.creditor_no || '',
        [r.obligation, r.court_act, r.basis, r.moratorium ? `ставка ${r.rate} %, ${fmtDate(r.from)}–${fmtDate(r.to)}` : '', r.secured && r.pledge ? 'залог: ' + r.pledge : ''].filter(Boolean).join('; '),
        { text: money(r.amount), align: 'right' }, { text: money(paid), align: 'right' }, { text: fmtPct(pct(paid, n(r.amount))), align: 'right' }, { text: money(n(r.amount) - paid), align: 'right' },
      ]);
    }
    rows.push([{ text: `Итого: ${title.toLowerCase()}`, span: 5 }, { text: money(sec.amount), align: 'right' }, { text: money(sec.paid), align: 'right' }, { text: fmtPct(pct(sec.paid, sec.amount)), align: 'right' }, { text: money(sec.amount - sec.paid), align: 'right' }]);
  }
  const changes = (p.claim_changes || []).map(x => [fmtDate(x.date), x.kind || '', x.creditor_from || '', x.creditor_to || '', { text: money(x.amount), align: 'right' }, x.act || '']);
  return [
    { text: 'РЕЕСТР ТРЕБОВАНИЙ КРЕДИТОРОВ', align: 'center', bold: true },
    { text: `по состоянию на ${fmtDate(onDate || todayISO())}`, align: 'center', after: 160 },
    ...headerLines(c),
    { text: [p.rtk?.fedresurs_date && `Публикация в ЕФРСБ: ${fmtDate(p.rtk.fedresurs_date)}`, p.rtk?.kommersant_date && `публикация в «Коммерсантъ»: ${fmtDate(p.rtk.kommersant_date)}`, rtkCloseDate(p) && `дата закрытия реестра: ${fmtDate(rtkCloseDate(p))}`].filter(Boolean).join('; '), align: 'left', after: 120 },
    { table: { cols: [1, 1.2, 3, 0.8, 4, 1.6, 1.6, 1, 1.6], head: ['№ треб.', 'Дата записи', 'Кредитор', '№ кред.', 'Основание, документ о включении', 'Сумма, руб.', 'Погашено, руб.', '%', 'Остаток, руб.'], rows, size: 9 } },
    changes.length ? { text: 'Изменения требований', bold: true, align: 'left', before: 120 } : null,
    changes.length ? { table: { cols: [1.2, 3, 3, 3, 1.6, 4], head: ['Дата', 'Вид изменения', 'Прежний кредитор', 'Новый кредитор', 'Сумма, руб.', 'Судебный акт'], rows: changes, size: 9 } } : null,
    signatureTable(c, fmtDate(onDate || todayISO())),
  ];
}

function inventoryBlocks(p) {
  const c = docCtx(p);
  const rows = p.assets.map((a, i) => [
    String(i + 1), a.kind || '', [a.realty_kind, a.name, a.ident && 'идент.: ' + a.ident, a.cadastral && 'кад. № ' + a.cadastral, a.area && 'площадь ' + a.area, a.share && 'доля ' + a.share, a.year && a.year + ' г.'].filter(Boolean).join(', '),
    a.location || '', a.ownership || '', { text: money(a.book_value), align: 'right' }, { text: money(a.market_value), align: 'right' }, a.pledged ? 'да' + (a.pledgee ? ', ' + a.pledgee : '') : 'нет', a.excluded ? 'да' : '',
  ]);
  return [
    { text: 'ОПИСЬ ИМУЩЕСТВА', align: 'center', bold: true },
    { text: `${p.inventory_no ? '№ ' + p.inventory_no + ' ' : ''}от ${fmtDate(p.inventory_date || todayISO())}`, align: 'center', after: 160 },
    ...headerLines(c),
    { table: { cols: [0.5, 2, 5, 3, 2, 1.6, 1.6, 1.6, 1.2], head: ['№', 'Вид', 'Наименование и характеристики', 'Местонахождение', 'Вид собственности', 'Балансовая стоимость, руб.', 'Рыночная стоимость, руб.', 'Залог', 'Исключено из массы'], rows: rows.length ? rows : [[{ text: 'Имущество не выявлено', span: 9 }]], foot: rows.length ? [{ text: 'Итого', span: 5 }, { text: money(sumBy(p.assets, 'book_value')), align: 'right' }, { text: money(sumBy(p.assets, 'market_value')), align: 'right' }, '', ''] : null, size: 9 } },
    signatureTable(c, fmtDate(p.inventory_date || todayISO())),
  ];
}

// «10.06.2026 (полный текст — 17.06.2026)»
function actDates(res, full) {
  if (!res && !full) return '';
  if (!full || full === res) return fmtDate(res || full);
  if (!res) return fmtDate(full);
  return `${fmtDate(res)} (резолютивная часть), полный текст — ${fmtDate(full)}`;
}

const endDot = s => String(s || '').replace(/\.+$/, '') + '.';

function reportTitle(c) {
  return `ОТЧЁТ\n${c.info.roleGen} о своей деятельности и о результатах проведения процедуры ${c.info.nameGen}`;
}

function reportBlocks(p, cfg = {}) {
  const c = docCtx(p);
  const onDate = cfg.date || todayISO();
  const section = t => ({ text: t, bold: true, align: 'left', before: 200, after: 80, keep: true });
  const none = cols => [[{ text: 'Сведений нет', span: cols }]];
  const s = rtkSummary(p);
  const policy = (DATA.settings.au_docs || []).find(d => d.id === 'policy');
  const ins = [c.au.insurer, c.au.policy && 'полис № ' + c.au.policy, policy?.until && 'действует до ' + fmtDate(policy.until)].filter(Boolean).join(', ');
  const kv = rows => ({ table: { cols: [2, 5], rows: rows.filter(r => r[1]).map(([k, v]) => [k, v]), size: 10 } });
  const inPays = p.payments.filter(x => x.dir === 'in');
  const outPays = p.payments.filter(x => x.dir === 'out');
  const sold = p.assets.filter(a => a.sale_price || a.status === 'Продано');
  const requests = p.documents.filter(d => d.in_report);
  const disputes = p.disputes || [];
  const a = p.analysis || {};
  const blocks = [
    { text: reportTitle(c), align: 'center', bold: true },
    { text: `по состоянию на ${fmtDate(onDate)}`, align: 'center', after: 200 },
    section('1. Общие сведения'),
    kv([
      ['Должник', c.debName], ['Идентифицирующие сведения', c.ident], ['Арбитражный суд', c.court], ['Номер дела', c.caseNo],
      ['Процедура', p.procedure_type], ['Дата введения процедуры', actDates(p.dates.introduction, p.dates.introduction_motivated)],
      ['Дата утверждения управляющего', actDates(p.dates.appointment, p.dates.appointment_motivated)],
      ['Дата судебного заседания по итогам процедуры', fmtDate(p.dates.final_hearing)],
      [c.Role, [c.auName, c.au.reg_no && 'рег. номер ' + c.au.reg_no, c.au.inn && 'ИНН ' + c.au.inn].filter(Boolean).join(', ')],
      ['Саморегулируемая организация', c.au.sro_name], ['Страхование ответственности', ins], ['Адрес для корреспонденции', c.au.postal_address],
    ]),
    section('2. Сведения о лицах, привлечённых арбитражным управляющим'),
    { table: { cols: [2, 3, 2, 1.5, 2], head: ['Вид услуг', 'Наименование / ФИО', 'Договор', 'Сумма, руб.', 'Источник оплаты'], rows: p.involved.length ? p.involved.map(x => [x.type || '', x.name || '', [x.contract && '№ ' + x.contract, x.contract_date && 'от ' + fmtDate(x.contract_date)].filter(Boolean).join(' '), { text: money(x.amount), align: 'right' }, x.payment_source || '']) : none(5), size: 9 } },
    section('3. Сведения о выявленном имуществе должника (конкурсной массе)'),
    { text: p.inventory_date ? `Опись (инвентаризация) имущества проведена ${fmtDate(p.inventory_date)}${p.inventory_no ? ', № ' + p.inventory_no : ''}.` : 'Опись (инвентаризация) имущества: [сведения].', align: 'left' },
    { table: { cols: [0.5, 2, 4, 1.6, 1.6, 1.2, 2], head: ['№', 'Вид', 'Наименование', 'Балансовая, руб.', 'Рыночная, руб.', 'Залог', 'Состояние'], rows: p.assets.length ? p.assets.map((x, i) => [String(i + 1), x.kind || '', [x.realty_kind, x.name, x.cadastral && 'кад. № ' + x.cadastral, x.ident].filter(Boolean).join(', '), { text: money(x.book_value), align: 'right' }, { text: money(x.market_value), align: 'right' }, x.pledged ? 'да' : 'нет', [x.status, x.excluded && 'исключено: ' + (x.excluded_basis || '')].filter(Boolean).join('; ')]) : none(7), foot: p.assets.length ? [{ text: 'Итого', span: 3 }, { text: money(sumBy(p.assets, 'book_value')), align: 'right' }, { text: money(sumBy(p.assets, 'market_value')), align: 'right' }, '', ''] : null, size: 9 } },
    section('4. Сведения о счетах должника'),
    { table: { cols: [3, 2.4, 2.4, 1.6, 1.6, 1.4], head: ['Банк', 'Вид счёта', 'Номер счёта', 'Остаток на начало, руб.', 'Текущий остаток, руб.', 'Закрыт'], rows: p.accounts.length ? p.accounts.map(x => [x.bank || '', x.kind || '', x.number || '', { text: money(x.balance_start), align: 'right' }, { text: money(accountBalance(p, x)), align: 'right' }, fmtDate(x.closed)]) : none(6), size: 9 } },
    section('5. Сведения о дебиторской задолженности'),
    { table: { cols: [3, 1.6, 1.6, 3, 2], head: ['Дебитор', 'Сумма, руб.', 'Взыскано, руб.', 'Основание', 'Меры по взысканию'], rows: p.receivables.length ? p.receivables.map(x => [x.debtor_name || '', { text: money(x.amount), align: 'right' }, { text: money(receivableRecovered(p, x)), align: 'right' }, [x.content, x.basis].filter(Boolean).join('; '), [x.status, x.measures].filter(Boolean).join('; ')]) : none(5), size: 9 } },
    section('6. Сведения о реализации имущества'),
    { table: { cols: [4, 2, 1.4, 2.5, 1.6, 1.6], head: ['Имущество', 'Способ реализации', 'Дата', 'Покупатель', 'Цена, руб.', 'Оплачено, руб.'], rows: sold.length ? sold.map(x => [[x.name, x.cadastral, x.ident].filter(Boolean).join(', '), x.sale_method || '', fmtDate(x.sale_date), x.buyer || '', { text: money(x.sale_price), align: 'right' }, { text: money(assetPaid(p, x)), align: 'right' }]) : none(6), size: 9 } },
    section('7. Сведения о поступлении денежных средств в конкурсную массу'),
    { table: { cols: [1.4, 2.5, 3, 4, 1.6], head: ['Дата', 'Вид поступления', 'Плательщик', 'Назначение', 'Сумма, руб.'], rows: inPays.length ? inPays.map(x => [fmtDate(x.date), x.in_kind || '', x.counterparty || '', x.purpose || '', { text: money(x.amount), align: 'right' }]) : none(5), foot: inPays.length ? [{ text: 'Итого поступило', span: 4 }, { text: money(sumBy(inPays, 'amount')), align: 'right' }] : null, size: 9 } },
    section('8. Сведения о текущих расходах (расходах на проведение процедуры)'),
    { table: { cols: [1.4, 3, 3, 0.8, 1.6, 1.6, 1.6], head: ['Дата', 'Получатель', 'Вид расхода', 'Очередь', 'Начислено, руб.', 'Оплачено, руб.', 'Долг, руб.'], rows: p.costs.length ? p.costs.map(x => [fmtDate(x.date), x.creditor || '', x.kind || '', x.queue || '', { text: money(x.amount), align: 'right' }, { text: money(costPaid(p, x)), align: 'right' }, { text: money(n(x.amount) - costPaid(p, x)), align: 'right' }]) : none(7), foot: p.costs.length ? [{ text: 'Итого', span: 4 }, { text: money(sumBy(p.costs, 'amount')), align: 'right' }, { text: money(sumBy(p.costs, x => costPaid(p, x))), align: 'right' }, { text: money(sumBy(p.costs, x => n(x.amount) - costPaid(p, x))), align: 'right' }] : null, size: 9 } },
    section('9. Сведения о работниках должника'),
    { text: p.workers.length ? `Количество работников (бывших работников): ${p.workers.length}. Задолженность по оплате труда: до принятия заявления — ${money(sumBy(p.workers, 'debt_before'))} руб., после принятия заявления — ${money(sumBy(p.workers, 'debt_after'))} руб.` : 'Работники отсутствуют.', align: 'left' },
    section('10. Сведения о реестре требований кредиторов'),
    { text: `Дата закрытия реестра: ${fmtDate(rtkCloseDate(p)) || '—'}. Количество кредиторов, включённых в реестр: ${s.creditors}.`, align: 'left' },
    { table: { cols: [5, 1.8, 1.8, 1.2], head: ['Очередь', 'Включено, руб.', 'Погашено, руб.', '%'], rows: RTK_SECTIONS.filter(([k]) => k !== 'off').map(([k, t]) => [t, { text: money(s.sections[k].amount), align: 'right' }, { text: money(s.sections[k].paid), align: 'right' }, { text: fmtPct(pct(s.sections[k].paid, s.sections[k].amount)), align: 'right' }]), foot: [{ text: 'Итого по реестру' }, { text: money(s.total.amount), align: 'right' }, { text: money(s.total.paid), align: 'right' }, { text: fmtPct(pct(s.total.paid, s.total.amount)), align: 'right' }], size: 9 } },
    s.sections.off.amount ? { text: `Требования, учитываемые за реестром: ${money(s.sections.off.amount)} руб., погашено ${money(s.sections.off.paid)} руб.`, align: 'left' } : null,
    section('11. Сведения о мерах по обеспечению сохранности имущества и об оспаривании сделок'),
    { table: { cols: [1.4, 3, 4, 3], head: ['Дата', 'Мера', 'Содержание', 'Результат'], rows: p.measures.length ? p.measures.map(x => [fmtDate(x.date), x.measure || '', x.content || '', [x.result, x.court_act].filter(Boolean).join('; ')]) : none(4), size: 9 } },
    disputes.length ? { table: { cols: [3, 3, 2, 2.5, 1.6, 1.4], head: ['Заявитель', 'Ответчик', '№ дела', 'Вид спора', 'Сумма, руб.', 'Заседание'], rows: disputes.map(x => [x.plaintiff || '', x.defendant || '', x.case_no || '', x.type || '', { text: money(x.amount), align: 'right' }, fmtDate(x.hearing_date)]), size: 9 } } : null,
    section('12. Сведения о направленных запросах и полученных ответах'),
    { table: { cols: [3.4, 1.8, 1.4, 5], head: ['Адресат', 'Исх. № и дата', 'Дата ответа', 'Содержание ответа'], rows: requests.length ? requests.map(d => [d.addressee || '', [d.number, fmtDate(d.sent_date || d.date)].filter(Boolean).join(' от '), fmtDate(d.answer_date), d.answer_summary || (d.status === 'Отправлен' ? 'ответ не получен' : '')]) : none(4), size: 9 } },
    section('13. Сведения о жалобах на действия арбитражного управляющего'),
    { table: { cols: [1.4, 3, 4, 2.4, 2.4], head: ['Дата', 'Заявитель', 'Содержание', 'Кто рассматривал', 'Решение'], rows: p.complaints.length ? p.complaints.map(x => [fmtDate(x.received), x.applicant || '', x.content || '', x.reviewer || '', [x.decision, x.fine && 'штраф ' + money(x.fine) + ' руб.'].filter(Boolean).join(', ')]) : none(5), size: 9 } },
    section('14. Сведения о собраниях кредиторов'),
    { table: { cols: [1.4, 2, 6, 2], head: ['Дата', 'Форма', 'Повестка и решения', 'Статус'], rows: p.meetings.length ? p.meetings.map(m => [fmtDate(m.date), m.form || '', (m.questions || []).map((q, i) => `${i + 1}. ${q.title || q.wording || ''} — ${questionResult(p, m, q).text}`).join('\n'), m.status || '']) : none(4), size: 9 } },
    section('15. Выводы о наличии (отсутствии) признаков преднамеренного и фиктивного банкротства'),
    { text: [a.fict ? `Выявлены признаки фиктивного банкротства: ${a.fict_text || ''}` : 'Признаки фиктивного банкротства не выявлены.', a.delib ? `Выявлены признаки преднамеренного банкротства: ${a.delib_text || ''}` : 'Признаки преднамеренного банкротства не выявлены.'].join(' '), align: 'both' },
    cfg.extra ? section('16. Иные сведения') : null,
    ...(cfg.extra ? bodyBlocks(cfg.extra) : []),
    { text: '', after: 200 },
    signatureTable(c, fmtDate(onDate)),
  ];
  return blocks;
}

function cashReportBlocks(p, cfg = {}) {
  const c = docCtx(p);
  const pays = [...p.payments].sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const target = pay => (pay.allocations || []).map(a => {
    const row = a.type === 'claim' ? p.claims.find(x => x.id === a.id) : p.costs.find(x => x.id === a.id);
    return row ? `${a.type === 'claim' ? 'РТК' : 'текущие'}: ${row.creditor || ''} — ${money(a.amount)}` : '';
  }).filter(Boolean).join('\n');
  return [
    { text: 'ОТЧЁТ', align: 'center', bold: true },
    { text: `${c.info.roleGen} об использовании денежных средств должника`, align: 'center', bold: true },
    { text: `по состоянию на ${fmtDate(cfg.date || todayISO())}`, align: 'center', after: 160 },
    ...headerLines(c),
    { table: { cols: [1.3, 1.2, 1.6, 1.6, 3, 3, 3.5], head: ['Дата', '№ док.', 'Поступило, руб.', 'Списано, руб.', 'Контрагент', 'Назначение', 'Погашение'], rows: pays.length ? pays.map(x => [fmtDate(x.date), x.doc_no || '', x.dir === 'in' ? { text: money(x.amount), align: 'right' } : '', x.dir === 'out' ? { text: money(x.amount), align: 'right' } : '', x.counterparty || '', x.purpose || x.in_kind || x.out_kind || '', target(x)]) : [[{ text: 'Операций нет', span: 7 }]], foot: [{ text: 'Итого', span: 2 }, { text: money(sumBy(pays.filter(x => x.dir === 'in'), 'amount')), align: 'right' }, { text: money(sumBy(pays.filter(x => x.dir === 'out'), 'amount')), align: 'right' }, '', '', ''], size: 9 } },
    { text: 'Остатки на счетах должника', bold: true, align: 'left', before: 120 },
    { table: { cols: [3, 3, 2], head: ['Банк', 'Номер счёта', 'Остаток, руб.'], rows: p.accounts.length ? p.accounts.map(a => [a.bank || '', a.number || '', { text: money(accountBalance(p, a)), align: 'right' }]) : [[{ text: 'Счетов нет', span: 3 }]], size: 9 } },
    signatureTable(c, fmtDate(cfg.date || todayISO())),
  ];
}

// ---------- Финансовый анализ ----------

function incomeMonthly(p) {
  return sumBy(p.incomes, 'amount_month');
}

function subsistence(p) {
  const kids = p.children.filter(ch => !ch.adult).length;
  return n(p.subsistence?.debtor) + kids * n(p.subsistence?.child) + n(p.expenses?.alimony) + n(p.expenses?.medical) + n(p.expenses?.other);
}

function solvency(p) {
  const income = incomeMonthly(p);
  const need = subsistence(p);
  const surplus = income - need;
  const debts = rtkSummary(p).total.amount;
  const over3y = Math.max(0, surplus) * 36;
  return { income, need, surplus, debts, over3y, share: pct(Math.min(over3y, debts), debts) };
}

function analysisBlocks(p) {
  const c = docCtx(p);
  const a = p.analysis || {};
  const s = rtkSummary(p);
  const sv = solvency(p);
  const assetsValue = sumBy(p.assets.filter(x => !x.excluded), x => n(x.market_value) || n(x.book_value));
  const cash = sumBy(p.accounts, x => accountBalance(p, x));
  const costsDebt = sumBy(p.costs, x => n(x.amount) - costPaid(p, x));
  const answers = p.documents.filter(d => d.answer_summary);
  const section = t => ({ text: t, bold: true, align: 'left', before: 200, after: 80, keep: true });
  return [
    { text: 'АНАЛИЗ ФИНАНСОВОГО СОСТОЯНИЯ', align: 'center', bold: true },
    { text: c.ent ? `должника — ${c.debName}` : `гражданина — ${c.debName}`, align: 'center', bold: true, after: 160 },
    { text: `${c.place ? c.place + ', ' : ''}${fmtDate(a.date || todayISO())}`, align: 'right', after: 160 },
    ...headerLines(c),
    section('1. Общие сведения'),
    c.intro + ' ' + c.auSentence,
    `Анализ проведён ${c.info.roleIns} за период с ${a.period_from ? fmtDate(a.period_from) : c.periodFrom} по ${fmtDate(a.date || todayISO())}${c.info.fl ? ' с учётом Правил проведения арбитражным управляющим финансового анализа, утверждённых постановлением Правительства РФ от 25.06.2003 № 367, применяемых с учётом особенностей банкротства гражданина' : ' в соответствии с Правилами проведения арбитражным управляющим финансового анализа, утверждёнными постановлением Правительства РФ от 25.06.2003 № 367'}.`,
    section('2. Источники информации'),
    answers.length ? { table: { cols: [3, 1.4, 6], head: ['Источник', 'Дата ответа', 'Полученные сведения'], rows: answers.map(d => [d.addressee || '', fmtDate(d.answer_date), d.answer_summary]), size: 9 } } : (a.sources || 'Ответы на запросы арбитражного управляющего, документы, представленные должником, материалы дела о банкротстве.'),
    !c.ent ? section('3. Семейное положение и состав семьи') : null,
    !c.ent ? (p.spouses.length ? p.spouses.map(x => `Супруг(а): ${spouseLine(x)}${x.marriage_date ? `, брак зарегистрирован ${fmtDate(x.marriage_date)}` : ''}${x.divorce_date ? `, расторгнут ${fmtDate(x.divorce_date)}` : ''}.`).join(' ') : 'Сведения о супруге отсутствуют.') + ' ' + (p.children.length ? `Дети: ${p.children.map(ch => [ch.name, ch.birth_date && fmtDate(ch.birth_date)].filter(Boolean).join(', ')).join('; ')}.` : 'Несовершеннолетних детей нет.') : null,
    section(c.ent ? '3. Доходы' : '4. Доходы должника'),
    p.incomes.length ? { table: { cols: [4, 2, 4], head: ['Источник дохода', 'Сумма в месяц, руб.', 'Источник сведений'], rows: p.incomes.map(x => [x.source || '', { text: money(x.amount_month), align: 'right' }, x.info_source || '']), foot: [{ text: 'Итого' }, { text: money(sv.income), align: 'right' }, ''], size: 9 } } : 'Постоянные источники дохода не выявлены.',
    a.income_text || null,
    section(c.ent ? '4. Имущество' : '5. Имущество'),
    `Выявлено имущество общей стоимостью ${money(assetsValue)} руб. (без учёта имущества, исключённого из конкурсной массы); остаток денежных средств на счетах — ${money(cash)} руб.`,
    a.assets_text || null,
    section(c.ent ? '5. Обязательства' : '6. Обязательства'),
    `Требования, включённые в реестр требований кредиторов: ${money(s.total.amount)} руб., в том числе первая очередь — ${money(s.sections.q1.amount)} руб., вторая очередь — ${money(s.sections.q2.amount)} руб., третья очередь — ${money(s.sections.q3s.amount + s.sections.q3u.amount + s.sections.q3m.amount + s.sections.q3f.amount)} руб. (из них обеспеченные залогом — ${money(s.sections.q3s.amount)} руб., санкции — ${money(s.sections.q3f.amount)} руб.). Непогашенные текущие обязательства — ${money(costsDebt)} руб.`,
    a.debts_text || null,
    !c.ent ? section('7. Платёжеспособность') : null,
    !c.ent ? `Ежемесячный доход должника — ${money(sv.income)} руб.; необходимые расходы (прожиточный минимум на должника и несовершеннолетних детей, алименты, лечение, иные) — ${money(sv.need)} руб.; ${sv.surplus >= 0 ? `превышение доходов над расходами — ${money(sv.surplus)} руб. в месяц. За 36 месяцев за счёт этого превышения может быть погашено ${money(Math.min(sv.over3y, sv.debts))} руб., или ${fmtPct(sv.share)} требований, включённых в реестр.` : 'доходы не покрывают необходимых расходов.'}` : null,
    section('Выводы'),
    `Имущества и денежных средств должника ${assetsValue + cash >= costsDebt ? 'достаточно' : 'недостаточно'} для покрытия судебных расходов и расходов на выплату вознаграждения арбитражному управляющему.`,
    a.solvency || (c.ent ? '[Вывод о возможности (невозможности) восстановления платёжеспособности должника.]' : `[Вывод о ${sv.share >= 100 ? 'возможности' : 'невозможности'} восстановления платёжеспособности гражданина и целесообразности ${sv.share >= 100 ? 'утверждения плана реструктуризации долгов' : 'введения процедуры реализации имущества'}.]`),
    a.conclusion || null,
    { text: '', after: 200 },
    signatureTable(c, fmtDate(a.date || todayISO())),
  ];
}

function fictBlocks(p) {
  const c = docCtx(p);
  const a = p.analysis || {};
  return [
    { text: 'ЗАКЛЮЧЕНИЕ', align: 'center', bold: true },
    { text: 'о наличии (отсутствии) признаков фиктивного и преднамеренного банкротства', align: 'center', bold: true, after: 160 },
    { text: `${c.place ? c.place + ', ' : ''}${fmtDate(a.date || todayISO())}`, align: 'right', after: 160 },
    ...headerLines(c),
    c.intro + ' ' + c.auSentence,
    `Проверка проведена в соответствии с Временными правилами проверки арбитражным управляющим наличия признаков фиктивного и преднамеренного банкротства, утверждёнными постановлением Правительства РФ от 27.12.2004 № 855${c.ent ? '' : ', с учётом особенностей банкротства гражданина'}, за период с ${a.period_from ? fmtDate(a.period_from) : c.periodFrom} по ${fmtDate(a.date || todayISO())}.`,
    `Источники информации: ${a.sources || 'ответы регистрирующих органов и кредитных организаций на запросы арбитражного управляющего, документы, представленные должником, материалы дела о банкротстве'}.`,
    a.deals_text ? `Сделки должника за исследуемый период: ${a.deals_text}` : 'Сделки должника за исследуемый период: [перечень проанализированных сделок].',
    { text: 'Выводы:', bold: true, align: 'left' },
    a.fict ? `1. Выявлены признаки фиктивного банкротства: ${a.fict_text || '[обоснование]'}.` : '1. Признаки фиктивного банкротства не выявлены.',
    a.delib ? `2. Выявлены признаки преднамеренного банкротства: ${a.delib_text || '[обоснование]'}.` : '2. Признаки преднамеренного банкротства не выявлены.',
    { text: '', after: 200 },
    signatureTable(c, fmtDate(a.date || todayISO())),
  ];
}

function dealsBlocks(p) {
  const c = docCtx(p);
  const a = p.analysis || {};
  const disputes = (p.disputes || []).filter(d => d.type === 'Оспаривание сделки');
  return [
    { text: 'ЗАКЛЮЧЕНИЕ', align: 'center', bold: true },
    { text: 'о наличии (отсутствии) оснований для оспаривания сделок должника', align: 'center', bold: true, after: 160 },
    { text: `${c.place ? c.place + ', ' : ''}${fmtDate(a.date || todayISO())}`, align: 'right', after: 160 },
    ...headerLines(c),
    c.intro + ' ' + c.auSentence,
    `${c.Role} проанализировал сделки должника, совершённые за период с ${a.period_from ? fmtDate(a.period_from) : c.periodFrom}, на предмет наличия оснований для их оспаривания по статьям 61.2, 61.3 Закона о банкротстве и общим основаниям гражданского законодательства.`,
    a.deals_text ? `Проанализированы сделки: ${a.deals_text}` : 'Проанализированы сделки: [перечень].',
    disputes.length ? `Поданы заявления об оспаривании сделок: ${disputes.map(d => [d.defendant, d.amount && money(d.amount) + ' руб.', d.hearing_date && 'заседание ' + fmtDate(d.hearing_date)].filter(Boolean).join(', ')).join('; ')}.` : null,
    { text: 'Вывод:', bold: true, align: 'left' },
    a.deals ? `Выявлены сделки, подлежащие оспариванию: ${a.deals_challenge || '[перечень и основания]'}.` : 'Сделки, подлежащие оспариванию, не выявлены.',
    { text: '', after: 200 },
    signatureTable(c, fmtDate(a.date || todayISO())),
  ];
}

// ---------- Собрания ----------

TEMPLATES.meeting_notice = {
  group: 'hidden', title: 'Уведомление о собрании', docTitle: 'УВЕДОМЛЕНИЕ', subtitle: 'о проведении собрания',
  body: () => '', attachments: () => [],
};

function meetingWord(m) {
  return m.kind === 'workers' ? 'собрания работников, бывших работников' : 'собрания кредиторов';
}

function meetingNoticeText(p, m) {
  const c = docCtx(p);
  const qs = (m.questions || []).map((q, i) => `${i + 1}. ${q.wording || q.title || ''}`).join('\n');
  const absentee = m.form === 'Заочная (бюллетени)';
  return [
    c.intro + ' ' + c.auSentence,
    `${c.Role} уведомляет о проведении ${meetingWord(m)} должника ${absentee ? 'в форме заочного голосования' : 'в очной форме'}${m.date ? ` ${fmtDate(m.date)}` : ''}${m.time && !absentee ? ` в ${m.time}` : ''}${m.place && !absentee ? ` по адресу: ${m.place}` : ''}.`,
    !absentee && m.reg_time ? `Регистрация участников: ${m.reg_time}.` : '',
    absentee ? `Бюллетени для голосования направляются по адресу: ${m.ballots_address || c.au.postal_address || '[адрес]'}; бюллетени, полученные после ${m.ballots_deadline ? fmtDate(m.ballots_deadline) : '[дата]'}, не учитываются.` : '',
    `Повестка дня:\n${qs || '[вопросы повестки]'}`,
    `С материалами, подлежащими рассмотрению собранием, можно ознакомиться ${m.materials_from ? `с ${fmtDate(m.materials_from)} ` : ''}по адресу: ${m.materials_place || c.au.postal_address || '[адрес]'}${m.materials_time ? `, ${m.materials_time}` : ''}.`,
    'Для участия в собрании при себе необходимо иметь документ, удостоверяющий личность, представителю — также доверенность.',
  ].filter(Boolean).join('\n\n');
}

function meetingRegisterBlocks(p, m) {
  const c = docCtx(p);
  const t = meetingTotals(p, m);
  const workers = m.kind === 'workers';
  const rows = (m.participants || []).map((x, i) => [String(i + 1), x.name || '', [x.rep, x.poa].filter(Boolean).join(', '), workers ? '1' : { text: money(x.amount), align: 'right' }, { text: fmtPct(pct(n(x.amount), t.total)), align: 'right' }, x.present ? 'зарегистрирован' : '', '']);
  return [
    { text: 'ЖУРНАЛ РЕГИСТРАЦИИ УЧАСТНИКОВ', align: 'center', bold: true },
    { text: `${meetingWord(m)} должника — ${c.debName}, ${fmtDate(m.date)}`, align: 'center', after: 160 },
    { table: { cols: [0.5, 4, 3, 1.8, 1.2, 1.6, 1.4], head: ['№', 'Участник', 'Представитель, доверенность', workers ? 'Голосов' : 'Требования, руб.', '% голосов', 'Отметка', 'Подпись'], rows: rows.length ? rows : [[{ text: 'Участников нет', span: 7 }]], foot: [{ text: 'Итого', span: 3 }, workers ? String(rows.length) : { text: money(t.total), align: 'right' }, '100 %', '', ''], size: 9 } },
    { text: `Зарегистрировано участников с ${workers ? 'числом голосов' : 'требованиями на сумму'} ${workers ? sumBy((m.participants || []).filter(x => x.present), 'amount') : money(t.present) + ' руб.'}, что составляет ${fmtPct(t.presentPct)} от общего числа голосов. Собрание ${t.quorum ? 'правомочно' : 'неправомочно (нет кворума)'}.`, align: 'left' },
    signatureTable(c, fmtDate(m.date)),
  ];
}

function meetingBallotsBlocks(p, m) {
  const c = docCtx(p);
  const blocks = [];
  (m.participants || []).forEach((x, i) => {
    if (i) blocks.push({ pageBreak: true });
    blocks.push(
      { text: 'БЮЛЛЕТЕНЬ ДЛЯ ГОЛОСОВАНИЯ', align: 'center', bold: true },
      { text: `на ${m.kind === 'workers' ? 'собрании работников, бывших работников' : 'собрании кредиторов'} должника — ${c.debName}`, align: 'center' },
      { text: `${fmtDate(m.date)}${m.place ? ', ' + m.place : ''}; дело № ${c.caseNo}`, align: 'center', after: 160 },
      { text: `Участник: ${x.name || ''}${x.rep ? `, в лице представителя ${x.rep}${x.poa ? ' (' + x.poa + ')' : ''}` : ''}`, align: 'left' },
      { text: m.kind === 'workers' ? 'Количество голосов: 1' : `Размер требований: ${money(x.amount)} руб.; количество голосов: ${fmtPct(pct(n(x.amount), meetingTotals(p, m).total))}`, align: 'left', after: 120 },
    );
    (m.questions || []).forEach((q, j) => {
      blocks.push({ text: `Вопрос ${j + 1}. ${q.wording || q.title || ''}`, bold: true, align: 'left', before: 80 });
      if (q.decision && !String(q.variants || '').trim()) blocks.push({ text: `Решение, поставленное на голосование: ${q.decision}`, align: 'left' });
      blocks.push({ text: questionOptions(q).map(o => `☐ ${o}`).join('        '), align: 'left', after: 80 });
    });
    blocks.push(
      { text: 'Бюллетень, в котором отмечено более одного варианта по вопросу или не отмечено ни одного, по этому вопросу недействителен.', italic: true, size: 10, align: 'left', before: 120 },
      { text: '\nПодпись участника (представителя): ____________________ / ____________________ /', align: 'left' },
    );
  });
  if (!blocks.length) blocks.push('Нет участников собрания.');
  return blocks;
}

function meetingProtocolBlocks(p, m) {
  const c = docCtx(p);
  const t = meetingTotals(p, m);
  const workers = m.kind === 'workers';
  const qBlocks = (m.questions || []).flatMap((q, i) => {
    const r = questionResult(p, m, q);
    const lines = r.opts.map(o => `«${o}» — ${workers ? r.tally[o] + ' гол.' : money(r.tally[o]) + ' руб.'} (${fmtPct(pct(r.tally[o], t.total))} от общего числа голосов, ${fmtPct(pct(r.tally[o], t.present))} от присутствующих)`).join('\n');
    return [
      { text: `Вопрос ${i + 1}. ${q.wording || q.title || ''}`, bold: true, align: 'left', before: 120, keep: true },
      q.speech ? { text: `Слушали: ${q.speech}`, align: 'both' } : null,
      { text: `Голосовали:\n${lines}`, align: 'left' },
      { text: `${q.majority === 'total' ? 'Решение принимается большинством голосов от общего числа голосов (п. 2 ст. 15 Закона о банкротстве).' : 'Решение принимается большинством голосов от числа голосов присутствующих (п. 1 ст. 15 Закона о банкротстве).'}`, italic: true, size: 10, align: 'left' },
      { text: `Решили: ${r.text}`, bold: true, align: 'both' },
    ];
  });
  return [
    { text: 'ПРОТОКОЛ', align: 'center', bold: true },
    { text: `${meetingWord(m)} должника — ${c.debName}`, align: 'center', bold: true, after: 160 },
    { text: `${m.place || c.place || ''}${m.place || c.place ? ', ' : ''}${fmtDate(m.date)}${m.time ? ', ' + m.time : ''}`, align: 'right', after: 160 },
    `Дело № ${c.caseNo}, ${c.court}. ${c.Role}: ${c.auName}.`,
    `Форма проведения: ${m.form || 'очная'}. ${m.first ? 'Первое собрание. ' : ''}Основание созыва: ${m.basis || `по инициативе ${c.info.roleGen}`}.`,
    `Председатель собрания: ${endDot(m.chair || c.auName)} Секретарь: ${endDot(m.secretary || '[ФИО]')}`,
    workers
      ? `Общее количество работников, бывших работников, имеющих право голоса: ${(m.participants || []).length}. Зарегистрировано: ${(m.participants || []).filter(x => x.present).length}.`
      : `Общая сумма голосующих требований, включённых в реестр требований кредиторов на дату собрания: ${money(t.total)} руб. Зарегистрированы участники с требованиями на сумму ${money(t.present)} руб., что составляет ${fmtPct(t.presentPct)} голосов.`,
    `Собрание ${t.quorum ? 'правомочно: присутствуют участники, обладающие более чем половиной голосов' : 'неправомочно: отсутствует кворум'}${workers ? '' : ' (п. 4 ст. 12 Закона о банкротстве)'}.`,
    { text: 'Повестка дня:', bold: true, align: 'left', before: 120 },
    { text: (m.questions || []).map((q, i) => `${i + 1}. ${q.wording || q.title || ''}`).join('\n') || '—', align: 'left' },
    ...(t.quorum ? qBlocks : []),
    { text: 'Приложения: журнал регистрации участников; бюллетени для голосования; доверенности представителей; уведомления о проведении собрания; материалы к собранию.', align: 'both', before: 160 },
    { table: { cols: [1, 1], borders: false, size: 12, rows: [[{ text: 'Председатель собрания' }, { text: `____________________ ${m.chair ? initials(m.chair) : c.auShort}`, align: 'right' }], [{ text: 'Секретарь собрания' }, { text: `____________________ ${m.secretary ? initials(m.secretary) : ''}`, align: 'right' }]] } },
  ].filter(Boolean);
}

function meetingResultText(p, m) {
  const c = docCtx(p);
  const t = meetingTotals(p, m);
  return [
    `${c.Role} ${c.auName} сообщает о результатах ${meetingWord(m)} должника — ${c.debName} (${c.ident}), дело № ${c.caseNo}, ${c.court}, состоявшегося ${fmtDate(m.date)}${m.place ? ' по адресу: ' + m.place : ''}.`,
    t.quorum ? (m.questions || []).map((q, i) => `По вопросу ${i + 1} «${q.wording || q.title || ''}»: ${questionResult(p, m, q).text}`).join('\n') : 'Собрание не состоялось в связи с отсутствием кворума.',
  ].join('\n\n');
}

function postalRegistryBlocks(p, docs) {
  const c = docCtx(p);
  return [
    { text: 'СПИСОК ПОЧТОВЫХ ОТПРАВЛЕНИЙ', align: 'center', bold: true },
    { text: `от ${fmtDate(todayISO())}`, align: 'center', after: 160 },
    { text: `Отправитель: ${c.role} ${c.auName}, ${c.au.postal_address || ''}`, align: 'left' },
    { text: `Дело № ${c.caseNo}, должник: ${c.debShort}`, align: 'left', after: 120 },
    { table: { cols: [0.5, 4, 5, 2.5, 2, 2.5], head: ['№', 'Адресат', 'Адрес', 'Документ', 'Вид отправления', 'Почтовый идентификатор'], rows: docs.map((d, i) => [String(i + 1), d.addressee || '', d.address || '', [d.number && 'исх. № ' + d.number, d.date && 'от ' + fmtDate(d.date)].filter(Boolean).join(' '), d.send_method || 'Почта России, заказное', d.track || '']), size: 9 } },
    { text: `Всего отправлений: ${docs.length}.`, align: 'left' },
    signatureTable(c, fmtDate(todayISO())),
  ];
}

// Скачивание .docx.
function saveDocx(name, blocks, opts) {
  download(safeFileName(name) + '.docx', makeDocx(blocks, opts), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
