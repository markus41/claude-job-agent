// Path A: direct API submission (per the architecture blueprint).
//
// Deliberately DISABLED by default. Public ATS job-board APIs are read-only;
// programmatic *submission* endpoints (e.g. Greenhouse's Job Board API POST)
// require an employer-issued API key that applicants normally do not have,
// and endpoint contracts vary per company. Guessing request shapes is how you
// silently lose applications, so nothing here fabricates one.
//
// If you have a verified, documented submission contract for a specific
// company (verify the URL, auth, payload, and field names against the real
// docs or a captured request first), implement it as a module and register it
// in SUBMITTERS below. See ARCHITECTURE.md § "Submission paths".

export const SUBMITTERS = {
  // example: 'greenhouse': submitGreenhouse,
};

export async function submitViaApi(job) {
  const submitter = SUBMITTERS[job.ats];
  if (!submitter) {
    const err = new Error(
      `No verified API submitter is registered for "${job.ats}". Use the browser path (/apply) instead, or add a verified submitter in src/submit/api.mjs.`
    );
    err.code = 'ENOSUBMITTER';
    throw err;
  }
  return submitter(job);
}
