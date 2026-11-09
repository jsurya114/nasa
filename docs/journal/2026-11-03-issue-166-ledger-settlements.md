# Ledger settlements: repaid outside payroll, waived, partial, reversed (issue #166, part 2)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch. Requirements: Jasil's review on #166 (3 Nov 2026).
- **Branch:** `feat/ledger-settlements` (from `develop`)
- **Type and scope:** feat(payroll), backend
- **Files touched:**
  - new: `Backend/migrations/2026-11-03-issue-166-ledger-settlements.sql` and `.rollback.sql`, `Backend/services/payroll/ledger/ledgerSettlements.js`, test `Backend/tests/ledgerSettlements.test.js`;
  - changed: `ledgerRules.js` (two input checks), `ledgerStore.js` (list and void read settlements), `ledgerController.js`, `routes/payrollRoutes.js`, `payRunStore.js` (one SQL line) and `statementStore.js` (one SQL column);
  - this entry. No reserved files.

**What and why.** An admin can clear all or part of one ledger debit without payroll, and every case is a permanent row.
- **Outside repayment:** the driver repaid it. Needs the date, the amount and a payment reference.
- **Waiver:** NASA forgives part of it. Needs a reason. Only a super admin can record or reverse one (my reading of "authorized administrator"; tell me if city admins should too).
- **Reversal:** undoes one settlement by a row of the same amount. A reversal cannot be reversed; settle again instead.
- Each row names the exact entry, the driver and city (copied from the entry, so they cannot differ), the admin and the time.
- **Partial:** the amount may not exceed what is still outstanding on that entry (amount, less recoveries by draft or finalized pay runs, less earlier settlements).
- **No double recovery:** the pay run subtracts a settlement from the entry's outstanding before it recovers, so a settled amount is never also deducted from pay. Settling and building a run take the same city payroll lock, so they cannot pass each other.
- **Void:** an entry with a standing settlement cannot be voided until the settlement is reversed.
- **Retries:** a request ID sent again by the same admin for the same thing returns the first result; for anything else it is refused (409).

API (admin and super admin, `/admin/payroll`): `POST /ledger/:entryId/settlements` and `POST /ledger/settlements/:settlementId/reverse`. City access is checked on the server, and the admin comes from the token.

The older "advance repaid outside payroll" entry (a pooled credit spread over the oldest debts) is unchanged. This new path is for a repayment or waiver that belongs to one exact entry.

Not in this part: linked edit and the history view (next PR), the dashboard row, and the Payroll page buttons.

- **Database:** additive. Run `Backend/migrations/2026-11-03-issue-166-ledger-settlements.sql` after the #142 migration (back up first, test on a copy, safe to run twice). Rollback: `...ledger-settlements.rollback.sql`, which deletes recorded settlements. I ran the migration on `nasa_local` only. **Do not run on production yet.**
- **Config and dependencies:** None.
- **Money impact:** none until a settlement is recorded; no settlement exists. Once recorded, a settlement lowers what a pay run recovers from that entry. Example from the test: a $100 debit with $60 repaid outside payroll recovers $40 on the next run.

**Tested.** `ledgerSettlements.test.js` (rules, plus 8 database steps in one rolled-back transaction, made-up data): partial repayment with reference, actor and date; the balance and the entry's outstanding; replay and reused request ID; over-settling refused and the rest settled; waiver super admin only; wrong city, a credit and a missing entry refused; reversal once and not reversible; void blocked until reversed; the database refuses edits, deletes and bad references; a pay run recovers only the remainder. The whole backend suite passes (146 pass, 36 skipped for the other database switch, 0 fail).

**Not tested.** The HTTP routes with real tokens (they load and mirror the existing void route); production data; a settlement racing a pay run from two sessions at once (the same lock is used, not exercised here).

**Risks and follow-ups.** The statement balances count only finalized pay-run recoveries as taken, as before. Separating "reserved" from "settled" labels is part of the later dashboard work.

## Review fix (Jasil's review on #168, 3 Nov 2026)

- **A repeated request skipped the current permission checks.** Before, a settlement or reversal sent again returned the stored record before any city or role check. Now every outcome that returns a record is authorized first: the record's city must be one of the admin's cities now, and a waiver, or the reversal of one, needs a super admin now. This covers the early replay and the replay after a lost insert race (one shared function), and it runs before the "different request" refusal, so another city's admin learns nothing from a guessed request ID. The exact-content comparison and the append-only records are unchanged.
- **Tests.** A new case: a plain admin repeating a waiver or its reversal is refused (403); an admin whose city access was withdrawn is refused even for an exact repayment replay; with access back, the exact replays still work and nothing is recorded twice; another city's admin is refused.
- **Test cleanup.** `weeklyClaimsFlow.test.js` removed the ledger table while the settlements table still referenced it; its missing-tables case now rolls the settlements migration back first. Passes with both database flags.
- **Known, not caused here.** `assignmentHistoryFlow.test.js` fails 3 subtests on a clean `develop` too, on a database that already has the pay-run tables (it cannot drop `courier_claims`).
