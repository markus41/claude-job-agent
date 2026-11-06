// Validate the effective policy, once, before any caller uses its values.
const invalid = (field, rule) => { throw new Error(`Invalid policy ${field}: ${rule}`); };
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);

function number(value, field, min = 0, max = Infinity, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    invalid(field, `must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
  }
}

function hosts(value, field) {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && /^(\*\.)?[a-z0-9.-]+$/i.test(v))) {
    invalid(field, 'must be an array of host patterns');
  }
}

function validateApproval(approval) {
  if (!['manual', 'auto'].includes(approval.mode)) invalid('approval.mode', 'must be manual or auto');
  number(approval.sessionTtlMinutes, 'approval.sessionTtlMinutes', Number.EPSILON);
  if (!object(approval.auto)) invalid('approval.auto', 'must be an object');
  const cfg = approval.auto;
  number(cfg.requireScore, 'approval.auto.requireScore', 0, 100);
  number(cfg.maxBatch, 'approval.auto.maxBatch', 1, Infinity, true);
  number(cfg.ttlHours, 'approval.auto.ttlHours', Number.EPSILON);
  number(cfg.maxPerCompanyPerDay, 'approval.auto.maxPerCompanyPerDay', 1, Infinity, true);
  for (const key of ['requireResumePdf', 'blockOnNeedsHumanInput']) {
    if (typeof cfg[key] !== 'boolean') invalid(`approval.auto.${key}`, 'must be boolean');
  }
}

function validateScoring(scoring) {
  if (!object(scoring.weights)) invalid('scoring.weights', 'must be an object');
  for (const [key, value] of Object.entries(scoring.weights)) number(value, `scoring.weights.${key}`, 0, 100);
  if (Object.values(scoring.weights).reduce((a, b) => a + b, 0) !== 100) invalid('scoring.weights', 'must sum to 100');
}

export function validatePolicy(policy) {
  for (const key of ['allowlist', 'denylist', 'caps', 'approval', 'tailor', 'scoring', 'followUps']) {
    if (!object(policy[key])) invalid(key, 'must be an object');
  }
  hosts(policy.allowlist.hosts, 'allowlist.hosts');
  hosts(policy.denylist.hosts, 'denylist.hosts');
  for (const key of ['maxApplicationsPerDay', 'shortlistLimit', 'descriptionChars']) {
    number(policy.caps[key], `caps.${key}`, 1, Infinity, true);
  }
  number(policy.caps.maxJobAgeDays, 'caps.maxJobAgeDays');
  validateApproval(policy.approval);
  number(policy.tailor.minScore, 'tailor.minScore', 0, 100);
  number(policy.tailor.topN, 'tailor.topN', 1, Infinity, true);
  if (!object(policy.tailor.coverLetter)) invalid('tailor.coverLetter', 'must be an object');
  number(policy.tailor.coverLetter.maxWords, 'tailor.coverLetter.maxWords', 1, Infinity, true);
  if (!['professional', 'warm', 'direct', 'enthusiastic'].includes(policy.tailor.coverLetter.tone)) invalid('tailor.coverLetter.tone', 'invalid tone');
  validateScoring(policy.scoring);
  if (!Array.isArray(policy.followUps.days)) invalid('followUps.days', 'must be an array');
  for (const day of policy.followUps.days) number(day, 'followUps.days', 0, 3650);
  return policy;
}

