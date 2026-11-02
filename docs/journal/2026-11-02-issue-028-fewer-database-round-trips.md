# Fewer database round trips in the daily upload (issue #28)

- **Date:** 2026-11-02
- **Author:** Jasil (with Claude Code)
- **Issue / PR:** #28 / see the pull request for this branch
- **Branch:** `perf/faster-daily-upload` (from `develop`)
- **Type and scope:** perf(excel)
- **Files touched:** `Backend/services/admin/excelFileQueries.js` (reserved file, Jasil's zone), this journal entry.

**What and why.** The daily upload stored the file's rows 100 at a time, so a 10,000-row file sent 100 insert statements. On a database on another machine, every statement waits for a network round trip, and that wait, not the work, is what made it slow. It now stores 2,000 rows per statement (5 statements for 10,000 rows). PostgreSQL allows 65,535 values per statement and each row uses 12, so 2,000 rows (24,000 values) is well inside the limit. Nothing else changed: the same rows, the same SQL, the same order.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. The stored rows are identical. Checked by fingerprint (below).

**Measured.** A production-size throwaway database (fake data: 1,000,000 deliveries, 30,000 journeys, 30,000 payments, 100 routes, 300 drivers), a 10,000-row daily file, three runs each, old code (`develop`) against this change. "40 ms delay" adds 40 ms before every statement to imitate a database on another machine; that delay is simulated, not measured on the real hosting.

| Setup | Old code, runs | New code, runs |
|---|---|---|
| Local database, no delay | 3.15, 4.05, 4.31 s (median 4.05) | 3.29, 3.44, 3.60 s (median 3.44) |
| 40 ms delay per statement | 8.06, 8.15, 8.27 s (median 8.15) | 3.71, 3.82, 4.28 s (median 3.82) |

On a local database the difference is within the run-to-run noise. The gain shows when the database is remote, and it is large: about 4 seconds saved from 95 fewer statements. The real saving on the live system depends on the real round-trip time, which I could not measure.

**Identical results.** After every run, old and new, the same fingerprint came out: deliveries hash `fd32a29046`, journeys hash `52da4c8ea2`, 5,900 first stops, 3,200 double stops, 400 not scanned, 500 failed, payments 1,500,000.00. The batching was also checked at its edges (0, 1, 99, 100, 101, 1,999, 2,000, 2,001, 3,999, 4,000, 4,001, 6,000 and 10,000 rows): every row stored exactly once, none lost or doubled.

**Tried and not kept.**
- A partial index on unclassified deliveries (`WHERE final_result = 'not_assigned'`, 672 kB). It made no measurable difference: those steps spend their time writing about 30,000 rows, not finding them.
- Rewriting `DATE(driver_set_date) = DATE(upload_date)` as a plain comparison so the date index could be used. No reliable gain, and it would silently stop matching if that column were ever a timestamp instead of a date, so it was left alone.

**Weekly upload.** Measured at 0.87 s for 50,000 rows and 0.07 s for adding the staged data to the dashboard on the same database. Nothing to fix there.

**Not tested.** A real file, the real hosting and the real round-trip time.

**Risks and follow-ups.**
- Of the roughly 4 seconds that remain, about 3 are spent in three steps that classify *every* unclassified delivery in the whole database, not just those of the uploaded date. In this test that was 30,000 rows, only 10,000 of them for the uploaded date, so two thirds of the work is for other days. Limiting those steps to the uploaded date would be the real speed-up, and it is also the behaviour question recorded on #24 (it changes which rows get classified), so it needs a real-data check first. Not done here.
- A larger file than about 5,400 rows per statement would hit the 65,535-value limit, but 2,000 is the cap, so this cannot happen.
