# Setup

End-to-end setup on macOS, Linux, or Windows.

## 1. Prerequisites

- **Node.js 20+** — `node -v`
- **git**
- **Claude Code** — desktop app or CLI ([install docs](https://code.claude.com/docs))
- Optional: a **Firecrawl** API key (only needed for companies without a
  public ATS board)

## 2. Clone and verify

```bash
git clone https://github.com/markus41/claude-job-agent.git
cd claude-job-agent
npm test
```

37 tests should pass. There are no dependencies to install — the core is
plain Node.

## 3. Create your private files

```bash
node bin/jobagent.mjs init
```

This copies the committed examples into live files that are **gitignored**
(your data never leaves your machine):

| File | What to put in it |
|---|---|
| `profile/profile.json` | Contact info, work authorization, targets (titles, remote policy, salary floor, deal-breakers), skills, screening defaults. The scorer takes this literally — a sloppy profile means sloppy scores. |
| `profile/resume.md` | Your **master resume**. Every tailored variant is derived from this file and may not contain anything it doesn't. |
| `profile/resume.pdf` | *(create manually)* A current PDF export of your resume for form uploads. Export from Word/Google Docs, or `pandoc resume.md -o resume.pdf`. |
| `profile/answers.json` | Your screening Q&A bank — consistent answers to the questions every form asks. |
| `config/companies.json` | Target companies. For each: `{ "company", "ats", "slug" }`. |
| `config/policy.json` | Allowlist, caps, approval TTL, tailoring thresholds. Defaults are sane. |

**Finding a company's ATS slug:** open their careers page, copy the URL of
any job posting, and run:

```bash
node bin/jobagent.mjs detect https://boards.greenhouse.io/cloudflare/jobs/1234
```

If the careers page doesn't resolve to Greenhouse/Lever/Ashby, add the
company with just `{ "company": "...", "careersUrl": "..." }` — the
job-discovery agent will chase it via Firecrawl.

## 4. Install the MCP servers

**Playwright (required for /apply):** the repo ships a project-scoped
`.mcp.json`, so Claude Code will offer to start it automatically the first
time you open the project — approve it. Manual alternative:

```bash
claude mcp add playwright -- npx @playwright/mcp@latest
```

The browser must run **headed** (a visible window) so you can take over for
CAPTCHAs and logins. That is the Playwright MCP default; don't add a
`--headless` flag.

**Firecrawl (optional, for unknown-ATS companies):**

```bash
claude mcp add firecrawl -e FIRECRAWL_API_KEY=fc-your-key -- npx -y firecrawl-mcp
```

## 5. First run

```bash
claude
```

Inside Claude Code:

```
/doctor      # environment + config check — fix anything it flags
/hunt        # discover → shortlist → score → tailor top matches
```

`/hunt` ends with a review queue. For each queued application:

1. Open `applications/<folder>/` and read `resume.md`, `cover-letter.md`,
   `answers.md`. Edit anything you want — they're your words.
2. Approve it **in your own terminal** (not in Claude):

   ```bash
   node bin/jobagent.mjs approve app-xxxxxxxx
   ```

3. Back in Claude Code: `/apply app-xxxxxxxx`. A browser window opens and
   fills the form. If a CAPTCHA or login appears, the agent stops and asks
   you to do that part in the window.
4. The submission is recorded with confirmation details; `/status` shows the
   pipeline, `/follow-up` drafts follow-up notes when they come due.

## 6. Running it on a schedule (optional)

The sourcing/scoring/tailoring half is safe to run headless (it can't submit
anything — approval physically requires your terminal):

```bash
claude -p "/hunt" --max-turns 40
```

Wire that into cron (macOS/Linux) or Windows Task Scheduler daily. Keep
`/apply` interactive — that's the half you want your eyes on anyway.

## Windows notes

- Everything works in PowerShell; use `node bin/jobagent.mjs …` exactly as
  shown (forward slashes are fine).
- Launch `claude` from the repo root so the relative hook paths in
  `.claude/settings.json` resolve.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `404 … board slug is probably wrong` | Re-run `detect` with a real posting URL; some companies rename their board. |
| Browser tools denied: "no armed apply session" | Run `approve` in your terminal; sessions expire after `approval.sessionTtlMinutes` (default 60). |
| Navigation denied to a legitimate host | The company's form spans an extra domain — add it to `allowlist.hosts` in `config/policy.json`. |
| `approve requires an interactive terminal` | You ran it through an agent or a pipe. Run it directly in your own shell. |
| Score import rejected | The scorer produced malformed rows; the error names each one. Re-run scoring. |
