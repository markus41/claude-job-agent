# job-agent (companion plugin)

Install-and-help companion for
[claude-job-agent](https://github.com/markus41/claude-job-agent). It adds two
global commands:

- `/job-agent:install` — guided install from any folder: prerequisites,
  clone, scaffold, hand-off to the in-project `/setup` interview.
- `/job-agent:help` — explains the workflow and gets people unstuck.

```bash
claude plugin marketplace add markus41/claude-job-agent
claude plugin install job-agent@claude-job-agent
```

## Why the pipeline itself isn't in the plugin

Deliberate: the discovery/scoring/tailoring/apply commands, subagents, and —
critically — the `PreToolUse` submit-gate hook are **project-scoped** inside
the claude-job-agent workspace. That guarantees the safety gates are always
active exactly where the data and browser sessions live, and that your
private profile stays in one gitignored folder. The plugin just gets you
there.
