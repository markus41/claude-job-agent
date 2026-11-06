---
description: Submit ONE approved application via the browser agent. Requires prior human approval (jobagent approve) — this command never approves anything.
argument-hint: <appId>
---

Current pipeline state:
!`node bin/jobagent.mjs status --json`

Target application: $1

1. From the status JSON above, verify:
   - `$1` exists and its status is `approved`;
   - the armed `session` matches `$1` and is not expired.
2. If not approved/armed: STOP and tell the human exactly what to run in
   their own terminal — `node bin/jobagent.mjs approve $1` — and why you
   cannot run it for them (human-only gate). Do not attempt it yourself.
   If `recoveryNeeded` is true, first run `node bin/jobagent.mjs recover`
   to revoke stale permission and return interrupted approvals to queued.
3. If armed: confirm the Playwright MCP browser is available, then delegate
   the submission to the `browser-apply` subagent with the appId, and relay
   its progress. If it pauses for a CAPTCHA or login, pass that to the human
   verbatim and wait.
4. Afterwards, run `node bin/jobagent.mjs status` and report the outcome
   (submitted + confirmation, or blocked + reason + how to retry).

One application per invocation. Never batch, never re-arm, never work around
a gate denial.
