# Admin Pay runs page: draft, finalize, discard, void, and the recovery limit (issue #143, part 3)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #143 (part of #138) / see the pull request for this branch. It is stacked on #155 (admin Payroll page) and #154, and reuses `formatMoney`, `newRequestId` and the admin Nav entry. It reads the pay run API from #152.
- **Branch:** `feat/admin-pay-runs-page` (from `feat/admin-payroll-page`)
- **Type and scope:** feat(frontend)
- **Files touched:**
  - new:
    - `Frontend/src/components/Admin/PayRuns.jsx`
    - `Frontend/src/components/Admin/payRuns/RecoveryLimitPanel.jsx`
    - `Frontend/src/components/Admin/payRuns/NewRunForm.jsx`
    - `Frontend/src/components/Admin/payRuns/RunDetail.jsx`
    - `Frontend/src/components/Admin/payRuns/describeLimit.js`
    - test `Frontend/src/components/Admin/PayRuns.test.jsx`
  - changed: `Frontend/src/App.jsx` (route `/admin/pay-runs`), `Frontend/src/reuse/Nav.jsx` ("Pay runs" item, under More)
  - this journal entry.

  No reserved files are edited.

**What and why.** Admins get a **Pay runs** page (More → Pay runs):

- **Recovery limit.** The page shows the current setting in plain words: "Not set: nothing is recovered automatically", "Up to 50% of each payday's available pay", or "Up to $100.00 per payday". It also says this is a proposed policy, not yet confirmed with the client, and that a run keeps the limit it was drafted with. Only a super admin sees **Change**. A change needs a reason, and the server keeps every change.
- **City.** Only the admin's own cities are listed. Below the city come the runs for that city, newest first, with their status.
- **New draft.** Choose a period (the last 7 days by default; the server allows 31 days at most) and the pay data: daily (SpeedX) or weekly (GOFO). One request ID per draft, so a retried click returns the same run.
- **A run** shows:
  - its status and the limit it used;
  - totals for earnings, insurance, reimbursements, claim deductions, recoveries, net pay and what is still owed;
  - what is waiting outside it: unmatched claims, and ledger entries with no repayment arrangement;
  - each driver's statement with the server's flags.
- **Actions by status:**

  | Status | Who | Action |
  |---|---|---|
  | Draft | admin, super admin | **Finalize** (confirmation dialog); disabled while any statement is below zero |
  | Draft | admin, super admin | **Discard** (needs a reason, then confirmation) |
  | Finalized | super admin only | **Void** (needs a reason, then confirmation); the server also refuses while a payout is sent, paid or unconfirmed |

Nothing on this page sends money or marks pay rows paid; that is #31 and #144. Every amount is the server's frozen figure.

- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** None from this code. The actions call the existing #152 API. Its money rules and checks are unchanged.

**Tested.**
- `PayRuns.test.jsx`, 4 tests:
  - a city admin sees the limit "Not set" and no Change button;
  - the run list asks with the chosen `cityId`, and a draft sends the city, period, type and a request ID;
  - statements, flags and the waiting note are shown;
  - finalizing asks first, then shows "finalized", and a city admin gets no Void button;
  - discard is refused without a reason and sends it when given;
  - Finalize is disabled while a statement is below zero;
  - a super admin sets a 50% limit with a reason and voids a finalized run.
- Full frontend suite: 124 pass. Lint is clean on the changed files. `vite build` passes.
- By hand at phone width (390 × 844), end to end against the #152 / #153 backend on `nasa_local`, with **made-up data only**: one test city, two test drivers, an advance of 200 as 50 × 4, and an expense of 30 with no arrangement. As a made-up super admin:
  1. Limit not set, draft 1–7 Nov: 2 statements, Driver A at $196.16 with nothing recovered and flagged, and "1 ledger entry with no repayment arrangement".
  2. Discarded with a reason.
  3. Set the limit to 100% with a reason.
  4. Drafted again: Driver A at $146.16 (the $50 instalment taken), with $180.00 still owed.
  5. Finalized, which removed the Discard button, then voided with a reason.
  6. The run list showed "voided" and "discarded".

  Afterwards the payroll tables were removed with their rollback scripts and the made-up rows deleted.
- Fixed during the check: the waiting note listed "0 unmatched claim(s)"; it now names only non-zero items.

**Not tested.**
- A city admin by hand: covered by the tests, and the server refuses other cities.
- Payout states other than "not submitted": the payout work (#31) does not exist yet.
- Real production data.

**Risks and follow-ups.**
- With no limit set, the calculator's per-item flag still ends "(limit reached)". The separate "no recovery limit is set" flag explains it. The wording is in `payCalculator.js` (#150); change it in a small follow-up.
- Opening a driver's full statement from a run is not on this page; use the Payroll page.

## Review fix (Jasil's review on #156, 3 Nov 2026)

- **A late answer could show another city's run, with its actions enabled.**
  - Before: if a run was opening, a draft being made or an action running when the admin switched city, the late reply put the earlier city's run on the new city's page, with Finalize enabled. The run view did not name its city.
  - Now every city switch starts a new "epoch" and aborts the run being opened. An answer is used only when it belongs to the current epoch **and** its run's `city_id` is the selected city. This applies to opening a run, a new draft, the refresh after finalize, discard or void, and the run list (which also keeps only that city's runs).
  - The draft and action callbacks are built at render time, so they carry the city and epoch the admin saw when acting.
  - The run view names its city under the period, and the confirmation dialog title names the city and period.
  - If a run somehow does not match the selected city, no action button is shown and the page says it cannot be changed here.
- **Tests:** `PayRuns.test.jsx` now has 8 tests. The fake server can hold a reply until the test releases it. The four new tests all fail on the code before the fix:
  - the run view and confirmation name the city;
  - opening a run, then switching city before it loads;
  - drafting, then switching before the draft returns;
  - finalizing, then switching before the result returns.

  In the last three, no run, driver or Finalize button from the earlier city appears.
- Full frontend suite: 130 pass, run one file at a time. On this machine (load average about 25) parallel runs time out at random in unrelated files; the same files pass alone. Lint is clean; `vite build` passes.
