# claude-job-agent

[![CI](https://github.com/markus41/claude-job-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/markus41/claude-job-agent/actions/workflows/ci.yml)

An AI job-application assistant that runs on [Claude Code](https://code.claude.com).
It finds openings at companies you pick, writes a tailored resume + cover
letter + screening answers for each good match, and — **only after you
personally approve each one** — fills in the application form in a browser
while you watch.

It never applies without you, never invents facts about you, and all your
personal data stays in files on your own computer.

## Setup (one time, ~20 minutes)

**Step 1 — Run the one-click installer.**

Windows: open PowerShell, paste, press Enter:

```powershell
irm https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.ps1 | iex
```

Mac / Linux: open Terminal, paste, press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.sh | bash
```

It asks before installing anything, downloads this project, and opens
Claude Code for you. (Already downloaded the folder? Just double-click
`setup.cmd` on Windows, or run `./setup.sh` on Mac.)

**Step 2 — Approve the browser.**
When Claude Code opens, it asks to start a server called `playwright` —
say yes. That's the browser it uses to fill forms while you watch.

**Step 3 — Type `/setup` and answer the interview.**
Have your resume file handy (PDF is perfect). It offers to start this on its
own the first time. Nine short phases: it reads your resume, digs into what
you actually did in each role, collects your proudest numbers and
achievements, then covers what you want (titles, remote or not, minimum
salary, deal-breakers), money, your voice, and your target companies.
30–45 minutes, all conversational — stop anytime, resume with `/setup`.

Done. You're configured.

## Using it (the daily loop)

**Step 1 — Type `/hunt`.**
It checks your companies' job boards, scores every opening against your
profile, and writes complete draft applications for the best matches into
the `applications/` folder.

**Step 2 — Read what it wrote.**
Open the folder it names. The resume, cover letter, and answers are going
out under your name — read them, edit anything you like.

**Step 3 — Approve, in your own terminal (not in Claude):**

```bash
node bin/jobagent.mjs approve app-xxxxxxxx
```

This is your signature. The AI is blocked from running this command — only
you can.

**Step 4 — Type `/apply app-xxxxxxxx`.**
A browser window opens and fills in the form. If a CAPTCHA or login
appears, it stops and you do that part. You see the confirmation when it's
submitted.

**Step 5 — Check in whenever.**
`/status` shows where everything stands. **`data/applications.xlsx`** is a
live spreadsheet of every application — open it in Excel or Numbers anytime
(there's a `.csv` too). `/follow-up` drafts polite follow-up notes when it's
been a week (you send them). `/doctor` checks the setup if something seems
off.

## Optional: let it submit without asking each time

Once you trust what it writes, you can authorize applications in batches
instead of one at a time:

**Step 1** — set `"approval": { "mode": "auto" }` in `config/policy.json`.

**Step 2** — in your terminal, authorize a batch:

```bash
node bin/jobagent.mjs auto-enable --batch 10 --hours 12 --min-score 80
```

It shows you exactly which applications would go out, then makes you type
`authorize 10` to confirm.

**Step 3** — in Claude Code, type `/auto-apply`. It works through the batch
back to back.

Still refuses, every time: applications scoring below your floor, packages
with unanswered questions, more than one application per company per day,
anything past your daily cap, CAPTCHAs, and logins. Cancel instantly with
`node bin/jobagent.mjs auto-revoke`. Details and the honest tradeoffs:
[docs/SAFETY.md § Auto-submit](docs/SAFETY.md#auto-submit-mode).

## Good to know

- **Nothing submits without your authorization** — per application, or as a
  batch you approve up front. Enforced by code, not by politeness; the AI
  cannot run either authorization command. See
  [docs/SAFETY.md](docs/SAFETY.md).
- **It never lies about you.** Materials only reorder and rephrase what your
  resume and achievements actually say. Questions it can't answer truthfully
  come back marked `NEEDS HUMAN INPUT`.
- **No LinkedIn/Indeed automation.** Their rules prohibit it; it applies on
  company career sites instead (same jobs, no bots-arms-race).
- **Your data stays local.** `profile/`, `applications/`, and `data/` are
  gitignored — nothing personal ever leaves your machine or lands on GitHub.
- **Everything is tunable** — caps, tone, scoring weights, companies:
  [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## What's in the box

- **10 slash commands** — `/setup` (the in-depth interview), `/hunt`,
  `/discover`, `/score`, `/tailor`, `/apply`, `/auto-apply`, `/status`,
  `/follow-up`, `/doctor`
- **5 specialist agents** — job discovery, fit scoring, tailoring, browser
  submission, application bookkeeping
- **A CLI** you or the AI can drive (`node bin/jobagent.mjs help`)
- **Safety hooks** that enforce the rules regardless of what any agent decides
- **A live spreadsheet** of every application, always current
- **Full configurability** — caps, tone, scoring weights, companies,
  submission mode
- **A companion plugin** so `/job-agent:install` and `/job-agent:help` work
  from any folder

## More

| If you want… | Read |
|---|---|
| A walkthrough written for total beginners | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| Manual/advanced setup, scheduling, troubleshooting | [docs/SETUP.md](docs/SETUP.md) |
| Every configuration knob | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| What it refuses to do, and how that's enforced | [docs/SAFETY.md](docs/SAFETY.md) |
| How it works inside | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Install the companion plugin (`/job-agent:install`, `/job-agent:help` from any folder) | `claude plugin marketplace add markus41/claude-job-agent` then `claude plugin install job-agent@claude-job-agent` |

MIT license. You're responsible for every application you approve — review
what it writes and represent yourself truthfully. It refuses to lie for you
by design.
