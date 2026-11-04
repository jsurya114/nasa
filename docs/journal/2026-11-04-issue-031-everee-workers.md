# Everee, PR 1: link each driver to an existing Everee worker (issue #31)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / see the pull request for this branch
- **Branch:** `feat/everee-workers` (from `develop`)
- **Type and scope:** feat(payroll), backend (no screen yet)
- **Files touched:** new `Backend/migrations/2026-11-04-issue-031-everee-workers.sql` (+ rollback), `Backend/services/payments/everee/{workerRules,workerStore}.js`, `Backend/controllers/payroll/evereeWorkerController.js`; edited `evereeClient.js` (three read/create calls) and `Backend/routes/payrollRoutes.js` (six routes); tests `evereeWorkerRules`, `evereeWorkers`, `evereeClientWorkers`; this entry. No reserved files.

**Decisions this follows (Jasil, on #31, 4 Nov 2026).** The client already moved its drivers into Everee from QuickBooks, so a worker usually exists. Look before creating, never duplicate. Match by **email or phone only, never by name**. No match, or more than one, leaves the driver unlinked and blocked with the reason shown. A link is saved only from one exact, unambiguous match. A one-word name or a missing 10-digit phone is a blocker (nothing is invented), and the first and last name that would be sent are shown. Sandbox only: no live token or tenant, not even to read workers, until Jasil approves in chat.

**What it does** (all routes under `/admin/payroll/everee/workers`, **super admin only**, and each checks the city and that the driver belongs to it):
- `GET ?cityId=`: the city's drivers from the database only (no call to Everee): link state (`ready`, `linked`, `unlinked`, `blocked`), the data problems, and what the name would be sent as. No email or phone is returned.
- `POST /lookup`: read-only. Searches Everee for the driver's email and phone only (Everee's search is loose text, so each result is compared for an exact email or phone and the name is ignored). Answers `match`, `no_match`, `ambiguous` or `blocked`, with the found workers' names and **masked** email and phone. A search that hit Everee's limit of 10 is never called a clean match. A worker already linked to another driver is never offered.
- **Conflict.** A worker that matches on one of email or phone while the other is present on both sides and different (for example the same phone with another email: a relative, or an old number) is a `conflict`: shown, with what differs, but never linked automatically. A field missing on one side is not a conflict.
- `POST /link`: the server repeats the lookup and saves the link only if the result is one match and the worker ID sent is that worker. Reads the worker once to store whether onboarding is complete, the tax-ID status and whether they have left.
- `POST /refresh`: re-reads those three facts. **Ready to pay** = onboarding complete, tax ID not failed, not separated.
- `POST /unlink` (a reason is required): the link is closed and kept as history; the driver can be linked again.
- `POST /sandbox-test`: sandbox only (refused in production). Creates a test contractor with **made-up data** (never a real driver's name, email, phone or tax ID) and links it, so the payment steps can be tested. It first looks (the driver's own contact, if any, and the test worker's own ID) and reuses a test worker made earlier instead of creating another.

**Database** (`2026-11-04-issue-031-everee-workers.sql`, additive; rollback file beside it; run on a copy first). One table `everee_workers` (driver, environment `sandbox`/`production`, Everee worker ID, external ID, link source, onboarding/tax/separated flags, who and when linked or unlinked, the reason). One live link per driver per environment and one driver per Everee worker (partial unique indexes), so a sandbox link is never a production link. A trigger refuses deleting a row and changing who is linked to whom; only what Everee reports and closing a link may change. Applied to the local copy (`nasa_local`) only.

**What the real sandbox taught us** (the reference pages were wrong or silent on these):
- The complete-contractor call refuses a record without `legalWorkAddress` (the page calls it optional): sent as `{ useHomeAddress: true }`.
- A tax ID starting with 9 gets a **500**; a tax ID already used by another worker gets a **409** ("already exists on another account"), which is a useful duplicate guard. Each test worker gets its own made-up tax ID.
- The pay-codes call and the worker calls answer with plain lists or objects; the readers accept what the sandbox sends.
- Everee's request log (`GET /integration/v1/api-calls`) showed none of these failed calls, so the answer text is all we have; every failure keeps Everee's request ID.

- **Config and dependencies:** none new. **Money impact:** none (no payment is created or sent).

**Review hardening (automated security review of the first push).** (1) The client logged the request path on a failure, and a worker search carries the driver's email or phone in its query string, so the log line could hold personal data. Only the path before the `?` is logged now; a test fails with the old logging (checked). (2) The conflict rule above. A name check was not added: the rule agreed on #31 is never to match by name. (3) The sandbox test-worker step refused only `match`, `ambiguous` and `blocked`, so the new `conflict` result would have let a duplicate test worker be created; it now refuses anything except a clean `no_match`, so a result added later is refused by default (a test fails with the old check, checked). Linking already required exactly `match`.

**Tested.** Pure rules (11): normalizing, one-word names, issues, an exact email or phone only, one worker found twice is one match, two workers ambiguous, truncated search never clean, masking. Database, with a fake Everee that also returns a same-name worker with other contact details (13 steps, rolled back): list and blockers, lookup uses only email and phone and saves nothing, same name is not a match, ambiguous, blocked drivers are not looked up, link only from the one exact match by a super admin, a worker linked elsewhere is not offered, refresh states, unlink as history and relink, per-environment separation, the guard trigger, sandbox test worker (made-up data, reused, refused in production), Everee errors with the request ID. Switching name matching on makes 8 of them fail (checked). Client calls and the log line (2). Backend suite: 303 pass, 4 fail; the same 4 claims-store tests fail on `develop` without this change.

**Sandbox evidence (counts and statuses only; no personal data).** Against the real sandbox: for one local driver whose data is incomplete (so the lookup was skipped and no real details left this machine): create test worker 1 created, `onboardingComplete: true`, tax ID `NEEDS_VERIFICATION`, ready; refresh the same; second create refused (409 already linked); the city list went from 0 ready to 1 ready (106 drivers: 66 unlinked, 39 blocked by missing data, 1 ready). A lookup of a driver with no phone made no call to Everee. A lookup with a real driver's email or phone was **not** run (it would send real contact details to Everee); the match logic is covered by the fake.

**Not tested.** A real lookup that finds an existing worker (there are none in the sandbox yet). No screen. The webhook is the next PR.

**Open for the client** (to be listed on #161): which Everee work location each city uses; the matches for each driver, to confirm before the first live link; drivers with a one-word name or no valid phone (about a quarter of the local copy: 106 of 431 enabled drivers have no valid phone, 6 a one-word name), who must be fixed first.

**Next.** PR 2: the webhook receiver (signature, dedupe, worker events). Then the read-only preview, the submit step, the payment events and status polling, and the dashboard Pay button.
