// Pure submission decisions. Tool names verified against @playwright/mcp 0.0.84.
import { resolve, sep } from 'node:path';

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const CARD_RE = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/;
const NORMAL_OPERATIONS = new Set([
  'click', 'close', 'console_messages', 'drag', 'find', 'hover', 'navigate_back',
  'press_key', 'resize', 'select_option', 'snapshot', 'take_screenshot', 'wait_for',
]);
const deny = (reason) => ({ decision: 'deny', reason });

export function hostMatches(host, patterns = []) {
  const h = String(host ?? '').toLowerCase();
  return patterns.some((raw) => {
    const p = String(raw).toLowerCase();
    return p.startsWith('*.') ? h === p.slice(2) || h.endsWith('.' + p.slice(2)) : h === p;
  });
}

export function isBrowserTool(name) { return /^mcp__.*playwright.*__browser_/i.test(name ?? ''); }

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

function shellDecision(input) {
  const cmd = String(input.command ?? '');
  if (/jobagent(\.mjs)?["']?\s+(approve|auto-enable)\b/i.test(cmd)) {
    return deny('A human-only authorization command requires the person to run jobagent approve or auto-enable personally in their terminal.');
  }
  return null;
}

function navigationDecision(input, ctx) {
  const target = input.url ?? '';
  if (target === 'back' || target === 'forward') return null;
  let url;
  try { url = new URL(target); } catch { return deny('Refusing navigation to unparseable URL'); }
  if (!['https:', 'http:'].includes(url.protocol)) return deny('Refusing navigation outside HTTP(S)');
  const host = url.hostname.toLowerCase();
  if (hostMatches(host, ctx.policy?.denylist?.hosts)) return deny(host + ' is on the denylist');
  const hosts = [...(ctx.policy?.allowlist?.hosts ?? []), ...(ctx.session.hosts ?? [])];
  if (!hostMatches(host, hosts)) return deny(host + ' is not in the allowlist for this apply session');
  return null;
}

function uploadDecision(input, ctx) {
  if (!ctx.repoRoot) return deny('Upload blocked: repo root unknown to the gate.');
  const canonical = ctx.resolvePath ?? resolve;
  const roots = ['applications', 'profile'].map((p) => canonical(resolve(ctx.repoRoot, p)));
  const physicalRepo = canonical(resolve(ctx.repoRoot));
  if (roots.some((root) => !root.startsWith(physicalRepo + sep))) return deny('Upload roots leave the workspace');
  const files = input.paths ?? (input.path ? [input.path] : []);
  if (!Array.isArray(files)) return deny('Upload paths must be an array');
  for (const file of files) {
    const abs = canonical(resolve(String(file)));
    if (!roots.some((root) => abs.startsWith(root + sep))) return deny('Upload of ' + abs + ' blocked: outside applications/ or profile/');
  }
  return null;
}

function contentDecision(input) {
  for (const value of collectStrings(input)) {
    if (SSN_RE.test(value)) return deny('Blocked: input looks like an SSN; human input required.');
    if (CARD_RE.test(value)) return deny('Blocked: input looks like a payment card number; stop.');
  }
  return null;
}

export function evaluateGate(input, ctx = {}) {
  const tool = input?.tool_name ?? '';
  const value = input?.tool_input ?? {};
  if (tool === 'Bash') return shellDecision(value);
  if (!isBrowserTool(tool)) return null;
  const session = ctx.session;
  if (!session || session.expired || !(Date.parse(session.expiresAt) > (ctx.now ?? Date.now()))) {
    return deny('Browser tools are locked: no armed apply session. Fresh human authorization is required.');
  }
  const operation = tool.slice(tool.toLowerCase().lastIndexOf('__browser_') + 10).toLowerCase();
  if (operation === 'navigate') return navigationDecision(value, ctx);
  if (operation === 'file_upload') return uploadDecision(value, ctx);
  if (['type', 'fill_form', 'handle_dialog'].includes(operation)) return contentDecision(value);
  if (operation === 'tabs' && ['list', 'close'].includes(value.action)) return null;
  if (NORMAL_OPERATIONS.has(operation)) return contentDecision(value);
  return deny('Unclassified or executable browser operation is blocked: ' + operation);
}

