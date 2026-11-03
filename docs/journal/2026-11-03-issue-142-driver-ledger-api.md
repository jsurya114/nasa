# Driver ledger: advances, expenses, reimbursements and manual claims, backend (issue #142, part 1)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #142 (part of #138) / see the pull request for this branch. Stacked on #147 and #148 (uses their claim rules and claims table).
- **Branch:** `feat/payroll-driver-ledger` (from `feat/payroll-claims-store`)
- **Type and scope:** feat(payroll)
- **Files touched:**
  - new: `Backend/migrations/2026-11-03-issue-142-driver-ledger.sql` and `.rollback.sql`, `Backend/services/payroll/ledger/ledgerRules.js`, `Backend/services/payroll/ledger/ledgerStore.js`, `Backend/controllers/payroll/ledgerController.js`, `Backend/routes/payrollRoutes.js`;
  - new tests: `Backend/tests/ledgerRules.test.js`, `Backend/tests/ledgerStore.test.js`;
  - changed: `Backend/app.js` (one import and one mount);
  - this journal entry. No reserved files.

**What and why.** The backend for the client's workflow city → driver → type → amount → reason, with an effective date and an intended payday. The screen is the next pull request; applying entries to pay, exactly once, is #143.

- **One table, `driver_ledger_entries`, never edited or deleted.** A database trigger refuses UPDATE and DELETE. A mistake is undone by a later `void` entry that reverses it, and each entry can be voided once (unique `voids_entry_id`).
- **Types with a fixed direction,** so nobody picks a sign:
  - debit (the driver owes NASA more): `advance`, `expense`, `manual_claim`;
  - credit (the driver owes less, or NASA owes the driver): `advance_repayment` (repaid outside payroll), `reimbursement`;
  - a `correction` states its own direction.
  
  Amounts are always positive, to the cent, at most 10,000.
