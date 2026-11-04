# Everee, PR 2: the webhook receiver (issue #31)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / see the pull request for this branch (stacked on PR 1, #197)
- **Branch:** `feat/everee-webhook` (from `feat/everee-workers`)
- **Type and scope:** feat(payroll), backend
- **Files touched:** new `Backend/migrations/2026-11-04-issue-031-everee-webhook-events.sql` (+ rollback), `Backend/services/payments/everee/{webhookSignature,webhookService}.js`, `Backend/controllers/payroll/evereeWebhookController.js`, `Backend/routes/evereeWebhookRoutes.js`; edited `Backend/app.js` (one import and one mount, before the JSON parser), `Backend/services/payments/everee/workerStore.js` (the refresh logic moved into a function both the button and the webhook use), `Backend/.env.example` (one name); tests `evereeWebhookSignature`, `evereeWebhook`, `evereeWebhookHttp`; this entry. No reserved files.

**What it does.** `POST /webhooks/everee` is public (Everee calls it), so the proof is the signature, checked before any database work:
1. No signing key or Everee settings: 503, nothing processed.
2. Signature wrong, missing, malformed or the timestamp more than 120 seconds off: 401. The check is HMAC-SHA256 over `timestamp + "." + the exact bytes received` with the endpoint's signing key, compared in constant time; two signatures (a key being rotated) are both accepted. The route keeps the raw bytes (`express.raw`, mounted before the JSON parser), so the bytes are never re-serialized.
3. Not an Everee event (envelope with `id`, `type`, integer `companyId`): 400. An event for another Everee company than ours: 403. Extra fields are allowed.
4. The event ID is stored once per environment. An event already processed is answered "duplicate" and not processed again (Everee may deliver twice).
5. Processed, then answered 200. If processing fails the answer is 500 and the stored event stays unprocessed, so Everee's retry (up to 20 attempts over about 6.6 days) is processed, not mistaken for a duplicate.

What is processed: **worker events** (`worker.created`, `profile-updated`, `onboarding-completed`, `tin-verification-status-changed`, `terminated`, `deleted`) refresh the linked driver's worker (ready to pay or not) by **reading the worker from Everee again**, so an event can only trigger a refresh, never set a value. A worker not linked to any driver is stored and ignored. A worker Everee no longer finds, or `worker.deleted`, is marked as having left (cannot be paid). `test-event.created` is answered. **Payment events** (`payment.paid`, `payment-payables.status-changed`, deposit returned or retried) and everything else are only stored for now; they change no payment status until part 5.

**Database** (`2026-11-04-issue-031-everee-webhook-events.sql`, additive; rollback beside it; run on a copy first). One table `everee_webhook_events` (event ID and environment unique, type, company, timestamp, a trimmed copy of the data, attempts, processed_at, outcome). Only IDs and statuses are kept (worker ID, payment ID, payable external IDs, statuses); never names, emails, phones, amounts or bank details. A trigger refuses deleting an event and rewriting what it said; only attempts, processed_at and outcome change. Applied to the local copy only.

**Config.** One new name in `.env.example`: `EVEREE_WEBHOOK_SIGNING_KEY` (a secret; only in the real `.env`). It is the signing key of the webhook endpoint created in Everee, shown once; sandbox and production endpoints have different keys. A rate limit of 600 requests a minute guards the route.

- **Dependencies:** none. **Money impact:** none (no payment status is changed yet).

**Tested.** Signature (6): valid; a changed byte, whitespace or re-serialized JSON refused; unicode; wrong key; stale and future timestamps; two signatures; malformed headers. Service with signed sample events and a fake Everee (11 steps, rolled back): 503, 401 with nothing stored, 400 and 403, the worker refresh, duplicates, a claim inside an event not trusted, terminated or deleted, an unlinked worker, a 500 then a successful retry, payment events trimmed to IDs and statuses, the guard trigger, sandbox and production kept apart. Disabling the signature check makes 4 of them fail, disabling the duplicate check makes 2 fail (checked). HTTP (4): the real route and raw-body parser, odd spacing and non-ASCII text, any content type. Backend suite: 326 pass, 4 fail; the same 4 claims-store tests fail on `develop` without this change.

**Sandbox evidence (no personal data).** With the local backend behind a Cloudflare quick tunnel and the Everee sandbox endpoint pointing at it: signed sample events sent by hand through the tunnel: accepted 200 (`test_ok`), the same event again 200 duplicate, a wrong key 401, another company 403. Then Everee's own "send test event" call (HTTP 202) delivered a real `test-event.created` about a minute later; it **verified against Everee's real signing key** and was stored as processed (`test_ok`, 1 attempt). Everee's first delivery took about a minute, so a payment status is not instant.

**Not tested.** A real worker or payment event from Everee (there are no payments yet); a worker event for a linked worker was tested with a fake Everee only.

**Next.** PR 3: the read-only preview of a batch (drivers, amounts, blockers). Then submit, payment events with status polling, and the dashboard Pay button.
