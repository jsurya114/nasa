-- Driver profile (PR #278 review): two additive changes to `drivers`.
--
-- 1. contact_changed_at: set when a driver changes their own email or phone number in the Profile page. While it is set, that driver is held out of
--    Everee and QuickBooks linking (self-setup and the admin Look up), because those match a person by exact email or phone. A super admin clears it
--    with "Confirm contact" after checking the new details. NULL (the default) means nothing is held, so nobody changes until a driver edits their contact.
--
-- 2. drivers_email_lower_key: one email per driver ignoring upper/lower case, enforced by the database. The old unique index compares the exact text,
--    so "A@x.com" and "a@x.com" could both exist. If two drivers already clash, the index is NOT created (nothing is changed or deleted): a notice
--    lists the driver ids, someone decides which driver keeps the email, and this file is run again. The app checks the same rule in the meantime.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once. Rollback: the .rollback.sql file next to this one.

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS contact_changed_at timestamptz;

DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(ids, '; ') INTO clashes
    FROM (SELECT string_agg(id::text, ', ' ORDER BY id) AS ids FROM drivers GROUP BY lower(email) HAVING count(*) > 1) d;
  IF clashes IS NOT NULL THEN
    RAISE NOTICE 'drivers_email_lower_key NOT created: these driver ids share an email ignoring case: %. Fix them and run this file again.', clashes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS drivers_email_lower_key ON drivers (lower(email));
  END IF;
END
$$;
