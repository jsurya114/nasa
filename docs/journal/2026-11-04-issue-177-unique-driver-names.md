# Driver names unique ignoring case and spaces (issue #177)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #177 / see the pull request for this branch
- **Branch:** `feat/unique-driver-names` (from `develop`)
- **Type and scope:** feat(drivers), backend and database
- **Files touched:** new `Backend/migrations/2026-11-04-issue-177-driver-name-unique.sql` and `.rollback.sql`, `Backend/services/admin/driverName.js`, tests `Backend/tests/driverName.test.js` and `driverNameController.test.js`; changed `Backend/controllers/admin/addUserController.js`; this entry. No reserved files.

**Why.** Carrier claims name the driver only by the Courier column, and the Claims Detail sheet has no Delivery ID. The owner decided that claims are matched to drivers by comparing that name with the Courier name in Details of Delivery Fees. That is only safe if one name means one driver, so this comes first. The claim matching itself is a later change.

**What was there.** `drivers` already has `UNIQUE (name)`, but it is exact and case-sensitive, so "Sai Venkat" and "sai venkat" could both exist. Creating a driver did not require a name and did not check for a clash (a clash came back as "Server error"), and renaming had the same gap.

**What changed.**
- **Database:** a unique index on the normalized name (lower case, ends trimmed, runs of spaces collapsed). The exact constraint stays. Nothing is rewritten.
- **Pre-check in the migration:** if drivers already clash, it refuses to run, changes nothing, and lists the names and ids so someone can decide which driver keeps the name (renaming cascades to `excel_data` through its foreign key). Safe to run twice.
- **App:** creating or renaming a driver requires a name (400 otherwise, at most 100 characters), stores it trimmed with spaces collapsed, and answers **409 "A driver with this name already exists"** when another driver has it, ignoring case and spaces. A driver may keep their own name. A lost race (two admins at once) is also a 409. The forms already show the server's message, as they do for a duplicate email.
- Existing names are not changed.

- **Database:** additive index. Run `...driver-name-unique.sql` (back up first, on a copy first). Rollback: `...driver-name-unique.rollback.sql`. **Do not run on production before checking for clashes** (the migration will refuse and list them). Not applied to `nasa_local`: it refuses there, because the restored copy holds one clash (ids 369 and 370, same city, both enabled, no deliveries or pay data). The owner decides which keeps the name.
- **Config and dependencies:** None. **Money impact:** None.

**Tested.** `driverName.test.js` (database, one rolled-back transaction, made-up drivers): the migration refuses while two drivers clash by case or spaces and makes no index; after that it runs, and runs twice; the database refuses `ana testname`, `ANA TESTNAME`, extra spaces and the same name, and allows a different one; `findDriverByName` finds clashes and lets a driver keep their own name; renaming to another driver's name is refused; the rollback removes only the new index. `driverNameController.test.js`: a blank, missing, non-text or over-long name is a 400 on create and on rename. Whole backend suite 0 failures (36 skipped).

**Not tested.** Through the running app with a real form (the checks run against the controller functions and the database).

**Follow-up.** The claim matching by Courier name builds on this. The Courier name in the Excel also has to be cleaned the same way before it is compared (`cleanDriverName`).

## Review fix (Jasil's review on #178, 3 Nov 2026)

- **The finding.** The application cleaned a name with `String.trim()` (which removes all kinds of whitespace) and then collapsed runs; the database key was `btrim()` (plain spaces only) and then `regexp_replace`. A stored name with a tab or newline at an end became a space at the end in SQL and stayed there, so its key differed from the key of the same name cleaned by the application. Because existing names are not rewritten, such a legacy name escaped the migration's clash check, the duplicate lookup and the unique index, and a clean copy of it could be created.
- **One rule on both sides.** Whitespace is a fixed set, the same in JavaScript and SQL: space, tab, newline, carriage return, form feed, vertical tab and the no-break space (pasted Excel text often carries it). Every run of those becomes one space **first**, and **then** spaces at the two ends are removed (`btrim(..., ' ')`, and `/^ | $/` in JavaScript, no `String.trim()`), then lower case. Collapsing before trimming means an edge tab becomes a space and is trimmed. Other kinds of Unicode space (for example an em space) are left alone by both sides, so the two keys cannot disagree. The same expression is in `NAME_KEY_SQL`, the migration's clash check and the unique index. Existing records are unchanged, and the migration still refuses on a clash.
- **Tests (database, rolled back, made-up names).** A parity test compares the database key with the application's key (clean, then lower case) for plain, padded, tab, newline, no-break-space, vertical-tab, form-feed, blank, em-space and accented names. Legacy names padded with a tab, newline, no-break space or a tab in the middle clash with the clean name and make the migration refuse (listing the ids). A legacy padded name is found by the clean name and by its case variants; a clean copy is refused by the index on create; renaming another driver to it is refused; a driver may keep their own name. Unit tests cover the whitespace set. Ordinary spaces and case behave as before. These fail on the previous code (checked) and pass now. Whole backend suite 0 failures (36 skipped).
