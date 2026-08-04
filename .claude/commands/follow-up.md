---
description: Draft follow-up notes for submitted applications that are due, and record any status updates the human reports.
argument-hint: [appId status note…]
---

If arguments were passed ($ARGUMENTS), treat them as a status update to
record first (e.g. `app-1a2b3c4d interview "recruiter emailed"`), via
`node bin/jobagent.mjs record …`.

Then delegate to the `application-logger` subagent to reconcile statuses and
draft follow-up notes for everything due. Relay: drafts written (with file
paths — the human sends them personally), stuck applications, and recommended
next actions.
