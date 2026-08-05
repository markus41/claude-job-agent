// Human-readable application tracker: data/applications.xlsx + .csv, kept
// live by the store after every application change. The .xlsx is a minimal
// but valid SpreadsheetML workbook in a STORED (uncompressed) zip — small
// enough volumes that dependencies aren't worth it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { ensureDir } from './util.mjs';

// --- CRC32 (standard polynomial, table-driven) --------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// --- Minimal ZIP writer (STORE method only) ------------------------------------
function zipStore(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    chunks.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); // central directory signature
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0, 8); // flags
    cen.writeUInt16LE(0, 10); // method
    cen.writeUInt16LE(0, 12); // time
    cen.writeUInt16LE(0, 14); // date
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(0, 30); // extra + comment lengths
    cen.writeUInt16LE(0, 34); // disk number
    cen.writeUInt16LE(0, 36); // internal attrs
    cen.writeUInt32LE(0, 38); // external attrs
    cen.writeUInt32LE(offset, 42); // local header offset
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// --- Spreadsheet content ---------------------------------------------------------
const xml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Strip control characters that are illegal in XML 1.0 (keep \t \n \r).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export const COLUMNS = [
  { header: 'App ID', width: 14, value: (r) => r.id },
  { header: 'Company', width: 22, value: (r) => r.company },
  { header: 'Role', width: 40, value: (r) => r.title },
  { header: 'Status', width: 12, value: (r) => r.status },
  { header: 'Fit score', width: 10, value: (r) => r.score ?? '' },
  { header: 'Verdict', width: 10, value: (r) => r.verdict ?? '' },
  { header: 'Created', width: 12, value: (r) => (r.createdAt ?? '').slice(0, 10) },
  { header: 'Submitted', width: 12, value: (r) => (r.submittedAt ?? '').slice(0, 10) },
  { header: 'Next follow-up', width: 14, value: (r) => r.nextFollowUp },
  { header: 'Last note', width: 44, value: (r) => r.lastNote },
  { header: 'Apply URL', width: 52, value: (r) => r.applyUrl ?? '' },
  { header: 'Folder', width: 40, value: (r) => (r.dir ? `applications/${r.dir}` : '') },
];

function toRows(appsMap, jobsMap) {
  return Object.values(appsMap)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((a) => {
      const job = jobsMap?.[a.jobId];
      const history = a.history ?? [];
      const lastWithNote = [...history].reverse().find((h) => h.note);
      const doneSet = new Set(a.followUps?.done ?? []);
      const nextFollowUp = (a.followUps?.due ?? []).filter((d) => !doneSet.has(d)).sort()[0];
      return {
        id: a.id,
        company: a.company,
        title: a.title,
        status: a.status,
        score: job?.score?.value,
        verdict: job?.score?.verdict,
        createdAt: a.createdAt,
        submittedAt: a.submittedAt,
        nextFollowUp: nextFollowUp ? nextFollowUp.slice(0, 10) : '',
        lastNote: lastWithNote?.note ?? '',
        applyUrl: a.applyUrl,
        dir: a.dir,
      };
    });
}

function sheetXml(rows) {
  const cols = COLUMNS.map(
    (c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`
  ).join('');
  const cell = (v) => `<c t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const headerRow = `<row r="1">${COLUMNS.map((c) => cell(c.header)).join('')}</row>`;
  const dataRows = rows
    .map((r, i) => `<row r="${i + 2}">${COLUMNS.map((c) => cell(c.value(r))).join('')}</row>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${headerRow}${dataRows}</sheetData>` +
    '</worksheet>'
  );
}

export function buildXlsx(appsMap, jobsMap) {
  const rows = toRows(appsMap, jobsMap);
  const entries = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>'
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>'
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Applications" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>'
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>'
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(rows)) },
  ];
  return zipStore(entries);
}

export function buildCsv(appsMap, jobsMap) {
  const rows = toRows(appsMap, jobsMap);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    COLUMNS.map((c) => esc(c.header)).join(','),
    ...rows.map((r) => COLUMNS.map((c) => esc(c.value(r))).join(',')),
  ];
  // BOM so Excel reads UTF-8 correctly; CRLF because Excel.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// Called by the store after every application write. Failures must never
// break a state operation — the tracker is a view, not the ledger.
export function writeTrackerFiles(appsMap, jobsMap) {
  const p = paths();
  ensureDir(p.dataDir);
  const xlsxPath = join(p.dataDir, 'applications.xlsx');
  const csvPath = join(p.dataDir, 'applications.csv');
  writeFileSync(xlsxPath, buildXlsx(appsMap, jobsMap));
  writeFileSync(csvPath, buildCsv(appsMap, jobsMap));
  return { xlsxPath, csvPath };
}
