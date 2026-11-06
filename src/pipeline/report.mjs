// Builds the status snapshot used by `jobagent status` and the /status command.
import { loadApps, loadJobs, readSession, submittedToday } from '../lib/store.mjs';

export function buildStatus() {
  const jobs = Object.values(loadJobs().jobs);
  const apps = Object.values(loadApps().apps);
  const session = readSession();
  const now = Date.now();

  const scored = jobs.filter((j) => j.score);
  const byVerdict = {};
  for (const j of scored) byVerdict[j.score.verdict] = (byVerdict[j.score.verdict] ?? 0) + 1;

  const byStatus = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;

  const followUpsDue = apps
    .filter((a) => ['submitted', 'confirmed'].includes(a.status))
    .flatMap((a) =>
      (a.followUps?.due ?? [])
        .filter((d) => !(a.followUps?.done ?? []).includes(d) && new Date(d).getTime() <= now)
        .map((d) => ({ appId: a.id, company: a.company, title: a.title, dueAt: d }))
    );

  return {
    jobs: {
      total: jobs.length,
      scored: scored.length,
      byVerdict,
    },
    applications: {
      total: apps.length,
      byStatus,
      submittedToday: submittedToday(),
      queue: apps
        .filter((a) => ['queued', 'approved', 'tailored', 'packaged', 'blocked'].includes(a.status))
        .map((a) => ({ id: a.id, status: a.status, company: a.company, title: a.title, dir: a.dir })),
    },
    session: session
      ? { appId: session.appId, expiresAt: session.expiresAt, expired: Boolean(session.expired) }
      : null,
    recoveryNeeded: apps.some((a) => a.status === 'approved') && (!session || session.expired),
    followUpsDue,
  };
}

export function renderStatus(s) {
  const lines = [];
  const verdicts = Object.entries(s.jobs.byVerdict).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  lines.push(`JOBS   ${s.jobs.total} discovered · ${s.jobs.scored} scored (${verdicts})`);

  const statuses = Object.entries(s.applications.byStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  lines.push(`APPS   ${s.applications.total} total · ${statuses} · ${s.applications.submittedToday} submitted today`);

  if (s.session) {
    lines.push(
      s.session.expired
        ? `ARMED  session for ${s.session.appId} EXPIRED — re-approve to continue`
        : `ARMED  ${s.session.appId} until ${s.session.expiresAt}`
    );
  } else {
    lines.push('ARMED  no apply session (browser tools locked)');
  }

  if (s.applications.queue.length) {
    lines.push('', 'Pipeline:');
    for (const a of s.applications.queue) {
      lines.push(`  ${a.id}  [${a.status}]  ${a.company} — ${a.title}`);
    }
  }

  if (s.followUpsDue.length) {
    lines.push('', 'Follow-ups due:');
    for (const f of s.followUpsDue) {
      lines.push(`  ${f.appId}  ${f.company} — ${f.title} (due ${f.dueAt.slice(0, 10)})`);
    }
  }

  return lines.join('\n');
}
