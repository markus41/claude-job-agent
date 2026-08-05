---
description: Work through the human-authorized auto-submit batch — submits eligible applications back to back without stopping for per-application approval.
argument-hint: [max-count]
---

Auto-submit state:
!`node bin/jobagent.mjs auto-status --json`

Work through the batch. Limit: the first argument if given ("$1"), otherwise
whatever the batch authorization still allows.

1. **Check the authorization.** From the JSON above: `mode` must be `auto`, and
   the attestation must exist, be unexpired, and have remaining capacity. If
   not, STOP and tell the human exactly what to run in their own terminal
   (`node bin/jobagent.mjs auto-enable` — you are hook-blocked from running
   it), and why: batch authorization is how a person consents to unattended
   submissions.
2. **Take the eligible list** (`eligible: true`, highest score first). Report
   the blocked ones and their reasons once, briefly — do not try to work
   around a blocker. `NEEDS HUMAN INPUT`, a missing resume PDF, a low score,
   or a cap are all the human's to resolve.
3. **For each eligible application, in order:**
   a. `node bin/jobagent.mjs auto-arm <appId>` — this consumes one unit of the
      batch and arms the browser gate. If it refuses, log the reason and move
      to the next application.
   b. Delegate the submission to the `browser-apply` subagent, telling it
      explicitly this is an **unattended auto-submit run**: no human is
      watching, so anything that would normally pause for a person (CAPTCHA,
      login or account creation, a field it has no truthful value for, a
      surprise question, a payment or ID request, an unexpected host) means
      record `blocked` with the reason, disarm, and move on — never guess,
      never improvise a value, never attempt a bot-check.
   c. Log the outcome and continue to the next one.
4. **Stop early** if: the batch is exhausted, the daily cap is hit, or two
   consecutive applications come back `blocked` (something systemic is wrong
   — report it rather than burning the batch).
5. **Report** at the end: submitted (with confirmations), blocked (with
   reasons and what the human should fix), batch remaining, and the current
   `node bin/jobagent.mjs status`. Point them at `data/applications.xlsx` for
   the readable tracker.

Never run `auto-enable` or `approve`. Never edit `config/policy.json`,
`.claude/settings.json`, the hooks, or `src/lib/gate.mjs` to unblock a
submission — a refusal is the system working correctly.
