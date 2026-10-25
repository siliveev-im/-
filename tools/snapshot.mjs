// Снимок сайта и CRM в один Markdown-файл: инструкции и полный код всех исходников.
// node tools/snapshot.mjs [куда сохранить.md] — по умолчанию Desktop\Claude\Снимки\сайт-и-crm-ГГГГ-ММ-ДД.md
// Данные CRM (crm/данные) в снимок не попадают: там персональные данные должников.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const day = new Date().toLocaleDateString('sv-SE');
const dayRu = day.split('-').reverse().join('.');
const outFile = path.resolve(process.argv[2] || path.join(root, '..', 'Снимки', `сайт-и-crm-${day}.md`));

const SKIP = new Set(['dist', 'dist-preview', 'node_modules', '.git', 'crm/данные']);
const LANG = { '.mjs': 'js', '.js': 'js', '.css': 'css', '.html': 'html', '.md': 'markdown', '.php': 'php', '.cmd': 'bat', '.svg': 'xml', '.json': 'json' };
const FIRST = ['README.md', 'config.mjs', 'build.mjs', 'build-preview.mjs', 'serve.mjs', 'Сайт и CRM.cmd', 'tools/', 'src/', 'crm/README.md', 'crm/server.mjs', 'crm/lib/', 'crm/tools/', 'crm/app/index.html', 'crm/app/app.js', 'crm/app/style.css', 'crm/app/vendor/'];

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (SKIP.has(rel)) continue;
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (!rel.endsWith('.tmp')) out.push(rel);
  }
  return out;
}

