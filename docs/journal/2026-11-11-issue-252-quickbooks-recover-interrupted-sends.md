# QuickBooks: recover an item left "submitted" when the server stopped mid-send

- Date: 11 November 2026
- Author: Jayasoorya with Claude Code, from the follow-up list Jasil sent for the Desi QuickBooks work
- Issue: #252 (payroll work); PR: this one, branch `fix/quickbooks-recover-interrupted-sends`
- Type and scope: fix(payroll), backend and frontend. No migration. None of the reserved Excel and pay-calculation files is touched.
- Files touched: `quickbooksPayments.js`, `paymentRules.js`, `QuickbooksResult.jsx`, their tests, and `docs/QUICKBOOKS_DESI.md`.

## What and why

A Desi driver's cash is recorded first, then each statement is sent to QuickBooks (a bill and a bill payment). If the server stopped after the cash was recorded, or in the middle of a send, the item stayed "submitted" for ever: the batch showed "Being recorded in QuickBooks…", and Retry was hidden because the screen offered it only for failed or unconfirmed items. The retry endpoint itself would have accepted a submitted item, but it could not tell a dead send from one still running, so it was not safe to offer.

Now:
- A submitted item is **interrupted** when nothing in its batch has changed for 10 minutes (`STALE_AFTER_MINUTES`). One item takes at most about 80 seconds (four requests, each cut off at 20), so a running send is never mistaken for a dead one. The batch view says `interrupted` per item and offers Retry (`canRetry`) only then.
- `retryBatch` takes failed and unconfirmed items as before, and takes a submitted item only when interrupted. A submitted item that may still be sending is left alone, and a second Retry click while the first is sending is refused with "some records are still being sent to QuickBooks". The retry runs under the same pay-run lock as before.
- The attempt the stopped send left without an answer is closed as `timeout` ("interrupted: the server stopped before an answer was recorded"), so no attempt is left open. Nothing is guessed: the new attempt asks QuickBooks for the bill by its number and its balance, so a bill or payment that did land is found and never made twice.
- The cash receipt and the statements are never touched by a retry.

## Money impact

None. No pay amount, receipt or statement changes. QuickBooks entries are still made once per statement, by the bill number and the balance check.

## Database

None. The existing `updated_at` of the items is the activity signal.

## Validation

- `tests/quickbooksPayments.test.js` (database, rolled back): a cut-off item is not retryable while fresh (Retry refused, nothing sent), becomes interrupted after 10 minutes, and the retry posts one bill and one payment (found by number), leaves the cash receipt as it was and closes the open attempt; a retry takes the failed item and leaves a fresh submitted one unsent (its attempts unchanged); a second Retry while one is sending is refused. The existing eight tests pass.
- Screen test: an interrupted item says so and offers Retry; a fresh submitted one shows "Being recorded in QuickBooks…" without Retry.
- Not checked: against real QuickBooks (sandbox credentials are still to be set up), or by actually stopping the server mid-send.

## Risks and follow-ups

- If a send is hung for more than 10 minutes without changing anything and is later retried, two sends could overlap. They are still safe in QuickBooks (the bill is found by number, with fixed request IDs for the bill and the payment), but the second would show a refusal or a duplicate-answer message.
- The other follow-ups in Jasil's list are not code: Intuit credentials, the sandbox end-to-end check, reconciling earlier cash payments with the bookkeeper, and W-9 retention.
