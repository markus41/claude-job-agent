#!/usr/bin/env node
// SessionStart hook: on an unconfigured (or partly configured) workspace,
// tell Claude to open the guided interview instead of waiting to be asked.
// Emits plain context text; never blocks anything.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...parts) => join(ROOT, ...parts);

function looksLikeExample(file, marker) {
  try {
    return readFileSync(file, 'utf8').includes(marker);
  } catch {
    return false;
  }
}

const profileFile = p('profile', 'profile.json');
const companiesFile = p('config', 'companies.json');

const missing = [];
if (!existsSync(profileFile)) missing.push('profile/profile.json');
if (!existsSync(p('profile', 'resume.md'))) missing.push('profile/resume.md');
if (!existsSync(p('profile', 'answers.json'))) missing.push('profile/answers.json');
if (!existsSync(p('profile', 'achievements.json'))) missing.push('profile/achievements.json');
if (!existsSync(companiesFile)) missing.push('config/companies.json');

// Files can exist but still be untouched copies of the examples.
const stillExample = [];
if (existsSync(profileFile) && looksLikeExample(profileFile, 'Jordan Example')) {
  stillExample.push('profile/profile.json');
}
if (existsSync(companiesFile) && looksLikeExample(companiesFile, 'Example Startup (no public ATS)')) {
  stillExample.push('config/companies.json');
}

if (missing.length === 0 && stillExample.length === 0) process.exit(0);

const lines = ['claude-job-agent: this workspace is not set up for its owner yet.'];
if (missing.length) lines.push(`Missing: ${missing.join(', ')}.`);
if (stillExample.length) lines.push(`Still placeholder example data: ${stillExample.join(', ')}.`);
lines.push(
  'Greet the user briefly and offer to run the in-depth setup interview now (/setup) —',
  'it imports their resume and builds their profile, achievements, answers, and target',
  'companies. If they would rather explore first, tell them /setup is there when ready.',
  'Do not run /hunt or any pipeline command until the profile is real: scoring against',
  'placeholder data produces garbage.'
);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
    },
  })
);
