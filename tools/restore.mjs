// Восстановление сайта и CRM из Markdown-снимка: node restore.mjs <снимок.md> [папка]
// Берёт каждый файл из раздела «Файлы» (заголовок ### `путь` и блок кода под ним) и записывает его на диск.
import fs from 'node:fs';
import path from 'node:path';

const [mdFile, outDir = 'siliveev-site'] = process.argv.slice(2);
if (!mdFile) {
  console.log('Использование: node restore.mjs <снимок.md> [папка, по умолчанию siliveev-site]');
  process.exit(1);
}

const lines = fs.readFileSync(mdFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
const start = lines.indexOf('<!-- files -->');
if (start < 0) {
  console.log('В файле нет раздела с файлами (метка <!-- files -->). Это точно снимок сайта?');
  process.exit(1);
}

const root = path.resolve(outDir);
let count = 0;
for (let i = start + 1; i < lines.length; i++) {
  const heading = lines[i].match(/^### `(.+)`$/);
  const open = heading && lines[i + 1]?.match(/^(`{3,})[\w-]*$/);
  if (!open) continue;
  const rel = heading[1];
  const target = path.resolve(root, rel);
  if (path.isAbsolute(rel) || rel.split('/').includes('..') || !target.startsWith(root + path.sep)) {
    throw new Error(`Недопустимый путь в снимке: ${rel}`);
  }
  const fence = open[1];
  const body = [];
  let j = i + 2;
  while (j < lines.length && lines[j] !== fence) body.push(lines[j++]);
  if (j >= lines.length) throw new Error(`Не закрыт блок кода у файла ${rel}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body.join('\n') + '\n', 'utf8');
  count++;
  i = j;
}

console.log(`Восстановлено файлов: ${count} → ${root}`);
console.log('Дальше: cd в эту папку, node build.mjs, затем node serve.mjs (или «Сайт и CRM.cmd»).');
