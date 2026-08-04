// Pure decision logic for the PreToolUse submit gate. The hook wrapper
// (.claude/hooks/submit-gate.mjs) feeds it the hook input plus filesystem
// context; keeping it pure makes it unit-testable.
//
// Returns null (no opinion — normal permission flow continues) or
// { decision: 'deny', reason }.
import { resolve, sep } from 'node:path';

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
// 13-16 digits in typical card grouping, within a single field value.
const CARD_RE = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/;

export function hostMatches(host, patterns = []) {
  const h = String(host ?? '').toLowerCase();
  for (const raw of patterns) {
    const p = String(raw).toLowerCase();
    if (p.startsWith('*.')) {
      const apex = p.slice(2);
      if (h === apex || h.endsWith(`.${apex}`)) return true;
    } else if (h === p) {
      return true;
    }
  }
  return false;
}

function deny(reason) {
  return { decision: 'deny', reason };
}

function isBrowserTool(toolName) {
  return /^mcp__.*playwright.*__browser_/i.test(toolName ?? '');
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/**
 * @param {object} input  Hook payload: { tool_name, tool_input }
 * @param {object} ctx    { policy, session, repoRoot, now?: number }
 */
export function evaluateGate(input, ctx) {
  const toolName = input?.tool_name ?? '';
  const toolInput = input?.tool_input ?? {};
  const policy = ctx?.policy ?? {};
  const now = ctx?.now ?? Date.now();

  // --- Bash: the human-only approve command --------------------------------
  if (toolName === 'Bash') {
    const cmd = String(toolInput.command ?? '');
    if (/jobagent(\.mjs)?["']?\s+approve\b/.test(cmd)) {
      return deny(
        '`jobagent approve` is a human-only command. Ask the user to run it themselves in their own terminal — agents must never self-approve a submission.'
      );
    }
    return null;
  }

  // --- Browser (Playwright MCP) tools ---------------------------------------
  if (!isBrowserTool(toolName)) return null;

  const session = ctx?.session;
  const sessionValid = Boolean(
    session && !session.expired && new Date(session.expiresAt).getTime() > now
  );

  if (!sessionValid) {
    return deny(
      'Browser tools are locked: no armed apply session. A human must run `node bin/jobagent.mjs approve <appId>` first (sessions expire; re-approve if needed).'
    );
  }

  // Navigation: allowlist + aggregator denylist.
  if (/browser_navigate$/i.test(toolName)) {
    const target = toolInput.url ?? '';
    if (target === 'back' || target === 'forward') return null;
    let host;
    try {
      host = new URL(target).hostname.toLowerCase();
    } catch {
      return deny(`Refusing navigation to unparseable URL: ${JSON.stringify(target)}`);
    }
    if (hostMatches(host, policy.denylist?.hosts)) {
      return deny(
        `${host} is on the denylist: aggregator sites (LinkedIn, Indeed, …) prohibit automated applications in their ToS. Apply on the company's own careers page instead.`
      );
    }
    const allowedHosts = [...(policy.allowlist?.hosts ?? []), ...(session.hosts ?? [])];
    if (!hostMatches(host, allowedHosts)) {
      return deny(
        `${host} is not in the allowlist for this apply session (allowed: ${allowedHosts.join(', ')}). Add it to config/policy.json allowlist.hosts if it is legitimate.`
      );
    }
    return null;
  }

  // File uploads: only files inside the repo's applications/ or profile/ dirs.
  if (/browser_file_upload$/i.test(toolName)) {
    const repoRoot = ctx?.repoRoot;
    const rawPaths = toolInput.paths ?? (toolInput.path ? [toolInput.path] : []);
    if (!repoRoot) return deny('Upload blocked: repo root unknown to the gate.');
    const allowedRoots = [resolve(repoRoot, 'applications'), resolve(repoRoot, 'profile')];
    for (const p of rawPaths) {
      const abs = resolve(String(p));
      const ok = allowedRoots.some((root) => abs === root || abs.startsWith(root + sep));
      if (!ok) {
        return deny(
          `Upload of ${abs} blocked: only files under applications/ or profile/ may be uploaded to a job form.`
        );
      }
    }
    return null;
  }

  // Typed content: block obvious high-sensitivity identifiers. Each field
  // value is checked individually so adjacent fields (zip + phone) can't
  // chain into a false positive.
  if (/browser_(type|fill_form)$/i.test(toolName)) {
    for (const value of collectStrings(toolInput)) {
      if (SSN_RE.test(value)) {
        return deny('Blocked: input looks like an SSN. The agent must never enter government IDs — the human fills those fields personally if truly required.');
      }
      if (CARD_RE.test(value)) {
        return deny('Blocked: input looks like a payment card number. Job applications never require payment — treat this form as a scam signal and stop.');
      }
    }
    return null;
  }

  return null;
}
