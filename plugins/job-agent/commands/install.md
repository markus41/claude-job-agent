---
description: Guided install of the claude-job-agent workspace — checks prerequisites, downloads the repo, scaffolds private files, and hands off to /setup.
argument-hint: [destination-folder]
---

You are installing https://github.com/markus41/claude-job-agent for someone
who may be brand new to Claude Code and terminals. Be patient and concrete;
give copy-paste commands one at a time.

1. **Prerequisites.** Check `git --version` and `node --version` (need Node
   22+). If either is missing/too old, help them install it for their OS
   (winget on Windows: `Git.Git`, `OpenJS.NodeJS.LTS`; Homebrew on macOS;
   distro package manager on Linux), then re-check.
2. **Already installed?** If the current directory (or `$1`) already contains
   `bin/jobagent.mjs`, skip cloning and use it.
3. **Download.** Otherwise clone it: destination = `$1` if given, else
   `~/claude-job-agent` (Windows: `%USERPROFILE%\claude-job-agent`):
   `git clone https://github.com/markus41/claude-job-agent.git <dest>`
   (Shortcut you can offer instead: the repo's one-click bootstrap —
   Windows: `irm https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.ps1 | iex`,
   macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.sh | bash` —
   it does steps 1–4 by itself.)
4. **Scaffold.** Run `node bin/jobagent.mjs init` inside the destination.
5. **Hand off.** The pipeline's commands, agents, and safety hooks are
   project-scoped — they only load when Claude Code is STARTED IN that
   folder. Tell them exactly:
   - close/exit this session,
   - open a terminal in `<dest>` (or `cd <dest>`),
   - run `claude`,
   - approve the `playwright` MCP server when prompted,
   - type `/setup` and follow the interview (have a resume file handy).
6. Reassure them: their profile/resume data stays in gitignored local files,
   and nothing is ever submitted without their personal per-application
   approval in their own terminal.
