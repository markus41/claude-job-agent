import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-wb-'));

const { buildCsv, buildXlsx, COLUMNS } = await import('../src/lib/workbook.mjs');

const APPS = {
  'app-aaaa1111': {
    id: 'app-aaaa1111',
    jobId: 'greenhouse:acmecorp:1',
    company: 'Acme Corp, "Ltd"',
    companySlug: 'acmecorp',
    title: 'Senior Engineer <Platform>',
    applyUrl: 'https://boards.greenhouse.io/acmecorp/jobs/1',
    dir: 'acmecorp-senior-engineer-aaaa1111',
    status: 'submitted',
    createdAt: '2026-08-01T10:00:00.000Z',
    submittedAt: '2026-08-02T11:00:00.000Z',
    history: [
      { status: 'packaged', at: '2026-08-01T10:00:00.000Z', note: '' },
      { status: 'submitted', at: '2026-08-02T11:00:00.000Z', note: 'confirmation #12345\nreceived' },
    ],
    followUps: { due: ['2026-08-09T11:00:00.000Z', '2026-08-16T11:00:00.000Z'], done: ['2026-08-09T11:00:00.000Z'] },
  },
  'app-bbbb2222': {
    id: 'app-bbbb2222',
    jobId: 'lever:betaworks:2',
    company: 'Betaworks',
    companySlug: 'betaworks',
    title: 'Staff Product Engineer',
    applyUrl: 'https://jobs.lever.co/betaworks/2/apply',
    dir: 'betaworks-staff-product-engineer-bbbb2222',
    status: 'queued',
    createdAt: '2026-08-03T09:00:00.000Z',
    submittedAt: null,
    history: [{ status: 'packaged', at: '2026-08-03T09:00:00.000Z', note: 'application package created' }],
    followUps: { due: [], done: [] },
  },
};

const JOBS = {
  'greenhouse:acmecorp:1': { score: { value: 88, verdict: 'strong' } },
  'lever:betaworks:2': { score: { value: 72, verdict: 'good' } },
};

test('buildCsv: header, ordering, escaping, and derived columns', () => {
  const csv = buildCsv(APPS, JOBS);
  const lines = csv.split('\r\n');
  assert.ok(csv.startsWith('﻿'), 'starts with a BOM so Excel reads UTF-8');
  assert.equal(lines[0].replace('﻿', ''), COLUMNS.map((c) => c.header).join(','));

  // Newest application first.
  assert.ok(lines[1].startsWith('app-bbbb2222'));
  assert.ok(lines[2].startsWith('app-aaaa1111'));

  // Quotes doubled, embedded commas/newlines quoted.
  assert.ok(lines[2].includes('"Acme Corp, ""Ltd"""'));
  assert.ok(csv.includes('"confirmation #12345\nreceived"'));

  // Scores joined from the job store; next follow-up = earliest not-done.
  assert.ok(lines[2].includes(',88,strong,'));
  assert.ok(lines[2].includes('2026-08-16'));
  assert.ok(!lines[2].includes('2026-08-09'), 'completed follow-up is not shown as next');
  assert.ok(lines[2].includes('applications/acmecorp-senior-engineer-aaaa1111'));
});

test('buildXlsx: produces a real zip that unzips to valid sheet XML', () => {
  const buf = buildXlsx(APPS, JOBS);
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'zip local header magic');
  assert.ok(buf.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  assert.ok(buf.length > 1000);

  // Verify with a real unzip implementation rather than trusting our writer.
  const dir = mkdtempSync(join(tmpdir(), 'jobagent-xlsx-'));
  const xlsxPath = join(dir, 'applications.xlsx');
  writeFileSync(xlsxPath, buf);
  const script = join(dir, 'unzip.mjs');
  writeFileSync(
    script,
    `import { readFileSync, writeFileSync } from 'node:fs';
     // Read the zip the way a real reader does: End of Central Directory →
     // central directory entries → local header → data. This validates our
     // central directory too, not just the local headers.
     const b = readFileSync(process.argv[2]);
     const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
     if (eocd < 0) throw new Error('no end-of-central-directory record');
     const count = b.readUInt16LE(eocd + 10);
     let p = b.readUInt32LE(eocd + 16);
     const names = [];
     let target = null;
     for (let n = 0; n < count; n += 1) {
       if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory signature at entry ' + n);
       const nameLen = b.readUInt16LE(p + 28);
       const extraLen = b.readUInt16LE(p + 30);
       const commentLen = b.readUInt16LE(p + 32);
       const offset = b.readUInt32LE(p + 42);
       const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
       names.push(name);
       if (name === 'xl/worksheets/sheet1.xml') target = offset;
       p += 46 + nameLen + extraLen + commentLen;
     }
     if (target === null) throw new Error('sheet not in central directory: ' + names.join(','));
     if (b.readUInt32LE(target) !== 0x04034b50) throw new Error('bad local header signature');
     if (b.readUInt16LE(target + 8) !== 0) throw new Error('expected STORED entry');
     const size = b.readUInt32LE(target + 22);
     const start = target + 30 + b.readUInt16LE(target + 26) + b.readUInt16LE(target + 28);
     writeFileSync(process.argv[3], b.subarray(start, start + size));
     writeFileSync(process.argv[4], names.join('\\n'));`
  );
  const sheetPath = join(dir, 'sheet1.xml');
  const namesPath = join(dir, 'names.txt');
  execFileSync(process.execPath, [script, xlsxPath, sheetPath, namesPath]);
  const sheet = readFileSync(sheetPath, 'utf8');
  const names = readFileSync(namesPath, 'utf8').split('\n');

  assert.deepEqual(names, [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
  ]);

  assert.ok(sheet.startsWith('<?xml'));
  assert.ok(sheet.includes('<worksheet'));
  assert.ok(sheet.trimEnd().endsWith('</worksheet>'));
  // Header + 2 data rows.
  assert.equal((sheet.match(/<row /g) ?? []).length, 3);
  // XML-escaped user content, no raw angle brackets from the title.
  assert.ok(sheet.includes('Senior Engineer &lt;Platform&gt;'));
  assert.ok(sheet.includes('Acme Corp, &quot;Ltd&quot;'));
  assert.ok(!/<t[^>]*>[^<]*<[^/t]/.test(sheet), 'no unescaped markup leaked into cell text');
});

test('buildXlsx/buildCsv handle an empty pipeline', () => {
  const csv = buildCsv({}, {});
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1, 'header only');
  const buf = buildXlsx({}, {});
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
});
