# Recover incomplete driver onboarding

Issue #242 needs recovery when a worker-create response or completion event is lost. Add a switched-off-by-default scheduled reader using durable retry timing and a cross-instance database lock. Recovery reuses the existing external identity and save/link fences; it never creates a worker or a payment. Completed onboarding is still independently verified with Everee.

Apply `2026-11-07-everee-onboarding-sync.sql` after the original onboarding migration, on a backed-up copy first. Stop `EVEREE_ONBOARDING_SYNC_ENABLED` before rollback. The rollback removes scheduling metadata only. Enable the sync flag only with driver onboarding configured and enabled; all enforcement and payment switches remain separate.

Validation on an isolated database: lost create, active lease, provider quota exhaustion and persisted cooldown, duplicate job exclusion, and full setup-to-verified-work/payment eligibility passed with a fake provider. Existing work, cash, Everee submission/status and onboarding regressions passed. Real sandbox Embed opened inside NASA and reached provider email verification with fictional data; completing that step requires a controlled inbox. No payment was sent and no production setting was changed.
