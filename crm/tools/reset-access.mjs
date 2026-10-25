// Восстановление доступа, если потерян телефон с кодом или забыт пароль.
// Запускать при закрытой CRM (иначе сервер перезапишет файл пользователей):
//   node crm/tools/reset-access.mjs <логин>              — сбросить код входа
//   node crm/tools/reset-access.mjs <логин> --password   — сбросить и код, и пароль (выдаст временный)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, temporaryPassword } from '../lib/auth.mjs';

const dataDir = process.env.CRM_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'данные');
const usersFile = path.join(dataDir, 'users.json');
const [login, flag] = process.argv.slice(2);

if (!login) {
  console.log('Укажите логин: node crm/tools/reset-access.mjs <логин> [--password]');
  process.exit(1);
}
if (!fs.existsSync(usersFile)) {
  console.log('Пользователей ещё нет: откройте CRM и создайте владельца.');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
const user = db.users.find(u => u.login.toLowerCase() === login.toLowerCase());
if (!user) {
  console.log(`Логин «${login}» не найден. Есть: ${db.users.map(u => u.login).join(', ')}`);
  process.exit(1);
}

user.totp_enabled = false;
user.totp_secret = null;
user.totp_last = -1;
user.active = true;
let temp = '';
if (flag === '--password') {
  temp = temporaryPassword();
  user.pass = hashPassword(temp);
  user.must_change_password = true;
}
fs.copyFileSync(usersFile, usersFile + '.before-reset');
fs.writeFileSync(usersFile, JSON.stringify(db, null, 1), 'utf8');

console.log(`Готово: у «${user.name}» сброшен код входа${temp ? ' и пароль' : ''}.`);
if (temp) console.log(`Временный пароль: ${temp}`);
console.log('Запустите CRM и войдите: приложение попросит подключить код заново.');
