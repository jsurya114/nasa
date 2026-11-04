# Everee: the connection and a read-only test (issue #31, step 1)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / see the pull request for this branch
- **Branch:** `feat/everee-client` (from `develop`)
- **Type and scope:** feat(payroll), backend and frontend
- **Files touched:** new `Backend/services/payments/everee/{evereeConfig,evereeClient,evereeService}.js`, new `Backend/controllers/payroll/evereeController.js`, `Backend/routes/payrollRoutes.js` (two routes), `Backend/.env.example` (setting names only), test `Backend/tests/evereeConnection.test.js`; new `Frontend/src/components/Admin/payRuns/EvereePanel.jsx` (+ test), `PayRuns.jsx` (one line); this entry. No reserved files.

**Decisions (owner, 4 Nov 2026).** Everee is used for payments, tested on the Everee **sandbox**. Drivers are treated as **1099 contractors**. The first step is the connection and a read-only check only.

**What Everee requires** (from its developer documentation, not yet exercised against a real account): one web address for sandbox and production (`https://api.everee.com`); the token and tenant ID choose the instance. Each request carries `Authorization: Basic base64(token:)` and `x-everee-tenant-id`. Sandbox tokens start `tsk_test_`, production `tsk_prod_`. Every answer has an `X-Request-ID` for support. Contractors are paid by creating "payable items" (each with an `externalId`, which is the idempotency key), then calling "process payable items for payout", then a payroll admin approves the payments in Everee (in the sandbox this is automatic only if Everee turns auto-approval on).

**What this adds.**
- **Settings, by name only** in `.env` (`EVEREE_ENVIRONMENT`, `EVEREE_API_TOKEN`, `EVEREE_TENANT_ID`, `EVEREE_API_BASE_URL`). Nothing is committed. The environment defaults to sandbox. **A production token is refused** unless `EVEREE_ENVIRONMENT=production` is set on purpose, and the token's prefix must match the environment, so a production token pasted into a test setup is never used.
- **A small client** that adds the headers, a 15 second limit, and turns any failure into an error that carries Everee's request ID but never the token (nor Everee's text for a 401).
- **Two super-admin-only routes**: `GET /admin/payroll/everee/status` (is it set up, for which environment; no call to Everee) and `POST /admin/payroll/everee/check` (one read-only call, `GET /integration/v1/pay-codes`, which proves the token and tenant ID work together and lists the pay codes). A city admin gets 403 and no call is made.
- **A panel on the Pay runs page** (super admins only): environment badge (amber Sandbox, red Production), what is missing, a "Test connection" button, the pay codes and the request ID.

Nothing is paid, created or changed in Everee, and no pay run, statement or amount is touched.

- **Database:** None. **Dependencies:** None (uses the built-in `fetch`, as the push client does). **Money impact:** None.
- **Config:** four new names in `.env.example`; real values go only in the real `.env`.

**Tested.** Backend `evereeConnection.test.js` (9, fake network): settings accepted or named as wrong (missing, malformed, bad address); production token refused by default and the two must match; the token is never in a description, problem or answer; headers; refusals, network failure and timeout become errors with the request ID; only a super admin; no call without settings. Frontend `EvereePanel.test.jsx` (4). Frontend suite 193 pass, lint clean, `vite build` succeeds. Backend suite: 275 pass, 4 fail, and the same 4 claims-store tests fail on `develop` without this change.

**Not tested.** Against the real Everee sandbox: the token and tenant ID are not in the local `.env` yet, so `GET /integration/v1/pay-codes` is unproven until they are. The exact answer shape of that call was taken from the documentation (which is inconsistent about `name` and `displayLabel`; both are read). Not tried by hand in the browser.

**Next steps (separate PRs).** 2: link each driver to an Everee worker (contractor onboarding, the minimal "kick off onboarding" call), with a table for the link. 3: send a finalized pay run's statements as payable items (`externalId` made from the statement, so a retry cannot pay twice), then process them for payout, kept apart from finalizing. 4: webhooks (payment paid, deposit returned) and reconciliation. Decisions still open: who may confirm a batch and failed or returned payments (#161); webhook signing keys.
