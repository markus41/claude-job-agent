---
description: Build application packages (tailored resume, cover letter, answers) for specific jobs or the top scored ones.
argument-hint: [jobId ... | top N]
---

Determine the target list:
- If jobIds were passed ($ARGUMENTS), use exactly those.
- If "top N" (or nothing) was passed, pick the best unpackaged scored jobs by
  score using `node bin/jobagent.mjs select --json` (add `--limit N` when
  requested). Use exactly its items; it owns verdict ordering, score floor,
  caps and active-package exclusion. An empty list means no eligible work.

Delegate the list to the `tailor` subagent. When it finishes, present each
package (folder, angle, open questions) and remind the human: review the
folder, export a PDF resume if needed, then approve with
`node bin/jobagent.mjs approve <appId>` in their own terminal.
