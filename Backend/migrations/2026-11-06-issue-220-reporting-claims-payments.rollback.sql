-- Rollback for issue #220 part 3: removes the claim and payment reporting views. Claim and payment tools stop working.
DROP VIEW IF EXISTS reporting.payment_facts;
DROP VIEW IF EXISTS reporting.claim_facts;
