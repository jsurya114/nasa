# Everee onboarding for Local drivers, PR A: the driver API and state (issue #242)

- **Date:** 2026-11-07
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #242 / see the pull request for this branch. This is **PR A of four** (B: server gate, C: driver screens, D: history, statements and rollout tooling).
- **Branch:** `feat/everee-driver-onboarding-api`
- **Type and scope:** feat(payroll), backend and database
- **Files touched:** new `Backend/migrations/2026-11-07-issue-242-everee-driver-onboarding.sql` and `.rollback.sql`, `Backend/services/payments/everee/driverOnboarding.js`, `Backend/controllers/driver/evereeOnboardingController.js`, `Backend/scripts/evereeEmbedProbe.js`, tests `evereeDriverOnboarding.test.js` and `evereeDriverOnboardingRules.test.js`; changed `evereeClient.js` (two calls), `evereeConfig.js` (one switch), `workerStore.js` (three helpers exported, no logic change), `routes/driverRoutes.js` (four routes), `Backend/.env.example`. No reserved files. The payment flow is Jasil's area; this PR changes no payment code.

**What this is.** The client approved that every Local driver completes Everee onboarding (Jasil's handoff). PR A builds the backend base for it. **It blocks nothing and pays nobody** (the gate is PR B), and it is off unless `EVEREE_DRIVER_ONBOARDING_ENABLED` is exactly `true`.

**Driver routes (all below the driver sign-in check; the driver is always `req.driver.id`; nothing in the URL or body can name a driver, worker or type; every answer is `no-store`):**
`GET /driver/everee/status` (database only), `POST /driver/everee/onboarding`, `POST /driver/everee/session`, `POST /driver/everee/refresh`.

**Rules built in.**
- Only an enabled LOCAL driver who signed the NASA agreement can start. No type is never treated as Desi; Desi is "not required".
- **Intent first.** A row in `everee_onboarding` (unique per driver, environment and tenant) is written, under a 60-second lease and an advisory lock, before Everee is asked to create anything. A double click, a second tab or a lost answer cannot create a second worker.
- **Look before creating.** The worker is first read by our stable ID (`nasa-driver-{id}`). A worker for the driver's own email or phone (exact match, never the name) is **not linked or created over**: it goes to `needs-review` for a super admin, because a driver cannot prove they own an existing Everee record.
- **Uncertain answers.** After a timeout or 5xx on the create, nothing is posted again for 10 minutes, and the worker is looked up by its ID first. A definite 4xx refusal removes the intent so the driver can correct the details and try again.
- **An admin's unlink is final for the driver.** If an admin ever unlinked the driver in this environment, starting again does not look the old worker up or link it: the driver goes to `needs-review` (`previously_unlinked`) until a super admin links them again on purpose. (Found by the automated security review of this PR: the old worker still exists in Everee, so finding it by its ID would have undone the unlink.)
- **Complete means Everee said so** (`onboardingComplete` read from Everee on refresh). Screen events never set it. Payment readiness (tax ID not failed, not separated) stays separate. A refresh that fails keeps what was verified.
- **Sessions** are created only on a button press, for three screens only (`ONBOARDING` V2_0, `PAYMENT_HISTORY` V1_0, `PAYMENT_DEPOSIT` V1_0), with the worker taken from the verified link, never the request. The returned link must be https on an `everee.com` host. It is never logged or stored; 10 per driver per 10 minutes.
- **Nothing invented.** Name, email, phone, start date and home address come from the driver's record or what the driver types; missing ones are reported (`422 missing_fields`) before anything is written. NASA does not store the address.
- Everee collects tax and bank details inside its own screens. NASA never sees or stores them.

**Database (`2026-11-07-issue-242-everee-driver-onboarding.sql`, additive, safe to re-run; rollback file included).**
- `everee_workers`: `linked_by` becomes nullable; new `linked_by_driver_id`; a check that **exactly one** actor made the link (an admin or the driver, never a driver pretending to be an admin); new `tenant_id`; link source `embedded_onboarding` added.
- Existing links keep `tenant_id` NULL = "not verified for any tenant". They are never assumed to belong to the configured tenant (the status says `needs-review`, sessions are refused). A NULL can be filled in **once**, by a person who checked it; the guard trigger forbids any later change and still forbids rewriting who is linked to whom. For the **sandbox only**, after review: `UPDATE everee_workers SET tenant_id = '3578' WHERE environment = 'sandbox' AND tenant_id IS NULL;`. Never run that for production.
- New tables `everee_onboarding` (state, request ID, lease, uncertain-create time, review reason, verified time) and `everee_onboarding_events` (a short audit; never holds a link, a profile or bank data).
- The rollback refuses to run if a driver-made link exists.
- Ran twice, rolled back and re-applied inside a rolled-back transaction on a copy of the local database.

**Config.** New `EVEREE_DRIVER_ONBOARDING_ENABLED` (in `.env.example`; off unless exactly `true`). No new dependency.

**Money impact:** None. No payment, payable, payout, rate or amount is touched (a test proves onboarding creates no batch or item).

**The real API shape.** Request and response fields follow Everee's reference pages for `POST /integration/v1/embedded/workers/contractor` and `POST /integration/v1/embedded/session` (session response: `url`, `origin`, `expiresInMs`). Because the docs conflict in places (Jasil's note), `Backend/scripts/evereeEmbedProbe.js` proves them against **one synthetic sandbox worker** and prints field names and types only. **It has not been run yet: the person who owns the Everee sandbox runs it** (`node scripts/evereeEmbedProbe.js --go`, after a dry run). Until it has run, the shapes above are from the documentation, not from a live call.

