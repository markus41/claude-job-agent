---
description: Hard-filter unscored jobs into a shortlist, then have the fit-scorer agent score them against the profile.
argument-hint: [limit]
---

1. Run `node bin/jobagent.mjs shortlist` — appending `--limit $1` if a limit
   argument was given — and show the rejection histogram.
2. If the shortlist has items, delegate scoring to the `fit-scorer` subagent.
3. Relay its verdict distribution and the strong matches with one-line
   reasons, then suggest the natural next step (`/tailor` for the best ones).
