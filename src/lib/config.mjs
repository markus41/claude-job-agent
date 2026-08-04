// Central path resolution + config loading. All state lives under the repo
// root (or JOBAGENT_HOME when set, which the tests use for isolation).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './util.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..', '..');

export function root() {
  return process.env.JOBAGENT_HOME ? resolve(process.env.JOBAGENT_HOME) : REPO_ROOT;
}

export function paths() {
  const r = root();
  return {
    root: r,
    dataDir: join(r, 'data'),
    stateDir: join(r, 'data', 'state'),
    jobsFile: join(r, 'data', 'jobs.json'),
    appsFile: join(r, 'data', 'applications.json'),
    shortlistFile: join(r, 'data', 'shortlist.json'),
    sessionFile: join(r, 'data', 'state', 'apply-session.json'),
    auditFile: join(r, 'data', 'audit.log'),
    applicationsDir: join(r, 'applications'),
    profileDir: join(r, 'profile'),
    profileFile: join(r, 'profile', 'profile.json'),
    resumeFile: join(r, 'profile', 'resume.md'),
    answersFile: join(r, 'profile', 'answers.json'),
    configDir: join(r, 'config'),
    companiesFile: join(r, 'config', 'companies.json'),
    policyFile: join(r, 'config', 'policy.json'),
  };
}

export const DEFAULT_POLICY = {
  allowlist: {
    // Hosts the browser agent may navigate to. Entries starting with "*."
    // match the apex domain and any subdomain.
    hosts: [
      'boards.greenhouse.io',
      'job-boards.greenhouse.io',
      'jobs.lever.co',
      'jobs.ashbyhq.com',
      '*.myworkdayjobs.com',
    ],
  },
  denylist: {
    // Aggregators whose terms of service prohibit automated applications.
    // The submit gate refuses these outright — see docs/SAFETY.md.
    hosts: [
      '*.linkedin.com',
      '*.indeed.com',
      '*.glassdoor.com',
      '*.ziprecruiter.com',
      '*.monster.com',
    ],
  },
  caps: {
    maxApplicationsPerDay: 10,
    maxJobAgeDays: 60,
    shortlistLimit: 40,
    descriptionChars: 3500,
  },
  approval: {
    // "manual" = a human must run `jobagent approve <appId>` in their own
    // terminal before the browser agent may touch a form.
    mode: 'manual',
    sessionTtlMinutes: 60,
  },
  tailor: {
    minScore: 65,
    topN: 5,
  },
  followUps: {
    days: [7, 14],
  },
};

function deepMerge(base, override) {
  if (override == null) return base;
  if (Array.isArray(base) || Array.isArray(override) || typeof base !== 'object' || typeof override !== 'object') {
    return override;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadPolicy() {
  const p = paths();
  const user = readJson(p.policyFile, null);
  return deepMerge(DEFAULT_POLICY, user ?? {});
}

export function loadCompanies() {
  const p = paths();
  const cfg = readJson(p.companiesFile, null);
  if (!cfg || !Array.isArray(cfg.targets)) {
    throw new Error(
      `Missing or invalid ${p.companiesFile}. Run "node bin/jobagent.mjs init" and edit config/companies.json.`
    );
  }
  return cfg.targets;
}

export function loadProfile() {
  const p = paths();
  const profile = readJson(p.profileFile, null);
  if (!profile) {
    throw new Error(
      `Missing ${p.profileFile}. Run "node bin/jobagent.mjs init" and fill in profile/profile.json.`
    );
  }
  return profile;
}

export function profileFilesPresent() {
  const p = paths();
  return {
    profile: existsSync(p.profileFile),
    resume: existsSync(p.resumeFile),
    answers: existsSync(p.answersFile),
  };
}
