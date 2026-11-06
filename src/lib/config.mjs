// Central path resolution + config loading. All state lives under the repo
// root (or JOBAGENT_HOME when set, which the tests use for isolation).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './util.mjs';
import { validatePolicy } from './policy.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..', '..');

export function root() {
  return process.env.JOBAGENT_HOME ? resolve(process.env.JOBAGENT_HOME) : REPO_ROOT;
}

export function paths() {
  const r = root();
  return {
    root: r,
    projectRoot: REPO_ROOT,
    dataDir: join(r, 'data'),
    stateDir: join(r, 'data', 'state'),
    jobsFile: join(r, 'data', 'jobs.json'),
    appsFile: join(r, 'data', 'applications.json'),
    shortlistFile: join(r, 'data', 'shortlist.json'),
    sessionFile: join(r, 'data', 'state', 'apply-session.json'),
    autoAttestationFile: join(r, 'data', 'state', 'auto-approval.json'),
    auditFile: join(r, 'data', 'audit.log'),
    applicationsDir: join(r, 'applications'),
    profileDir: join(r, 'profile'),
    profileFile: join(r, 'profile', 'profile.json'),
    resumeFile: join(r, 'profile', 'resume.md'),
    resumePdfFile: join(r, 'profile', 'resume.pdf'),
    answersFile: join(r, 'profile', 'answers.json'),
    achievementsFile: join(r, 'profile', 'achievements.json'),
    uploadsDir: join(r, 'profile', 'uploads'),
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
    // "manual" — a human runs `jobagent approve <appId>` per application.
    // "auto"   — a human authorizes a BATCH up front (`jobagent auto-enable`,
    //            TTY-only, typed confirmation), then the agent submits each
    //            application in that batch without stopping. Every guardrail
    //            below still applies per application; see docs/SAFETY.md.
    mode: 'manual',
    sessionTtlMinutes: 60,
    auto: {
      // Only auto-submit packages at or above this fit score.
      requireScore: 80,
      // Applications one attestation may cover before a human re-authorizes.
      maxBatch: 10,
      // How long an attestation stays valid.
      ttlHours: 12,
      // Refuse to auto-submit without an exported resume PDF to upload.
      requireResumePdf: true,
      // Don't machine-gun one employer.
      maxPerCompanyPerDay: 1,
      // Refuse if the package still has unanswered screening questions.
      blockOnNeedsHumanInput: true,
    },
  },
  tailor: {
    minScore: 65,
    topN: 5,
    coverLetter: {
      // Read by the tailor agent (via `jobagent policy`).
      maxWords: 300,
      // professional | warm | direct | enthusiastic
      tone: 'professional',
    },
  },
  scoring: {
    // Rubric weights read by the fit-scorer agent (via `jobagent policy`).
    // Must sum to 100 — `jobagent doctor` validates overrides.
    weights: {
      mustHaveSkills: 35,
      titleSeniority: 20,
      locationWorkplace: 15,
      compensation: 10,
      domainIndustry: 10,
      trajectoryFlags: 10,
    },
  },
  followUps: {
    days: [7, 14],
  },
};

function deepMerge(base, override) {
  if (override === undefined) return base;
  if (!base || !override || Array.isArray(base) || Array.isArray(override) || typeof base !== 'object' || typeof override !== 'object') {
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
  return validatePolicy(deepMerge(DEFAULT_POLICY, user ?? {}));
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
    // Optional personalization files — doctor reports these as INFO, not FAIL.
    achievements: existsSync(p.achievementsFile),
    resumePdf: existsSync(p.resumePdfFile),
  };
}
