# Follow-up for PR #260: the screen says when margin is provisional or unavailable

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #260; branch `feat/gofo-insights-ui`
- Type and scope: fix, `StatementList.jsx` and the page test. No reserved file.

## What and why

PR #259 now says how far each statement's driver cost is known (complete, provisional, unavailable). The statements page shows it: a provisional statement labels its delivery margin and
contribution "provisional" and lists the reasons (for example a record with no driver earnings yet, or carrier lines that matched no NASA work); an unavailable one shows "Not available"
for cost, margin and contribution with the reason, never $0.00. The carrier's own revenue, claims, adjustments and settlement payable stay visible in all cases.

## Database, config, dependencies

None. Money impact: none (display only).

## Tested

- `CarrierStatements.test.jsx` (14 tests): provisional with reasons, complete with no note, and unavailable with no dollar amounts for cost and margin, each with the carrier's figures intact.
  Whole frontend suite 493 pass, build passes, the files I touched pass lint.

Not tested: the page against the two real statements in a browser (they would read "provisional" because a few carrier lines match no NASA work).
