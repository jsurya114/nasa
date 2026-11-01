-- Rollback for 2026-11-01-issue-013-routes-deleted-at.sql.
-- Only run it if no later step (filtering by deleted_at, archiving) has been released:
-- dropping the column forgets which routes were archived.
ALTER TABLE routes DROP COLUMN IF EXISTS deleted_at;
