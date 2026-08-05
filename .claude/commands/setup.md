---
description: In-depth guided setup — imports your resume, interviews you properly, and builds your whole profile, achievements bank, answers, targets, and config. Start here.
argument-hint: [path-to-resume]
---

You are running a real intake interview with someone who may have NEVER used
Claude Code or a terminal. Two goals, equally important: (1) collect enough
depth that every application this tool writes sounds like *them* and cites
*their* evidence, and (2) never make them feel interrogated.

**How to run it well**
- One topic at a time. Ask, listen, reflect back what you heard, then write.
- Use AskUserQuestion for anything with discrete options; free text for
  stories and numbers.
- Save after each phase — never lose their work if the session ends. Tell
  them they can stop anytime and resume with `/setup`.
- Nine phases; announce the phase and roughly where they are ("phase 3 of 9").
- Dig one level deeper than the first answer. "I improved performance" →
  "improved from what to what, measured how, over what period?" Numbers,
  scope, and ownership are what make an application land.
- Everything you write must come from THEM. Never pad, never invent, never
  "improve" a fact. If they don't know a number, write what they do know.
- This interview runs in the MAIN conversation — do not delegate it.

## Phase 0 — Scaffold and set expectations

Run `node bin/jobagent.mjs init` (never overwrites existing files). Then:

> "I'm going to interview you properly — about 30-45 minutes, and worth every
> minute, because everything I learn here goes into every application. We'll
> do your resume, your accomplishments, what you actually want, and the
> companies you're targeting. You can stop anytime and pick up with /setup.
> Everything stays in files on this computer."

If files already exist, ask whether they want to update a specific area or
start fresh, and skip to that phase.

## Phase 1 — Resume import

- If an argument was given ($ARGUMENTS), run `node bin/jobagent.mjs upload "$ARGUMENTS"`.
- Otherwise: "Do you have a resume already? Give me the file path, drag the
  file into the chat, or paste the text — PDF is ideal. If it's a .docx,
  export a PDF first." Then `node bin/jobagent.mjs upload "<path>"`.
- Read the uploaded file from `profile/uploads/` and transcribe it faithfully
  into `profile/resume.md`: every employer, title, date, bullet, and metric
  exactly as written. Fix only layout damage (columns, page headers,
  hyphenation). This is transcription, not editing.
- Show it back. "Is anything missing or garbled?" Fix what they flag.
- Mention the PDF for uploads: if they uploaded a PDF, /apply can use it as-is;
  otherwise suggest exporting one to `profile/resume.pdf` later.
- No resume yet? Build one here: walk employer by employer (company, title,
  dates, what they owned, what changed because of them), then education.

## Phase 2 — Work history deep dive

For each of the last 2-3 roles on the resume, ask (and let them ramble):
- "What did you actually own day to day — and what did you own by the end?"
- "What's the thing you'd point at and say *I did that*?"
- "Scale: team size, users, revenue, requests, budget, whatever applies."
- "Tech and tools you personally used, not just what the team used."
- "Why did you leave / why are you leaving?" (shapes the cover-letter story;
  never gets quoted verbatim into an application)

Fold anything resume-worthy into `profile/resume.md` bullets (their words,
tightened), and anything metric-shaped into the achievements bank in phase 3.

## Phase 3 — Achievements & metrics bank

Mine `resume.md` for quantified wins and propose them as entries. Then dig
for what the resume left out, one question at a time:
- "Numbers you're proud of that aren't on the resume? Revenue, users, cost
  saved, time saved, growth, uptime, team size, throughput."
- "Anything you built or fixed that people still use?"
- "Side projects, open source, writing, talks, teaching?"
- "Certifications, licenses, awards, formal recognition, promotions?"
- "Anything you're *known* for at work — the thing people come to you for?"

Write `profile/achievements.json` following `achievements.example.json`
(achievements / projects / certifications / awards / talks_and_writing).
Read it back and ask: "Everything here must be true and defensible if an
interviewer digs in — anything to soften or cut?"

## Phase 4 — What they actually want

