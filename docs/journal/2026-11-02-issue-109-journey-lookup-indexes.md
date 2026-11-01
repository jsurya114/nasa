# Index the "rows for this journey" lookups (issue #109)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #109 / see the pull request for this branch
- **Branch:** `perf/journey-delivery-indexes` (from `develop`)
- **Type and scope:** perf(db)
- **Files touched:** new `Backend/migrations/2026-11-02-issue-109-journey-lookup-indexes.sql` and its `.rollback.sql`. No code, no reserved files.

**What and why.** Saving journeys was reported to take 5 to 6 seconds before the success message appeared. Measurements:
- The screen shows the message as soon as the server answers (66 ms after the click in a local test), and the request code has no waits or retries. Locally, every request (login, reads, a rejected write) answered in 2 to 64 ms. So the delay is not in the browser or the toast system.
- `deliveries` (about a million rows in production) and `payment_dashboard` have **no index on `dashboard_data_id`**. The journey triggers (`sync_deliveries_with_sequence` on edit, `update_payment_dashboard` on edit, `delete_dashboard_data_related_rows` on delete) and the foreign-key checks on delete look rows up by that column, so each lookup reads the whole deliveries table (233 MB in a synthetic copy; larger in production because real rows also hold addresses and names). On a small cloud database with a cold cache, one such read can take seconds, and an edit or delete does more than one.

**Database (exact SQL in the migration file).**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deliveries_dashboard_data_id ON deliveries (dashboard_data_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_dashboard_dashboard_data_id ON payment_dashboard (dashboard_data_id);
```
Rollback:
```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_deliveries_dashboard_data_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_payment_dashboard_dashboard_data_id;
```
Additive only. `CONCURRENTLY` builds without blocking reads or writes; it cannot run inside a transaction, so run the file with plain `psql -f` (not `-1`). The file ends with a check that both indexes are valid. **Back up first and run on a copy first.** Status: **not applied to production.**

**Config and dependencies.** None. **Money impact.** None: no data, trigger, calculation or query result changes; indexes only make the same lookups faster.

**Tested.** On a synthetic database at production size (28,007 journeys, 1,064,040 deliveries, fake data only), through the real API:

| | without indexes | with indexes |
|---|---|---|
| lookup by journey (EXPLAIN ANALYZE) | 89.5 ms, full scan | 0.04 ms, index only |
| create journey | 4 to 26 ms | 4 to 8 ms |
| update journey | 243 to 271 ms | 4 to 8 ms |
| delete journey | 96 to 103 ms | 1.3 to 1.7 ms |
| journeys list | 13 to 16 ms | 13 to 15 ms |

The migration file was run twice (second run skips with a notice) and the rollback once; both indexes reported valid. After create/update/delete cycles the deliveries count matched the expected total, so the triggers behave as before. Not tested: on the production database itself (needs a backup and the owner's go-ahead), and the build time on production hardware (expected to be seconds, without blocking the app).

**Risks and follow-ups.** Low: two extra indexes make each delivery insert very slightly slower (one more index entry per row). If the 5 to 6 second delay is also seen on **create**, the cause is outside the database (create was already fast here); the next step is the request timing in the browser's Network tab on the environment where it happens.
