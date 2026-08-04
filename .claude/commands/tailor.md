---
description: Build application packages (tailored resume, cover letter, answers) for specific jobs or the top scored ones.
argument-hint: [jobId ... | top N]
---

Determine the target list:
- If jobIds were passed ($ARGUMENTS), use exactly those.
- If "top N" (or nothing) was passed, pick the best unpackaged scored jobs by
  score (verdict `strong`, then `good`), capped at N (default: policy
  `tailor.topN`). Get candidates from `node bin/jobagent.mjs status --json`
  plus `node bin/jobagent.mjs shortlist --json` context and the job store via
  `node bin/jobagent.mjs show <jobId>`.

Delegate the list to the `tailor` subagent. When it finishes, present each
package (folder, angle, open questions) and remind the human: review the
folder, export a PDF resume if needed, then approve with
`node bin/jobagent.mjs approve <appId>` in their own terminal.
