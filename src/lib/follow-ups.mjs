// One meaning for pending, drafted and completed follow-ups.
export function pendingFollowUps(app, { now = Infinity } = {}) {
  if (!['submitted', 'confirmed'].includes(app.status)) return [];
  const done = new Set(app.followUps?.done ?? []);
  const drafts = app.followUps?.drafted ?? [];
  return [...new Set(app.followUps?.due ?? [])].sort()
    .filter((date) => !done.has(date) && Date.parse(date) <= now)
    .map((dueAt) => ({ appId: app.id, company: app.company, title: app.title, dir: app.dir, dueAt,
      drafted: drafts.includes(dueAt), draftFile: followUpDraftName(dueAt) }));
}

export function followUpDraftName(dueAt) {
  if (!Number.isFinite(Date.parse(dueAt))) throw new Error('Invalid follow-up due date');
  return 'follow-up-' + new Date(dueAt).toISOString().replace(/[:.]/g, '-') + '.md';
}

export function updateFollowUp(app, dueAt, { complete = false, confirmed = false, note = '' } = {}) {
  if (!['submitted', 'confirmed'].includes(app.status)) throw new Error('Follow-up requires a submitted or confirmed application');
  if (!app.followUps?.due?.includes(dueAt)) throw new Error('Unknown scheduled follow-up date');
  if (complete && !confirmed) throw new Error('Follow-up completion requires explicit human confirmation (--confirmed)');
  const key = complete ? 'done' : 'drafted';
  app.followUps[key] ??= [];
  if (app.followUps[key].includes(dueAt)) return false;
  app.followUps[key].push(dueAt);
  app.history.push({ status: app.status, at: new Date().toISOString(), note: note || (complete ? 'human confirmed follow-up completion' : 'follow-up draft recorded'), followUpDueAt: dueAt });
  return true;
}

