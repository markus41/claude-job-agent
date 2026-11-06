// Shared lifecycle and duplicate identity for sourcing, selection and packages.
import { normTitle } from './util.mjs';

export const TRANSITIONS = {
  packaged: ['tailored', 'withdrawn'],
  tailored: ['queued', 'withdrawn'],
  queued: ['approved', 'blocked', 'withdrawn'],
  approved: ['submitted', 'blocked', 'queued', 'withdrawn'],
  submitted: ['confirmed', 'rejected', 'interview', 'blocked', 'closed'],
  confirmed: ['rejected', 'interview', 'closed'],
  interview: ['offer', 'rejected', 'closed'],
  blocked: ['queued', 'withdrawn', 'closed'],
  offer: ['closed'],
  rejected: ['closed'],
  withdrawn: [],
  closed: [],
};

export const ACTIVE_STATUSES = new Set([
  'packaged', 'tailored', 'queued', 'approved', 'submitted', 'confirmed', 'interview', 'offer', 'blocked',
]);

export const applicationIdentity = (item) => `${item.companySlug}|${normTitle(item.title)}`;
