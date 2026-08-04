---
description: Full pipeline run — discover, shortlist, score, tailor the best matches, and build the human review queue. Stops before any submission.
argument-hint: [top-n]
---

Run the full sourcing→queue pipeline. Tailoring cap for this run: use the
first argument if one was given ("$1"), otherwise the policy `tailor.topN`
(default 5). An argument may lower the cap but never silently raise it above
policy.

1. **Discover** — delegate to the `job-discovery` subagent. Wait for its
   summary.
2. **Shortlist** — run `node bin/jobagent.mjs shortlist`. If the shortlist is
   empty, report the rejection histogram and stop.
3. **Score** — delegate to the `fit-scorer` subagent. Wait for the verdict
   distribution.
4. **Tailor** — pick the top scored jobs (verdict `strong` first, then `good`)
   up to the cap, and delegate them to the `tailor` subagent as an explicit
   list of jobIds.
5. **Report** — run `node bin/jobagent.mjs status` and present:
   - new jobs found, shortlist size, score distribution
   - each queued application: id, company, title, folder path, score, and
     any `NEEDS HUMAN INPUT` items
   - exactly what the human does next: review each folder, then run
     `node bin/jobagent.mjs approve <appId>` in their own terminal for the
     ones they want submitted, then `/apply <appId>`.

Never submit anything from this command. Never run `jobagent approve`
yourself — it is human-only and the gate enforces that.