const rank = rel => {
  const i = FIRST.findIndex(p => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
  return i < 0 ? FIRST.length : i;
};
const files = walk(root).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

// Ограда блока кода длиннее любой серии обратных кавычек внутри файла, чтобы README с примерами не ломали разметку.
function fenceFor(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map(s => s.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const entries = files.map(rel => {
  const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  return { rel, text, lines: text.split('\n').length, lang: LANG[path.extname(rel)] || '' };
});
const restoreCode = fs.readFileSync(path.join(root, 'tools', 'restore.mjs'), 'utf8').trim();
const totalLines = entries.reduce((s, e) => s + e.lines, 0);
const snapshotName = path.basename(outFile);

const md = `# Сайт и CRM Ильи Силивеева — снимок от ${dayRu}

В этом файле полный код сайта и CRM с кабинетами помощников, а также инструкции, как всё развернуть заново: ${entries.length} файлов, ${totalLines.toLocaleString('ru-RU')} строк.

**Что в снимок не входит:**
- папки \`dist/\` и \`dist-preview/\` — готовый сайт, он собирается командой \`node build.mjs\`;
- папка \`crm/данные/\` — процедуры, учётные записи, журнал. Там персональные данные должников, их храните отдельно (см. «Данные CRM»).

## Что это

- **Сайт.** Статический: 13 страниц, 3 статьи, форма заявки (\`send.php\`), документы по персональным данным. Все контакты и реквизиты — в \`config.mjs\`. Сборка — \`build.mjs\`, версия для показа — \`build-preview.mjs\`.
- **CRM арбитражного управляющего** по адресу \`/crm/\`. Её отдаёт тот же \`serve.mjs\`. Ссылка «Вход для сотрудников» в подвале сайта.
  - Процедуры, отчёты и собрания, требования кредиторов, привлечённые лица, заседания, судебные споры, публикации, счета, задачи, заметки.
  - Сроки отчётов, сводка, выгрузка в Excel.
  - Владелец и помощники. Помощник видит только назначенные ему процедуры.
  - Вход по паролю и коду из приложения (Яндекс Ключ, Google Authenticator).
  - Журнал действий и история каждой карточки.
  - Разовый импорт из личного кабинета ААУ «СИРИУС».
- Внешних зависимостей нет, кроме библиотеки QR-кодов \`crm/app/vendor/qrcode.js\` (qrcode-generator 1.4.4, MIT, Kazuhiko Arase). Она включена в снимок целиком.

## Что нужно

- Компьютер с **Node.js 22 или новее** (проверено на 24): https://nodejs.org.
- Интернет для работы не нужен. Сайт подгружает только шрифты Google.

## Как развернуть из этого снимка

1. Сохраните код из блока ниже в файл \`restore.mjs\` рядом с этим снимком.
2. В той же папке выполните:

   \`\`\`
   node restore.mjs "${snapshotName}" siliveev-site
   \`\`\`

3. Перейдите в папку и соберите сайт:

   \`\`\`
   cd siliveev-site
   node build.mjs
   \`\`\`

4. Запустите сайт и CRM:

   \`\`\`
   node serve.mjs
   \`\`\`

   В Windows можно просто дважды щёлкнуть \`Сайт и CRM.cmd\`.
5. Откройте сайт по адресу http://127.0.0.1:5173, а CRM — по адресу http://127.0.0.1:5173/crm/.

Скрипт восстановления:

${fenceFor(restoreCode)}js
${restoreCode}
${fenceFor(restoreCode)}

Можно и вручную: под заголовком с путём файла лежит его полный текст, его достаточно скопировать в файл с этим именем.

## Данные CRM

CRM хранит всё в \`crm/данные/\`:

| Файл | Что в нём |
|---|---|
| \`crm.json\` | процедуры и настройки |
| \`users.json\` | учётные записи: хеши паролей и секреты кодов |
| \`журнал.jsonl\` | журнал действий |
| \`архив/\` | ежедневные копии |

- Чтобы перенести рабочую базу, скопируйте эту папку из старой установки целиком.
- Без неё CRM начнёт с пустой базы и при первом открытии предложит создать владельца. Сделать это можно только на том компьютере, где она запущена.
- Папку с данными не кладите в Obsidian, GitHub и облака.

## Как пользоваться

- **Сайт.** Тексты лежат в \`src/pages/\`, контакты и реквизиты — в \`config.mjs\`. После правок выполните \`node build.mjs\`. Что заполнить перед публикацией и как опубликовать, написано в \`README.md\` ниже.
- **CRM.**
  - Первый вход, добавление помощников и назначение процедур описаны в \`crm/README.md\` ниже.
  - Там же журнал, защита и восстановление доступа: команда \`node crm/tools/reset-access.mjs ЛОГИН\` при остановленном сервере.
- **Новый снимок** после изменений:

  \`\`\`
  node tools/snapshot.mjs
  \`\`\`

  Файл появится в папке \`Снимки\` рядом с проектом.

## Доступ из интернета

Сейчас \`serve.mjs\` слушает только 127.0.0.1, то есть работает только на этом компьютере. Чтобы помощники работали удалённо, нужно:

1. Взять VPS в России: Node.js на обычном PHP-хостинге не запустить.
2. Запустить там \`node serve.mjs\` как службу.
3. Поставить перед ним nginx с HTTPS (Let's Encrypt).
4. Задать переменную \`TRUST_PROXY=1\`.
5. Перенести \`crm/данные\` вместе с уже созданным владельцем.

Кроме того, понадобятся:
- уведомление в Роскомнадзор об обработке персональных данных;
- обязательства помощников о неразглашении.

## Состав снимка

| Файл | Строк |
|---|---:|
${entries.map(e => `| \`${e.rel}\` | ${e.lines} |`).join('\n')}

## Файлы

<!-- files -->

${entries.map(e => {
  const fence = fenceFor(e.text);
  return `### \`${e.rel}\`\n${fence}${e.lang}\n${e.text}\n${fence}\n`;
}).join('\n')}`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, md, 'utf8');
console.log(`Снимок: ${outFile}`);
console.log(`Файлов: ${entries.length}, строк кода: ${totalLines}, размер: ${(Buffer.byteLength(md) / 1024).toFixed(0)} КБ`);
