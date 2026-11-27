-- Account deletion requests (App Store guideline 5.1.1(v)): a signed-in driver or admin asks for their account to be
-- deleted in the app; a super admin completes it. Completing removes sign-in and contact details and switches the
-- account off. Deliveries, pay statements, payments, claims and audit history are NOT deleted: they are business and
-- accounting records and stay linked to the account id (docs/ACCOUNT_DELETION.md).
--
-- Additive only: no existing table or column changes. HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id           bigserial   PRIMARY KEY,
  user_type    text        NOT NULL CHECK (user_type IN ('driver', 'admin')),
  user_id      integer     NOT NULL,
  status       text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'completed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by integer,
  cancelled_at timestamptz
);

-- At most one open request per account
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_open
  ON account_deletion_requests (user_type, user_id)
  WHERE status = 'requested';

-- Should list the table's two indexes.
SELECT indexname FROM pg_indexes WHERE tablename = 'account_deletion_requests' ORDER BY indexname;
