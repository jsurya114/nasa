# Dashboard: always show the Net Payment line under the driver jobs table

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** none (requested in chat) / see the pull request for this branch (it contains #204's one commit until that merges)
- **Branch:** `fix/net-payment-always-shown` (from `fix/remove-node-modules-link`, which is `develop` plus #204)
- **Type and scope:** fix(dashboard), frontend only
- **Files touched:** **`Frontend/src/components/Admin/DashboardTable.jsx` and `Dashboard.jsx` (Jasil's dashboard zone)**: one display condition removed in each, plus an unused import; test `Dashboard.penalty.test.jsx` (a new case, and the test server can now return a driver with no insurance). Not reserved by the engineering standard's list, but the files are Jasil's, so he needs to review it.

**What changed.** The "Net Payment" line under the table, and the "Net Driver Payment" line in the Summary, were shown only when the driver had an insurance deduction, a penalty or a notice. With none of those, no net line appeared at all, so the "Net Payment preview (before the pay run is approved)" was missing. Both lines now always show once the table has data. The wording, the numbers and the colours are unchanged and still come from `netFor`: the approved pay run's frozen net, a draft's net as a preview, the server's estimate labelled "preview (before the pay run is approved)", or the table's own payment minus insurance when no driver and city are chosen. While the deduction figures load or fail, the line still says "not final".

**Money impact.** None: no calculation changed, only whether an existing line is displayed.

**Tested.** New case: no insurance, no penalty, nothing owed and a server estimate of $100.00 shows the preview line under the table and in the Summary with the preview label, and no insurance or penalty row; it fails without the change (checked). The 26 test files of the frontend suite pass (232 tests), the build works. Lint: the three errors already in `DashboardTable.jsx` on the base remain (unused `isFiltered`, `isSuperAdmin`, `getTodayDate`); this change adds none (it removes the `showRow` import it would have left unused).

**Not tested.** Not looked at in a browser. The line also now shows for the "all drivers" view, where it equals the table's payment minus insurance.