- **Repayment arrangement for any debit** (owner's proposed policy, 3 Nov 2026, to be confirmed with the client): `recovery_plan` is either `full_next_payday` or `installments`, with `installment_amount` (for example $200 recovered as $50 over four paydays). If no arrangement is recorded, the entry is shown as `needs_review` and #143 never recovers it automatically. Credits cannot carry one. The database refuses an instalment that is not smaller than the whole amount.
- **An advance must say** whether it was already paid out outside payroll (`disbursed_outside_payroll`), so recording it never pays it again. Only advances can carry that flag.
- **City access on the server for every call:** a super admin sees all cities; a city admin sees only cities in `admin_city_ref`. The driver must currently belong to the chosen city. The admin comes from the token.
- **No double entries:**
  - the form sends a `requestId` (UUID), so the same submission twice returns the first entry, and a reused ID for something else is refused (409);
  - a manual claim for a waybill and claim type that the carrier already sent (#141) is refused, because it is applied from the import;
  - the same manual claim entered twice is refused until the first is voided.
- **The DFW GOFO + Tracking interruption exemption applies to manual claims too.** The entry is kept, marked `exempt`, and counts zero. It uses the same rule function as the import, so there is no second copy of the rule.
- **Balance per driver** = debits minus credits of entries that still stand (voided entries and their voids cancel out; exempt claims count zero). Positive means the driver owes NASA; negative means NASA owes the driver. It is computed from all entries, not just the listed page.
- **API** (admin and super admin, `/admin/payroll`):
  - `GET /ledger?cityId=&driverId=` lists the newest 500 entries plus balances. A city admin must name a city.
  - `POST /ledger` records an entry.
  - `POST /ledger/:entryId/void` voids one.
  - The new route file is mounted before `/admin`, so these requests are authenticated once.

Not decided here, on purpose (owner decisions in #142/#143): installment recovery, approvals, what happens when deductions exceed earnings, and carry-forward. Nothing in this part changes what anyone is paid.

**Database.** Additive: run `Backend/migrations/2026-11-03-issue-142-driver-ledger.sql` after the #141 claims migration (back up first, test on a copy, safe to run twice). Rollback: `...driver-ledger.rollback.sql` drops the table and trigger function, which deletes recorded entries, so back up first. **Do not run on production yet** (no screen until the next pull request, and no pay effect until #143).

**Config and dependencies.** None. Developer test switch `PAYROLL_TEST_DB=1` (as in #141).

**Money impact.** None. Nothing reads the ledger into pay yet. Balance example from the test: expense 30 + advance 100 + exempt claim 0 + claim 40 − reimbursement 12.25 = 157.75 owed by the driver; a voided 7.75 expense leaves it at 157.75.

**Tested.**
- **Rules (6 unit tests):** fixed directions; cleaned input; field-by-field errors (bad IDs, types, amounts, dates, reason, request ID); the advance paid-out flag; manual claim type and waybill; void input.
- **Database (8 steps)** against the local copy, all in one transaction that is always rolled back, including both migrations and the made-up admins, city and driver moves:
  - a city admin records an entry in their city;
  - wrong city, an admin with no city, and a driver from another city are refused;
  - the same form twice gives one entry, and a reused request ID is refused, including by another admin;
  - the exemption applies to manual claims;
  - a duplicate manual claim and an already-imported carrier claim are refused;
  - balances add up as above;
  - a void reverses once, only within the admin's cities, and a void cannot be voided;
  - UPDATE and DELETE are refused by the database.
- **HTTP** against a temporary backend from this branch, on port 5003, stopped afterwards. Tokens were made for made-up accounts; no real admin was used:
  - no token: 401; driver token: 403;
  - city admin with no city, or a bad city ID: 400; a city that isn't theirs: 403;
  - a bad body: 400 with the field list; a valid entry for a city that isn't theirs: 403;
  - a bad void ID: 400;
  - the log shows only method and path.
- Whole backend suite: 71 tests, 37 run and pass, 34 database tests skipped as before.

**Not tested.**
- A successful entry over HTTP (the local database does not have the new table, and the database tests cover the same code).
- The screen (next pull request).
- Two admins at the same moment (the request-ID and void unique constraints are in place; not exercised in parallel).
- Production data.

**Risks and follow-ups.**
- **#143 must refuse to void an entry already applied to a pay run.** Today nothing is applied, so every entry can be voided.
- The balance a city admin sees covers only their city's entries. A driver who changed city may have entries in the old city.
- Exempt city name, as in #141: the rule matches "DFW GOFO", and the local copy has "Dallas GOFO".

## Review fixes (Jasil's review on #149, 3 Nov 2026)

- **A changed request was taken as a replay.**
  - Before: the first check compared only driver, type and amount, and the fallback after a lost insert race compared even less. A 40 debit correction sent again under the same request ID as a 40 credit correction was answered "replay" with the debit, so the credit was never recorded.
  - Now `entryFingerprint` / `rowFingerprint` (in `ledgerRules.js`) compare every saved field. Both paths use the same function, so an identical form is a replay and any difference is refused with 409. The fields: driver, city, type, direction, amount, reason, date, intended payday, paid-out flag, claim type, waybill, repayment plan and instalment.
  - A void replay must also match its reason.
- **Hand-entered and carrier claims, both arrival orders.**
  - Carrier first: a hand-entered claim is refused (409), as before. The claim type is now compared with the same `claimTypeKey` the import uses. Before, it was `lower()`, which missed differences in spacing.
  - Hand-entered first: the carrier claim is held as `review` (#148).
  - Voiding a hand-entered claim takes the subject lock *before* writing the void. It then releases the held carrier claim into matching. An import at the same moment waits and sees the void.
- **Corrections may name the claim they correct** (waybill and claim type, both or neither), so a refund after a carrier lowers a claim can be traced (#143). Other types that send a claim are now refused, where before the fields were silently dropped.
- **Tests.**
  - Ledger store: 12 pass (was 10). New: Jasil's exact debit/credit case, and changed instalment, plan, date, payday, paid-out flag, reason, driver, waybill and claim type all give 409, while an identical form is still a replay. Also: a carrier claim held after a hand-entered one, held again when amended, released by the void. Both new tests fail on the old code.
  - Ledger rules: 9 pass, including the fingerprint covering every field.
- **Not reproduced:** two connections racing with different payloads. The test runs inside one transaction that is always rolled back, so a second connection cannot see its tables. That path now uses the same comparison as the first check.
