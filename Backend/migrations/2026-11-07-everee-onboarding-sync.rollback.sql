-- Stop the onboarding sync job first. Scheduling metadata only; onboarding/link/audit history is preserved.
DROP TABLE IF EXISTS everee_onboarding_sync;
DROP TABLE IF EXISTS everee_onboarding_job;
