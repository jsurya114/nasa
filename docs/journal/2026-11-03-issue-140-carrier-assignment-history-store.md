# Keep the carrier's waybill, Delivery ID and route evidence (issue #140, part 1)

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#140` / see the pull request for this branch |
| Branch | `feat/gofo-assignment-history` |
| Type / scope | `feat(excel)` |
| Files touched | New: `Backend/migrations/2026-11-03-issue-140-carrier-assignment-history.sql` (+ `.rollback.sql`), `Backend/services/excel/assignmentHistory/` (`assignmentRules.js`, `assignmentWorkbook.js`, `assignmentStore.js`), `Backend/tests/assignmentRules.test.js`, `Backend/tests/assignmentStore.test.js`. No existing file is edited. |
| Reserved files touched | None. The new folder is in the Excel zone (Jasil). |

**What and why.** The weekly GOFO upload counts rows per driver and day and throws the waybills away. A claim names only a waybill, so nothing could say who carried the package or in which city. This part adds the durable record and the lookup, without wiring it into any upload yet (part 2):

- **Three additive tables and one view** (migration below):
  - `carrier_assignment_imports`: one row per report file that was read. The hash of the file's bytes recognises a renamed copy; the file name is only a label. An import can be *voided* with a reason (never deleted).
  - `carrier_package_assignments`: one row per distinct fact "waybill W was assigned to Delivery ID D on route R on day T". The same fact in a renamed, reordered or overlapping report is the same row. Two different Delivery IDs for one waybill are two rows: a conflict is kept, never settled by taking the first.
  - `carrier_assignment_sightings`: where each fact was seen (import, sheet, Excel row). A fact seen in two reports has two sightings.
  - `carrier_package_assignments_live`: the facts that still stand (at least one sighting in an import that is not voided).
- **Reads both sheets.** `Details of Delivery Fees` and `Offset Details` both give evidence. An offset is evidence of who carried a package; it is not read as a charge or as wages, and no money column is read at all. A row with an incomplete stop count therefore keeps its identity.
- **Exact identifiers.** Waybills and Delivery IDs are text; only surrounding spaces go. `Waybill No` and `Waybill No.` are the same header. A numeric waybill longer than Excel's 15 digits is reported as unreadable, not guessed. A Delivery ID with leading zeros (or any non-digit text) is kept as written but is never matched to a driver, so `012345678` and `12345678` are different values. Bad rows are reported by Excel row number and reason, never with the cell's value.
- **Driver, route and city come from the evidence, then freeze.** The Delivery ID is compared with `drivers.driver_code`, and the report's Region/route with `routes.route_code_in_string`, whose route belongs to one city. The driver's *current* city is never used, so a driver who later moves city does not move old packages. A fact recorded before its driver or route exists is linked later by `refreshOpenAssignments`; once linked it is final (the table refuses a change). A route NASA does not know gives a driver but no city, and the city stays unresolved rather than guessed.
- **Lookup for the claims work.** `findAssignmentCandidates({ courier, waybill })` returns `[{ driverId, cityId, cityName, carrierDeliveryId, routeId, journeyDate, ... }]`, the shape `rematchOpenClaims` in #148 expects. One entry per distinct Delivery ID / driver / city, so a conflicting waybill returns two entries and the claims side treats it as ambiguous. `cityName` is the stored **city code** (`city.city_code`, for example `DFW GOFO`), not the display name (`city.job`, for example `Dallas GOFO`); see the follow-ups. `candidateFinderFor(db)` wraps it in the call shape `rematchOpenClaims` takes.
- **City admins.** `recordReport` takes `allowedJobs`: a city admin's report records only facts whose route belongs to one of their cities; the rest is counted and left out, never refused (so no file that uploaded before is refused now). The scope is part of an import's identity (`scope_key`): the same bytes recorded by someone with a wider scope are a separate import that adds what the narrow one left out, while the same bytes with the same scope are still recognised. The lookup keeps provenance per fact (`facts[].evidence[].scoped`) and says whether an unrestricted import backs the driver link and the city (`vouched.driver`, `vouched.city`; the city counts only a fact that has its own route and city), so a fact that only a city admin's file vouches for can be weighed, and an unrestricted sighting of a route-less fact is not mistaken for support of another fact's city.
- **Voiding.** `voidImport` voids every copy of the same bytes (the same file recorded with another scope) in one statement, and bytes that were voided are refused under every scope afterwards, so a wrong file cannot stand through a sibling import or come back with a different scope. Bringing a voided file back would need an explicit new action that does not exist yet.
- **Append-only.** Triggers refuse any edit of the evidence columns, any change to a resolved driver, route or city, and any delete. Corrections go through `voidImport`.

**Database.** Additive: three tables, one view, three trigger functions. Run on a copy first, after a backup, in one transaction:

```bash
psql --single-transaction -v ON_ERROR_STOP=1 -f Backend/migrations/2026-11-03-issue-140-carrier-assignment-history.sql
```

