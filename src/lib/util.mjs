// Small shared utilities. No dependencies, no side effects beyond the fs helpers.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const nowIso = () => new Date().toISOString();

export const sha1 = (s) => createHash('sha1').update(String(s)).digest('hex');

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', bull: '•',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

export function decodeEntities(s = '') {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, ent) => {
    if (ent[0] === '#') {
      const code = ent[1]?.toLowerCase() === 'x'
        ? Number.parseInt(ent.slice(2), 16)
        : Number.parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

// Convert an HTML fragment to readable plain text. Good enough for job
// descriptions; not a general-purpose HTML parser.
export function stripHtml(html = '') {
  const text = String(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/ul|\/ol|\/h[1-6]|\/tr|\/table)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(s, n) {
  const str = String(s ?? '');
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`;
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in ${path}: ${err.message}`);
  }
}

export function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, path);
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export const normTitle = (title) =>
  String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