Fill the `targets` section of `profile/profile.json`:
1. **Titles** they want (and titles they'd accept but not seek).
2. **Seniority** level(s).
3. **Title keywords to exclude** — explain plainly: "words that mean 'not
   for me', like 'recruiter' or 'unpaid' — postings containing them never
   even reach scoring."
4. **Remote / hybrid / onsite**, plus acceptable cities if not fully remote,
   and time zones they can work.
5. **Company size / stage** preference (startup, scaleup, enterprise, agency).
6. **Industries** to prefer and to avoid.
7. **Deal-breakers** — the hard nos ("security clearance", "100% travel",
   "commission only", on-call, specific companies).

## Phase 5 — Money

Two different numbers, and say so explicitly:
- `targets.salaryFloor` — "the number below which I don't want to see the
  job at all." It's a hard filter: postings that state less get dropped.
- `screeningDefaults.salaryExpectation` — "what I want the form to say when
  it asks." Usually a range, phrased comfortably.

Also: bonus/equity expectations, and whether they'll disclose current salary
(default: don't — many places it's illegal to require it).

## Phase 6 — Contact, authorization, logistics

Name, email, phone, city/state/country, LinkedIn / GitHub / portfolio URLs
(pull from the resume; confirm each). Then work authorization in the exact
truthful phrasing they're comfortable with, plus `screeningDefaults`: start
date / notice period, relocation, willingness to travel, how-did-you-hear.

## Phase 7 — Voice, answers, and stories

1. Ask how they want to come across in writing, then set
   `tailor.coverLetter.tone` in `config/policy.json`
   (`professional` | `warm` | `direct` | `enthusiastic`) and note anything
   they hate (buzzwords, "passionate about", exclamation marks).
2. Build `profile/answers.json` from their screening defaults plus the
   standard questions in `answers.example.json`. Read each answer back; edit
   to their taste. Every answer must be true.
3. Capture 2-3 reusable **stories** as achievements entries tagged
   `story`: a hard problem solved, a conflict or failure handled, something
   they led. These feed cover letters and screening answers.

## Phase 8 — Target companies

Ask for 5-15 companies they'd genuinely like to work at — dream picks and
realistic ones. For each, get the careers-page URL and run
`node bin/jobagent.mjs detect <url>`. Write `config/companies.json`:
detected boards get `{company, ats, slug}`; the rest get
`{company, careersUrl}` for the discovery agent. If they can't name
companies, ask what *kind* of company instead, keep the example boards so
`/hunt` has something to chew on, and show them how to add more later.

## Phase 9 — Ground rules, verify, teach

1. Show the defaults from `node bin/jobagent.mjs policy` in plain language:
   applications per day, shortlist size, cover-letter length and tone, the
   score threshold for tailoring. Write only the values they change into
   `config/policy.json`.
2. Explain the two submission modes honestly and let them pick — default to
   review-each-one:
   - **Review each one** (`approval.mode: "manual"`, the default): they read
     each package and run `node bin/jobagent.mjs approve <appId>`.
   - **Auto-submit** (`approval.mode: "auto"`): they authorize a batch up
     front with `node bin/jobagent.mjs auto-enable`, then `/auto-apply` sends
     them back to back. Say the tradeoff plainly: faster, but applications go
     out unread, and only packages scoring above the floor with complete
     answers qualify. Recommend starting manual for the first handful so they
     can see the quality, then switching if they like it.
     Do not enable auto mode for them silently — they set it, and only they
     can run `auto-enable`.
3. Run `node bin/jobagent.mjs doctor` — fix every FAIL, explain INFO lines
   (the resume PDF is the usual one).
4. Confirm the Playwright browser MCP is connected (look for
   `mcp__playwright__*` in your tools); if missing, point to
   docs/SETUP.md § MCP servers.
5. Teach the loop in their words:
   - `/hunt` — "finds jobs, scores them, writes draft applications"
   - review `applications/<folder>/` — "read it; it's your name"
   - `node bin/jobagent.mjs approve <appId>` in their own terminal —
     "your signature; I'm not allowed to run it, ever"
   - `/apply <appId>` — "a browser opens and fills the form"
   - `/status`, `/follow-up`, and `data/applications.xlsx` — "dashboard,
     nudges, and a spreadsheet of everything, always current"

Finish with a one-screen summary of what you wrote where, and offer to run
`/hunt`.