Safe to run twice. Rollback: `...-carrier-assignment-history.rollback.sql` drops the view, the tables and the functions (this deletes retained evidence, so back up first). Nothing reads these tables into pay.

**Config and dependencies.** None. Developer test switch (not an app setting): `ASSIGNMENT_TEST_DB=1`.

**Money impact.** None. Nothing in this part is called by any existing code.

**Tested.**

- 16 unit tests (`assignmentRules.test.js`): header variants, exact waybills, leading-zero Delivery IDs, numbers read from cells, month-first dates, impossible dates, fact identity, bad rows by row number without values, offsets, reordered rows, missing sheets and columns, and a round trip through a real `.xlsx`.
- 22 database tests (`assignmentStore.test.js`, `ASSIGNMENT_TEST_DB=1`) against a private scratch copy of a snapshot of the production database, inside one transaction that is always rolled back (checked: no test city, driver or table is left behind). They cover: fee and offset rows (an offset-only waybill resolves); the same file again under another name; a re-saved reordered copy (no new facts, a new sighting); two Delivery IDs for one waybill; one waybill on routes of two cities; a fact with no route; an unknown route; a driver who moves city; two drivers whose names differ only by case; leading-zero IDs; a driver added later, and a driver code reassigned later; the triggers; a city admin's limited import (and a wider copy of the same file adding what it left out); per-fact provenance; the time a driver was linked; an unreadable date; voiding an import (including a fact another report still holds, a voided file uploaded again, voided bytes under another scope, and voiding every copy); and the lookup's shape.
- 7 mutation checks, each of which makes at least two tests fail: identity ignoring the Delivery ID, first candidate wins, city filter removed, same bytes recorded twice, the driver's current city used, leading zeros stripped, voided imports still standing.
- Migration run twice, then rolled back, then applied again, on the scratch copy.
- **Private check, counts only** (the three supplied GOFO workbooks for 28 Sep to 4 Oct; nothing from them is in the repository): the reader found 46,078 fee rows and 28 offset rows with 0 problems, recorded 46,106 facts (every driver linked; 46,103 with a route and city, the 3 others have a blank route), and **27 of the 45 claim waybills resolve to exactly one driver and city and 18 have no history**, the same as the separate analysis of the same files. Reading and saving took about 2 to 4 seconds per file.
- Whole backend suite with the database tests skipped, as in CI.

**Not tested.** The wiring into the upload (part 2). A GOFO report with a DFW GOFO route (none was supplied). SpeedX waybills (no sample; the lookup returns nothing for them). Two imports at the same instant (a transaction lock serialises them, not run in parallel). Production data.

**Risks and follow-ups.**

- **Driver codes have no history.** A Delivery ID is linked to a driver through `drivers.driver_code`, as the existing pay import does, and `drivers` records no history of code changes or when a driver was added. If a code were handed to a different person between the signing date and the day a report is recorded, the fact would be linked to the later holder and then frozen. In the 1 Nov snapshot no code is shared by two drivers, and the weekly flow records a report days after signing, so the window is small there; an older report imported much later is where it matters. Each lookup entry carries `driverLinkedAt` (the latest time a fact of the entry was linked to its driver) next to `journeyDate`, so the claims side can see how late a link was made. A driver-code history (drivers are Jayasoorya's area) would close this; it is not invented here.
- **A city admin's file can name any driver.** The city check looks at the route, not the driver, because the existing weekly flow also lets a driver run a route of another city. A city admin's file can therefore add a fact for a waybill that another city's file also names: the two facts conflict, the lookup returns two entries, and the claim stays ambiguous until a person reviews it (`GET /admin/assignment-history/conflicts` in part 2). It cannot silently reassign a waybill. Provenance (`importId`, `scoped`) is kept so the claims side can require evidence that is not only city-admin-scoped before deducting automatically.

- **City label for the exemption.** `cityName` is `city.city_code`. In the 1 November snapshot the Dallas GOFO city has the code `DFW GOFO` and the display name `Dallas GOFO`, while the separate Dallas SpeedX city has the code `DFW`. Keying the exemption on the code keeps those two apart. #147 currently reads the *display name*, which would not match; it should use `cityCode` (or `cityName` as returned here).
- Evidence older than the reports already uploaded still has to be imported to resolve the other claims: part 2 adds a history-only import so an older report never touches the weekly staging data.
- `deliveries.courier_code` is not used. No claim waybill matched it in the snapshot, and its meaning for GOFO is unclear.

**Review round 1 (Jayasoorya, PR #151).**

- `voidImport` now takes the same transaction lock as `recordReport`, so a void and an import of the same file (under another scope) can no longer overlap: whichever comes second sees what the first committed. It must be called inside a transaction on one client. A two-client test (`assignmentVoidRace.test.js`, `ASSIGNMENT_RACE_DB=1`) covers both orders; it fails when the lock is removed. It really commits, so it refuses to run unless the history tables are empty and it removes what it created; run it only on a scratch copy.
- The migration's guard now also freezes `voided_by` once an import is voided; tests try to change and clear it, and to clear the void itself.
