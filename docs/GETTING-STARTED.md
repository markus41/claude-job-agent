# Getting started (no experience needed)

This guide assumes you have **never used Claude Code or a terminal**. If you
have, skim [SETUP.md](SETUP.md) instead.

## What this tool does (and doesn't)

It reads job boards for companies you pick, figures out which openings fit
you, and writes a tailored resume + cover letter + screening answers for each
one. Then **you** read what it wrote, **you** approve it, and it fills in the
web form while you watch. It never lies about you, never applies to anything
without your say-so, and all of your personal data stays in files on your own
computer.

## The one-click way

**Windows** — open PowerShell (press Start, type "powershell", Enter), paste
this, press Enter, and answer the questions:

```powershell
irm https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.ps1 | iex
```

**Mac** — open Terminal (Cmd-Space, type "terminal", Enter), paste this,
press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.sh | bash
```

The script checks what you have, asks before installing anything (git,
Node.js, Claude Code), downloads this project, and offers to open Claude Code
for you. (If you downloaded the project folder some other way, you can also
just double-click **`setup.cmd`** on Windows.)

When Claude Code opens:

1. It will ask to start a server called **playwright** — say yes. That's the
   browser it uses to fill application forms while you watch.
2. Type `/setup` and press Enter. Have your resume file ready (PDF is
   perfect — you can just tell it where the file is, like
   `C:\Users\you\Documents\resume.pdf`).

The `/setup` interview takes 30–45 minutes and it offers to start on its own
the first time you open the folder. Nine short phases: your resume, a proper
dig into what you actually did in each recent role, your proudest numbers and
achievements, what you want (titles, remote or not, company size, industries,
deal-breakers), money, contact and work authorization, your writing voice and
a few reusable stories, and finally your target companies. Stop whenever you
like — `/setup` picks up where you left off. Everything it writes down comes
from you.

## Your daily loop after that

| You type | What happens |
|---|---|
| `/hunt` | Finds new openings at your companies, scores them against your profile, and drafts complete applications for the best ones |
| *(you read)* | Open the `applications/` folder it names and read the resume + cover letter — it's your name on them |
| `node bin/jobagent.mjs approve app-xxxxxxxx` | **In a regular terminal, not in Claude** — this is your signature. The AI is physically blocked from running this command. |
| `/apply app-xxxxxxxx` | A browser window opens and fills the form. If a CAPTCHA or login appears, it stops and you do that bit. |
| `/status` | Shows where everything stands |
| *(nothing — just open it)* | `data/applications.xlsx` is a live spreadsheet of every application: company, role, status, score, dates, next follow-up. Opens in Excel, Numbers, or Google Sheets. A `.csv` sits next to it. |
| `/follow-up` | Writes polite follow-up notes when it's been a week — you send them yourself |

## If you get tired of approving one at a time

There's an optional mode where you authorize a batch up front and it submits
them back to back without stopping. You turn it on yourself (it's off by
default), and it still refuses anything below your quality bar. The steps are
in the [README](../README.md#optional-let-it-submit-without-asking-each-time),
and the honest tradeoffs are in [SAFETY.md](SAFETY.md#auto-submit-mode).

My suggestion: do your first 5–10 the slow way. You'll learn what the tool
writes well and where it needs your hand, and *then* the batch mode is a
genuine time-saver rather than a way to mass-mail strangers.

## Words you'll see

- **Slash command** — anything starting with `/` that you type into Claude
  Code, like `/hunt`. They're pre-programmed workflows.
- **Terminal** — the black text window (PowerShell on Windows, Terminal on
  Mac). You only need it for two things: the one-click setup, and the
  `approve` command.
- **MCP / playwright** — the controlled browser Claude uses to fill forms.
  You'll see every page it opens.
- **appId** — the short code like `app-1a2b3c4d` that names one application.

## Things it will never do

Apply without your authorization. Solve CAPTCHAs. Create accounts or type
passwords. Invent skills you don't have. Touch LinkedIn/Indeed (their rules
prohibit bots). Put your personal data on the internet or into git.

## If something goes wrong

- Type `/doctor` — it checks the setup and says what to fix.
- "Browser tools are locked" — you haven't approved that application yet;
  run the `approve` command in your terminal.
- Everything else: the [troubleshooting table in SETUP.md](SETUP.md#troubleshooting),
  or ask right in Claude Code — "why did /apply stop?" works.

## What it costs

Claude Code itself needs a Claude subscription or API access from
[claude.ai](https://claude.ai) — sourcing and scoring use the AI, so heavy
daily use consumes your plan's usage. The job-board polling is free (public
APIs), and the tool caps how much it does per run so costs stay predictable.
