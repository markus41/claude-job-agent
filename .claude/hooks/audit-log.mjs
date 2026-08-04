#!/usr/bin/env node
// PostToolUse hook: append-only audit trail of browser actions.
// Never blocks anything; failures are swallowed.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  const input = payload.tool_input ?? {};
  const entry = {
    ts: new Date().toISOString(),
    actor: 'hook',
    event: 'tool-use',
    tool: payload.tool_name,
    ...(input.url ? { url: input.url } : {}),
    ...(input.paths ? { paths: input.paths } : {}),
    ...(input.command ? { command: String(input.command).slice(0, 200) } : {}),
  };
  const dataDir = join(REPO_ROOT, 'data');
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(join(dataDir, 'audit.log'), `${JSON.stringify(entry)}\n`);
}

main().catch(() => {}).finally(() => process.exit(0));