**Tested.** 10 rule tests with no database (states, who is required, tenant handling, profile building, allowlist, client paths and body, routes below the sign-in check). 14 database tests on a disposable copy, with a fake Everee: migration twice, one actor per link, tenant fill-once, who may start, missing details before any write, creation once with the driver as actor, lease, existing-worker review, same-name worker ignored, lost answer found by ID, cooldown, refusal and outage, sessions (allowlist, versions, ignored IDs, tenant, unsafe links, rate limit), refresh (timeout keeps completion), one driver cannot see another, no payment rows produced. The existing Everee worker, webhook and status tests still pass; the whole backend suite passes without a database (193 passed, 62 skipped as they need one). One existing submit test fails on a copy that holds my real sandbox payment, as it did before this change.

**Not tested.** Any real Everee call (see above). Concurrency with two real connections (the lease and lock are exercised with a seeded lease, not two simultaneous requests). A real browser or phone (there is no screen yet). Rate limiting beyond the per-driver session count. The webhook-before-link case is PR D.

**Risks and follow-ups.**
- Existing sandbox fixture links need the one-time sandbox backfill above before their sessions work.
- PR B adds the server gate; PR C the screens and mobile view; PR D history, statements, bank management, webhook reconciliation for unlinked pending workers, the admin onboarding list, and staged rollout tooling.
- Collecting the real address and start date in the driver screens, and confirming the Embed feature is enabled on the tenant, are PR C and the probe.

## Review round 1 (Jasil, three P1)

1. **Provider worker ID.** Everee's lookup by our external ID answers with `id` equal to that same alias; the canonical worker ID exists only as the `workerId` of the search result whose `externalWorkerId` is exactly ours. The link now stores the **canonical `workerId`** in `everee_worker_id` (what sessions send and the payment-status check compares) and keeps the alias in `external_worker_id`. This applies to both the first create and the lost-answer recovery. If the canonical ID is not visible yet, nothing is linked and the next press reads it again; two results for our ID go to review. The create answer's `id` is never trusted as the worker ID.
2. **Admin recovery.** `workerStore.linkDriver` and `createSandboxWorker` (the only other link writers; checked with a search for every `INSERT INTO everee_workers`) now record the configured tenant on a **new** link. Legacy rows with no tenant stay untrusted; nothing is backfilled and a NULL is not accepted. A test goes through the real `lookupDriver` and `linkDriver`: a driver sent to review is linked by a super admin and then shows `in-progress` and can open a session.
3. **Revalidate at persistence.** The final transaction now takes the driver lock, share-locks the driver row and the driver's links, and re-reads: the onboarding row must still be this attempt (`attempts` fence) and not in review; the driver must still be an enabled Local driver who signed; no admin unlink in this environment; no live link made meanwhile. It writes the link only if all hold; otherwise it writes nothing and leaves the driver in the right review state (`no_longer_eligible`, `previously_unlinked`) or untouched (superseded, already linked). Every write to the onboarding row is fenced by `attempts`, so a superseded request cannot let go of or overwrite a newer attempt's lease. The provider calls stay outside these transactions. Tests change the situation in the middle of the provider call (admin link then revoke, reclassification, account disabled, takeover by another attempt, an admin link made meanwhile) and show no wrong link is written.

Tests: 17 database tests for onboarding (was 14) and the 10 worker tests pass on a disposable copy. The real embedded create/session probe is still unrun.

## Review round 2 (Jasil: the revocation race)

Jasil showed with two real connections that a driver-created link could remain live after an administrator committed a revocation: the admin writers did not take the onboarding advisory lock, and a row lock cannot cover the case where no link row exists yet. Fixed with **one per-driver lock protocol** (`driverLock.js`, a transaction-scoped advisory lock on the driver):
- the driver's own onboarding (claim and final save) takes it, as before;
- the admin writers now take it too: `linkDriver`, `unlinkDriver` and `createSandboxWorker` run their write inside a transaction that first takes the driver's lock. Their provider (Everee) lookups stay outside it;
- so any two of these are strictly one after the other, including when there is no link yet. A save that was waiting then re-reads under the lock (as in round 1) and sees the committed revocation, so it writes no link and leaves `previously_unlinked` for review.

Regression tests use **independent database connections** (`evereeDriverLock.test.js`; they commit rows, so they run only on a throw-away database whose name contains "test" with `PAYROLL_TEST_DB_COMMIT=1`): each real admin writer waits while another connection holds the driver's lock and then applies (they fail without the change); a save waiting behind an administrator's open revocation writes no live link; and with no revocation the same save links normally.

Non-blocking follow-up from the review done too: `scripts/evereeEmbedProbe.js` now resolves the canonical worker ID from the exact search result, like the application, before opening the session. Jasil has since run the real embedded create and `ONBOARDING V2_0` session against a fictional sandbox worker successfully; the probe has still not been run by the author.
