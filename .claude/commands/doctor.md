---
description: Verify the environment — config, profile, privacy rules, hooks, and MCP wiring.
---

Environment check:
!`node bin/jobagent.mjs doctor`

For every FAIL above, explain the fix in one line and offer to do the safe
ones (creating files from examples via `node bin/jobagent.mjs init`,
non-destructive edits the human asks for). Also confirm the Playwright MCP
server is connected (check your available tools for `mcp__playwright__*` or a
plugin-provided Playwright); if it is missing, point the human at
docs/SETUP.md § "Install the MCP servers".
