// Shared workspace facts for commands, hooks and authorization preflight.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompanies, loadPolicy, loadProfile, paths } from './config.mjs';
import { applicationPath } from './package-paths.mjs';

function isFile(path) { return existsSync(path) && statSync(path).isFile(); }

export function resolveResume(app) {
  const p = paths();
  const candidates = [app?.dir ? join(applicationPath(app.dir), 'resume.pdf') : null, p.resumePdfFile];
  const preferred = candidates.find((file) => file && isFile(file));
  if (preferred) return preferred;
  if (!existsSync(p.uploadsDir)) return null;
  return readdirSync(p.uploadsDir)
    .filter((f) => /\.pdf$/i.test(f))
    .map((f) => join(p.uploadsDir, f)).filter(isFile)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || a.localeCompare(b))[0] ?? null;
}

export function inspectPackage(app) {
  const dir = applicationPath(app.dir);
  const blockers = [];
  for (const file of ['resume.md', 'cover-letter.md', 'answers.md']) {
    const target = join(dir, file);
    if (!isFile(target) || !readFileSync(target, 'utf8').trim()) blockers.push(`package is missing ${file}`);
  }
  const answers = join(dir, 'answers.md');
  const needsHumanInput = isFile(answers) && /NEEDS HUMAN INPUT/i.test(readFileSync(answers, 'utf8'));
  return { dir, blockers, needsHumanInput, resumePdf: resolveResume(app) };
}

function inspectProfile(blockers) {
  const p = paths();
  for (const [key, name] of [['profileFile', 'profile/profile.json'], ['resumeFile', 'profile/resume.md'], ['answersFile', 'profile/answers.json']]) {
    if (!isFile(p[key])) blockers.push(`missing ${name}`);
  }
  if (!isFile(p.profileFile)) return;
  try {
    const profile = loadProfile();
    if (JSON.stringify(profile).includes('Jordan Example')) blockers.push('profile still contains placeholder example data');
  } catch (err) { blockers.push(err.message); }
}

export function inspectWorkspace() {
  const p = paths();
  const blockers = [];
  inspectProfile(blockers);
  try {
    const targets = loadCompanies();
    if (!targets.length) blockers.push('no target companies configured');
    if (JSON.stringify(targets).includes('Example Startup (no public ATS)')) blockers.push('companies still contain placeholder example data');
  } catch (err) { blockers.push(err.message); }
  let policy = null;
  try { policy = loadPolicy(); } catch (err) { blockers.push(err.message); }
  const optional = { achievements: isFile(p.achievementsFile), resumePdf: resolveResume() };
  return { ready: blockers.length === 0, blockers, paths: p, optional, mode: policy?.approval.mode ?? null };
}

