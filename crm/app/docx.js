'use strict';

// Сборка документов Word (.docx) прямо в браузере, без внешних библиотек.
// Документ описывается списком блоков:
//   'текст'                                  — абзац по ширине с красной строкой;
//   { text, align, bold, italic, indent, size, after, before, keep }
//                                            — абзац с настройками (align: left | center | right | both);
//   { runs: [{ text, bold, italic }], ... }  — абзац из нескольких кусков текста;
//   { table: { cols, head, rows, foot, borders, size } } — таблица (cols — доли ширины колонок);
//   { pageBreak: true }                      — новая страница.
// Перевод строки внутри текста даёт перенос строки внутри абзаца.

const DOCX_PAGE_WIDTH = 9355; // ширина текста A4 в твипах при полях 3 / 1,5 см
const DOCX_LANDSCAPE_WIDTH = 14570;
let docxWidth = DOCX_PAGE_WIDTH;

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ZIP без сжатия: Word такие архивы открывает.
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // символы, недопустимые в XML, Word не откроет
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function runXml(r, base = {}) {
  const o = { ...base, ...r };
  // Порядок свойств задан схемой OOXML, иначе Word считает файл повреждённым.
  const props = [
    o.bold ? '<w:b/>' : '',
    o.italic ? '<w:i/>' : '',
    o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : '',
    o.underline ? '<w:u w:val="single"/>' : '',
  ].join('');
  const lines = String(o.text ?? '').split('\n');
  return lines.map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>`).join('');
}

function paraXml(b, inTable = false) {
  if (typeof b === 'string') b = { text: b };
  const align = b.align || (inTable ? 'left' : 'both');
  const indent = b.indent ?? (!inTable && align === 'both');
  const ind = [b.left ? `w:left="${b.left}"` : '', indent ? 'w:firstLine="709"' : ''].filter(Boolean).join(' ');
  const ppr = [
    b.keep ? '<w:keepNext/>' : '',
    `<w:spacing w:before="${b.before ?? 0}" w:after="${b.after ?? (inTable ? 0 : 60)}" w:line="${inTable ? 240 : 264}" w:lineRule="auto"/>`,
    ind ? `<w:ind ${ind}/>` : '',
    `<w:jc w:val="${align}"/>`,
  ].join('');
  const runs = b.runs ? b.runs.map(r => runXml(r, b)).join('') : runXml(b);
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

// После таблицы Word требует абзац; делаем его крошечным, чтобы он не выталкивал пустую страницу.
const TINY_PARA = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>';

function tableXml(t) {
  const ncols = Math.max(t.cols?.length || 0, ...(t.head ? [t.head.length] : []), ...(t.rows || []).map(r => r.length), 1);
  const ratios = t.cols && t.cols.length === ncols ? t.cols : Array(ncols).fill(1);
  const total = ratios.reduce((s, x) => s + x, 0);
  const widths = ratios.map(r => Math.floor((r / total) * docxWidth));
  const size = t.size || 10;
  const border = t.borders === false ? 'nil' : 'single';
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="${border}" w:sz="4" w:space="0" w:color="000000"/>`).join('');
  const cell = (v, i, opts = {}) => {
    const c = v && typeof v === 'object' && !Array.isArray(v) ? v : { text: v };
    const span = c.span || 1;
    const w = widths.slice(i, i + span).reduce((s, x) => s + x, 0);
    const paras = String(c.text ?? '').split('\n\n').map(text => paraXml({ text, align: c.align || opts.align || 'left', bold: c.bold ?? opts.bold, size }, true)).join('');
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${opts.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ''}</w:tcPr>${paras}</w:tc>`;
  };
  const row = (cells, opts) => {
    let i = 0;
    return `<w:tr>${opts.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map(c => {
      const x = cell(c, i, opts);
      i += (c && typeof c === 'object' && c.span) || 1;
      return x;
    }).join('')}</w:tr>`;
  };
  return `<w:tbl><w:tblPr><w:tblW w:w="${docxWidth}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>
    <w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>
    ${t.head ? row(t.head, { header: true, bold: true, align: 'center', shade: t.borders !== false }) : ''}
    ${(t.rows || []).map(r => row(r, {})).join('')}
    ${t.foot ? row(t.foot, { bold: true }) : ''}</w:tbl>${TINY_PARA}`;
}

function blocksXml(blocks) {
  return blocks.filter(b => b != null && b !== false).map(b => {
    if (b.table) return tableXml(b.table);
    if (b.pageBreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    return paraXml(b);
  }).join('');
}

function makeDocx(blocks, { landscape = false, fontSize = 12 } = {}) {
  docxWidth = landscape ? DOCX_LANDSCAPE_WIDTH : DOCX_PAGE_WIDTH;
  const pg = landscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="850" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>';
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${blocksXml(blocks)}<w:sectPr>${pg}</w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${ns}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
      <w:sz w:val="${fontSize * 2}"/><w:szCs w:val="${fontSize * 2}"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>
      <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
  ]);
}

// Имя файла без символов, которые Windows не разрешает.
function safeFileName(s) {
  return String(s || 'документ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
