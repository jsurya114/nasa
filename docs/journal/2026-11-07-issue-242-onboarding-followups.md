# Onboarding recovery and readiness: four review follow-ups

- Date: 7 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #242; follows the review notes on #247 and #248. Branch `fix/everee-onboarding-followups`.
- Type and scope: fix. Backend sync job, readiness report, one admin page sentence, docs and `.env.example`. No reserved Excel/pay-upload file.

## What and why

1. `Backend/.env.example` now documents `EVEREE_ONBOARDING_SYNC_ENABLED` (name and purpose; no value). It was only in the runbook and journal.
2. `onboardingSync.js`: a worker Everee does not know (a driver pressed Start and never came back) was looked at every 5 minutes for ever. Each look now doubles the
   wait (10 minutes, 20, 40 ...) up to six hours, and the counter resets when the answer changes. Errors keep their own backoff; a provider quota pause still wins.
3. `docs/EVEREE_ONBOARDING_ROLLOUT.md`: removed the step about `EVEREE_SANDBOX_TEST_EMAIL`, a setting no code reads. The step now says to set the test driver's NASA
   email to the controlled inbox.
4. `onboardingReadiness.js`: "open work" (drivers and routes) now counts only unclosed work from the last 60 days (`OPEN_WORK_DAYS`, passed as a query parameter), and
   the admin page says it is a rough count. Old rows that were never closed no longer inflate the numbers the owners read before turning restrictions on. The gate
   itself does not use this count.

## Database, config, dependencies

None. No schema change. `.env.example` gains one documented name.

## Money impact

None.

## Tested

On a throw-away copy of the database (`PAYROLL_TEST_DB=1`, `PAYROLL_TEST_DB_COMMIT=1`): the sync tests (new: the wait doubles 600/1200/2400 s and never exceeds six hours)
and the readiness tests (new: an open row from 200 days ago is not counted, one from 3 days ago is) pass, 14 tests, 0 skipped. The page's frontend test passes.
CI skips the database tests (it does not set `PAYROLL_TEST_DB`).

Not tested: a real long-running job against Everee; the 60-day window against production data (the owners should read the count as a rough guide).

## Risks and follow-ups

The 60-day window is a choice, not a rule from the owners; change `OPEN_WORK_DAYS` if they want another.
