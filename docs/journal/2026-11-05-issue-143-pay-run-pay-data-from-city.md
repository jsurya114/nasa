# Pay runs: the city decides the pay data, no dropdown

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #143 (pay run drafts), requested in chat / see the pull request for this branch
- **Branch:** `fix/pay-run-pay-data-from-city` (from `develop`)
- **Type and scope:** fix(payroll), frontend only
- **Files touched:** `Frontend/src/components/Admin/payRuns/NewRunForm.jsx`, `Frontend/src/components/Admin/PayRuns.jsx` (one prop renamed), test `Frontend/src/components/Admin/PayRuns.test.jsx`. No reserved files.

**What changed.** The "New draft" form on the Pay runs screen had a "Pay data" dropdown (Daily SpeedX or Weekly GOFO) that was only pre-selected from the city's type. The admin could still pick the wrong one for the city. Now the form shows the pay data as a fixed label taken from the city: a weekly city shows "Weekly (GOFO)", any other city shows "Daily (SpeedX)". The request to the server still carries `dataType`, now always the city's. The line under the form that explains claims, advances and penalties follows the same value.

**Database, config, dependencies:** none. **Money impact:** none; no calculation changed, and the data type sent for a city is the one that was already its default.

**Tested.** The Pay runs test file passes (11 tests): a weekly city shows "Weekly (GOFO)" with no dropdown and drafts with `dataType: "weekly"`; a daily city shows "Daily (SpeedX)" and drafts with `dataType: "daily"`.

**Not tested.** Not looked at in a browser. The server still accepts either data type for any city (the choice is only removed from the screen), so a direct API call can still ask for the other one.
