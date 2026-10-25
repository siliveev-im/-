// Хранилище CRM: процедуры и настройки (crm.json), пользователи (users.json),
// журнал действий (журнал.jsonl) и ежедневные архивные копии.
import fs from 'node:fs';
import path from 'node:path';

const KEEP_BACKUPS = 60;
// Списки внутри процедуры. Тот же перечень — PROC_LISTS в app/app.js.
const LISTS = [
  'reports', 'claims', 'involved', 'hearings', 'disputes', 'publications', 'accounts', 'tasks',
  'spouses', 'children', 'incomes', 'counterparties', 'costs', 'payments', 'assets', 'receivables',
  'measures', 'workers', 'complaints', 'documents', 'meetings', 'claim_changes',
];
const OBJECTS = ['debtor', 'court', 'dates', 'applicant', 'rtk', 'analysis', 'report_cfg', 'subsistence', 'expenses'];

function emptyData() {
  return {
    version: 2,
    updated_at: new Date().toISOString(),
    settings: {
      report_period_default: 3,
      au_docs: [
        { id: 'policy', title: 'Договор страхования ответственности', until: '' },
        { id: 'conviction', title: 'Справка об отсутствии судимости', until: '' },
        { id: 'disqual', title: 'Справка об отсутствии дисквалификации', until: '' },
        { id: 'training', title: 'Ежегодное повышение квалификации', until: '' },
      ],
      au_profile: {},
      addressees: {},
      doc_templates: [],
    },
    procedures: [],
  };
}

function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

export function normalizeProcedure(p) {
  for (const k of LISTS) p[k] = Array.isArray(p[k]) ? p[k] : [];
  for (const k of OBJECTS) p[k] = p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) ? p[k] : {};
  p.assignees = Array.isArray(p.assignees) ? p.assignees : [];
  p.rev = Number(p.rev) || 1;
  return p;
}

export function openStore(dataDir) {
  const dataFile = path.join(dataDir, 'crm.json');
  const usersFile = path.join(dataDir, 'users.json');
  const auditFile = path.join(dataDir, 'журнал.jsonl');
  const archiveDir = path.join(dataDir, 'архив');
  fs.mkdirSync(dataDir, { recursive: true });

  const data = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : emptyData();
  data.settings = data.settings || emptyData().settings;
  data.procedures = (data.procedures || []).map(normalizeProcedure);
  const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, 'utf8')).users || [] : [];

  // Перед первой записью за день кладём копию прежнего файла в архив.
  function backupOncePerDay(file, prefix) {
    if (!fs.existsSync(file)) return;
    fs.mkdirSync(archiveDir, { recursive: true });
    const day = new Date().toLocaleDateString('sv-SE');
    const target = path.join(archiveDir, `${prefix}-${day}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(file, target);
    const old = fs.readdirSync(archiveDir).filter(f => f.startsWith(prefix + '-') && f.endsWith('.json')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(archiveDir, f));
  }

  return {
    data,
    users,
    dataFile,
    tokenFile: path.join(dataDir, '.import-token'),

    saveData() {
      backupOncePerDay(dataFile, 'crm');
      data.updated_at = new Date().toISOString();
      writeJsonAtomic(dataFile, data);
    },

    saveUsers() {
      backupOncePerDay(usersFile, 'users');
      writeJsonAtomic(usersFile, { users });
    },

    audit(entry) {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      fs.appendFileSync(auditFile, line + '\n', 'utf8');
    },

    readAudit({ limit = 500, userId = '', procedureId = '' } = {}) {
      if (!fs.existsSync(auditFile)) return [];
      const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
      const out = [];
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        const e = JSON.parse(lines[i]);
        if (userId && e.user_id !== userId) continue;
        if (procedureId && e.procedure_id !== procedureId) continue;
        out.push(e);
      }
      return out;
    },
  };
}

// Что изменилось в карточке: простые поля — «было → стало», списки — сколько записей добавлено, удалено, изменено.
export function diffProcedure(before, after) {
  const changes = [];
  const skip = new Set(['rev', 'updated_at', 'updated_by', 'created_at', 'imported_at', ...LISTS]);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    const a = before?.[k];
    const b = after?.[k];
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    if (isObj(a) || isObj(b)) {
      for (const sub of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
        const x = a?.[sub] ?? '';
        const y = b?.[sub] ?? '';
        if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ f: `${k}.${sub}`, from: x, to: y });
      }
    } else if (JSON.stringify(a ?? '') !== JSON.stringify(b ?? '')) {
      changes.push({ f: k, from: a ?? '', to: b ?? '' });
    }
  }
  for (const k of LISTS) {
    const a = new Map((before?.[k] || []).map(r => [r.id, JSON.stringify(r)]));
    const b = new Map((after?.[k] || []).map(r => [r.id, JSON.stringify(r)]));
    let added = 0, removed = 0, changed = 0;
    for (const [id, v] of b) if (!a.has(id)) added++; else if (a.get(id) !== v) changed++;
    for (const id of a.keys()) if (!b.has(id)) removed++;
    if (added || removed || changed) changes.push({ f: k, added, removed, changed });
  }
  return changes;
}
