import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readJson, stripHtml, truncate, writeJsonAtomic } from '../src/lib/util.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'jobagent-util-'));

test('writeJsonAtomic creates parent dirs and round-trips', () => {
  const file = join(dir(), 'nested', 'deep', 'state.json');
  writeJsonAtomic(file, { a: 1, b: 'two' });
  assert.deepEqual(readJson(file, null), { a: 1, b: 'two' });
  assert.ok(readFileSync(file, 'utf8').endsWith('\n'));
});

test('writeJsonAtomic survives repeated rapid replacement', () => {
  // This loop is what surfaced a transient Windows EPERM on rename; the
  // writer now retries and falls back rather than losing a state write.
  const file = join(dir(), 'apps.json');
  for (let i = 0; i < 300; i += 1) writeJsonAtomic(file, { i });
  assert.deepEqual(readJson(file, null), { i: 299 });
});

test('writeJsonAtomic overwrites a stale temp file', () => {
  const d = dir();
  const file = join(d, 'apps.json');
  writeFileSync(`${file}.tmp`, 'garbage left by a crashed run');
  writeJsonAtomic(file, { ok: true });
  assert.deepEqual(readJson(file, null), { ok: true });
});

test('writeJsonAtomic falls back when the destination cannot be replaced', () => {
  // A directory at the destination makes rename fail permanently; the writer
  // must surface that rather than pretend it wrote.
  const d = dir();
  const target = join(d, 'blocked.json');
  mkdirSync(target);
  assert.throws(() => writeJsonAtomic(target, { a: 1 }));
});

test('readJson returns the fallback for a missing file and throws on bad JSON', () => {
  const d = dir();
  assert.equal(readJson(join(d, 'nope.json'), 'fallback'), 'fallback');
  const bad = join(d, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.throws(() => readJson(bad, null), /Invalid JSON/);
});

test('stripHtml renders list items and decodes entities', () => {
  const text = stripHtml('<p>Role &amp; team</p><ul><li>Own the pipeline</li><li>Mentor</li></ul>');
  assert.ok(text.includes('Role & team'));
  assert.ok(text.includes('- Own the pipeline'));
  assert.ok(text.includes('- Mentor'));
  assert.ok(!text.includes('<'));
});

test('stripHtml drops script and style content', () => {
  const text = stripHtml('<style>.a{color:red}</style><p>Hello</p><script>alert(1)</script>');
  assert.equal(text, 'Hello');
});

test('truncate keeps short strings and ellipsizes long ones', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
});
