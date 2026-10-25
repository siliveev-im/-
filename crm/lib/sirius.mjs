// Перевод выгрузки из личного кабинета ААУ «СИРИУС» в формат CRM.
import { randomUUID } from 'node:crypto';

const PROCEDURE_TYPES = {
  2: 'Наблюдение',
  3: 'Финансовое оздоровление',
  4: 'Внешнее управление',
  5: 'Конкурсное производство',
  6: 'Реструктуризация долгов гражданина',
  7: 'Реализация имущества гражданина',
};

const STATUSES = { 2: 'active', 3: 'completed', 4: 'terminated', 5: 'released', 6: 'removed' };

const REPORT_STATUSES = {
  approved: 'Одобрено',
  moderation: 'На модерации',
  revision: 'На доработке',
  rejected: 'Отклонено',
};

// «21.10.2026» → «2026-10-21»; пустые и нулевые значения → ''.
export function isoDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

// «А19-23073/2020 И.А. Волкова» → номер дела и судья.
function splitCase(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^([АA]\d{2,3}-\d+\/\d{4})\s*(.*)$/);
  return m ? { case_number: m[1].replace(/^A/, 'А'), judge: m[2].trim() } : { case_number: s, judge: '' };
}

function applicantType(raw) {
  if (!raw) return '';
  if (/Individual/.test(raw)) return 'физлицо';
  if (/Entity/.test(raw)) return 'юрлицо';
  return String(raw);
}

function cleanNum(v) {
  return v && v !== '0' ? String(v) : '';
}

function convertProcedure(p, lists) {
  const d = p.debtor || {};
  const categories = Object.fromEntries((lists?.debtor_categories || []).map(c => [c.id, c.text]));
  const sending = Object.fromEntries((lists?.sending_types || []).map(c => [c.id, c.text]));
  const { case_number, judge } = splitCase(p.case_number);
  const status = STATUSES[p.procedure_status_id] || 'active';
  return {
    sirius_id: p.sid,
    debtor_type: p.dt === 'ent' ? 'ent' : 'ind',
    debtor: {
      name: d.name || d.legalname || '',
      full_name: d.legalname && d.legalname !== d.name ? d.legalname : '',
      inn: d.inn || '',
      ogrn: cleanNum(d.ogrn) || cleanNum(d.ogrnip),
      kpp: d.kpp || '',
      snils: d.snils || '',
      birth_date: isoDate(d.birth_date),
      birth_place: d.birth_place || '',
      address: d.registration_address || d.legal_address || '',
      okved: d.main_okved || '',
    },
    debtor2: p.debtor2 ? { name: p.debtor2.name || p.debtor2.legalname || '', inn: p.debtor2.inn || '' } : null,
    court: { name: p.court?.name || '', code: p.court?.code || '' },
    case_number,
    judge,
    case_url: p.case_url || (case_number ? `https://kad.arbitr.ru/Card?number=${encodeURIComponent(case_number)}` : ''),
    procedure_type: PROCEDURE_TYPES[p.procedure_type_id] || '',
    debtor_category: categories[p.debtor_category_id] || '',
    status,
    status_note: p.status_name || '',
    is_io: !!p.au_is_io,
    dates: {
      application_accept: isoDate(p.application_accept_date),
      introduction: isoDate(p.introduction_date),
      introduction_motivated: isoDate(p.introduction_motivation_date),
      appointment: isoDate(p.au_assign_date || p.appointment_date),
      appointment_motivated: isoDate(p.motivation_date),
      final_hearing: isoDate(p.sz_date),
      completion: isoDate(p.completion_date),
      ruling: isoDate(p.ruling_date),
      docs_sending: isoDate(p.docs_sending_date),
    },
    docs_sending_type: sending[p.sending_type_id] || '',
    applicant: p.applicant
      ? { type: applicantType(p.applicant_type), name: p.applicant.name || p.applicant.legalname || '', inn: p.applicant.inn || '' }
      : { type: applicantType(p.applicant_type), name: '', inn: '' },
    debtor_is_applicant: !!p.debtor_is_applicant,
    report_period_months: p.report_deadline_monthly ? 1 : (Number(p.report_deadline) || 3),
    next_report_date: isoDate(p.next_report_date),
    book_value: p.book_value_from_au ?? p.book_value ?? '',
    book_value_date: isoDate(p.book_value_from_au_date || p.book_value_date),
    comment: p.text || '',
    reports: (p.reports || []).map(r => ({
      id: randomUUID(),
      meeting_date: isoDate(r.date),
      report_date: isoDate(r.report_date),
      agenda: r.agenda || '',
      is_report: !!r.is_report,
      is_meeting: !!r.meeting,
      is_final: !!r.final_report,
      out_of_time: !!r.out_of_time,
      sro_status: REPORT_STATUSES[r.status] || r.status || '',
      files: (r.files || []).join('; '),
      note: r.reject_reason || r.revision_reason || '',
      source: 'sirius',
    })),
  };
}

export function convertSiriusExport(exported) {
  return (exported.procedures || []).map(p => convertProcedure(p, exported.lists));
}

const SUBLISTS = ['reports', 'claims', 'involved', 'hearings', 'disputes', 'publications', 'accounts', 'tasks'];

function reportKey(r) {
  return [r.meeting_date, r.report_date, (r.agenda || '').trim().toLowerCase()].join('|');
}

// Новые процедуры добавляет, уже загруженные обновляет по номеру карточки в Сириусе.
// Свои записи пользователя (требования, задачи, заметки и т. п.) не трогает.
export function mergeProcedures(data, incoming) {
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const existing = data.procedures.find(p => p.sirius_id && p.sirius_id === inc.sirius_id);
    if (!existing) {
      const proc = { id: randomUUID(), ...inc, source: 'sirius', imported_at: now, created_at: now, updated_at: now, notes: '', assignees: [], rev: 1 };
      for (const k of SUBLISTS) proc[k] = proc[k] || [];
      data.procedures.push(proc);
      added++;
      continue;
    }
    const { reports, ...fields } = inc;
    // Вложенные объекты дополняем, а не заменяем: в карточке есть поля, которых нет в Сириусе (паспорт, адрес суда и т. п.).
    for (const k of ['debtor', 'court', 'dates', 'applicant']) {
      if (fields[k] && existing[k]) fields[k] = { ...existing[k], ...Object.fromEntries(Object.entries(fields[k]).filter(([, v]) => v !== '' && v != null)) };
    }
    Object.assign(existing, fields, { imported_at: now, updated_at: now, rev: (Number(existing.rev) || 1) + 1 });
    const known = new Set((existing.reports || []).map(reportKey));
    existing.reports = existing.reports || [];
    for (const r of reports) if (!known.has(reportKey(r))) existing.reports.push(r);
    updated++;
  }
  return { added, updated, total: data.procedures.length };
}
