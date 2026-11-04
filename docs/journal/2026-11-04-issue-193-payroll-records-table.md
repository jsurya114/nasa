# A table of every driver's records, with who entered each, on the Payroll page (issue #193)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #193 / see the pull request for this branch
- **Branch:** `feat/payroll-records-table` (from `develop`)
- **Type and scope:** feat(payroll), backend and frontend
- **Files touched:** `Backend/services/payroll/ledger/ledgerStore.js` (two columns in the list query), test `Backend/tests/ledgerStore.test.js`; new `Frontend/src/components/Admin/payroll/CityRecordsTable.jsx`, `Frontend/src/components/Admin/Payroll.jsx`, test `Payroll.test.jsx`; this entry. No reserved files.

**What was asked.** When a driver asks for cash in hand and an admin enters it as a record, the record should show in a table under the city and driver boxes, with the name of the admin who entered it, and the table should list the records of all drivers, not one.

**The change.**
- **Backend:** the ledger list (`GET /admin/payroll/ledger?cityId=`, admin only, limited to the admin's cities) now also returns `driver_name` and `entered_by` (the name of the admin who created the entry). Both are read with a sub-select, so no other column or query changes. These names are on the admin route only; the driver's own pay pages use another query and do not get them.
- **Page:** once a city is chosen, a table "All records in this city" appears right under the City and Driver boxes: Driver, Date, Type, Details (claim type and reason), Amount, Still owed, Entered by. Newest first, 10 a row page, with a driver search. Voided entries are not listed. Choosing a driver's name opens that driver below (the existing cards, Edit, Mark complete and History, statements and the Add a record form work as before). A record saved or changed below shows in the table straight away.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None (display only; no amount or calculation changes).

**Tested.** Backend `ledgerStore.test.js`: the list names the driver and the admin who entered each entry, for two drivers and two admins. Frontend `Payroll.test.jsx`: rows for several drivers with who entered them (a voided entry hidden), choosing a name opens that driver, search and the empty states, and a record added below appears in the table with the admin's name. Frontend suite: 19 files, 192 tests pass; lint clean on the touched files; `vite build` succeeds. Backend suite: 267 pass, 4 fail; the same 4 claims-store tests fail on `develop` without this change.

**Not tested.** By hand in the browser or on a phone. The table shows the newest 500 entries of the city (the existing limit of the list); an older entry is still found by choosing its driver. Carrier (weekly Excel) claims are not in this table; they stay in the chosen driver's list below.
