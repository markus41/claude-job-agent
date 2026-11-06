#!/usr/bin/env node
// PreToolUse hook: the enforcement point for submission safety.
//
// Reads the hook payload from stdin, evaluates it against src/lib/gate.mjs,
// and emits a structured "deny" when a rule is violated. When it has no
// opinion it stays silent, so Claude Code's normal permission flow applies.
//
// Rules enforced (see docs/SAFETY.md):
//   - `jobagent approve` is human-only (agents may never self-approve)
//   - browser tools require an armed, unexpired apply session
//   - navigation limited to allowlisted hosts + the approved application's host
//   - aggregators (LinkedIn/Indeed/…) always refused
//   - uploads only from applications/ or profile/
//   - SSN / payment-card shaped input is blocked

const HOOK_URL = import.meta.url;
import { realpathSync, existsSync } from 'node:fs';
import { evaluateGate, isBrowserTool } from '../../src/lib/gate.mjs';
const canonicalPath = (path) => existsSync(path) ? realpathSync(path) : path;

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Unparseable payload: nothing to evaluate.
    return;
  }

  try {
    const independent = evaluateGate(payload);
    if (independent?.decision === 'deny' && payload.tool_name === 'Bash') {
      deny(independent.reason);
      return;
    }
    if (!isBrowserTool(payload.tool_name)) return;
    const [{ loadPolicy, root }, { readSession }] = await Promise.all([
      import(new URL('../../src/lib/config.mjs', HOOK_URL)),
      import(new URL('../../src/lib/store.mjs', HOOK_URL)),
    ]);
    const verdict = evaluateGate(payload, {
      policy: loadPolicy(),
      session: readSession(),
      repoRoot: root(),
      resolvePath: canonicalPath,
    });
    if (verdict?.decision === 'deny') deny(verdict.reason);
  } catch (err) {
    // Fail closed for the high-stakes tools, open for everything else.
    if (payload?.tool_name === 'Bash' || isBrowserTool(payload?.tool_name)) {
      deny(`submit gate failed internally (${err.message}) — browser tools stay locked until it is fixed.`);
    }
  }
}

main().finally(() => process.exit(0));
