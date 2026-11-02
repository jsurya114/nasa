# Ownership

Who owns which area right now. Read this before you edit anything outside your own zone, and ask the owner first.

This file changes rarely, so it is the one shared file in `docs/` that two people may both edit. Update it in the same pull request that moves ownership, and say why in that task's journal entry.

| Area | Owner | Note |
|---|---|---|
| Excel, pay and dashboard zone. Backend: `weeklyUploadsController`, `fileUploadsController`, `dashboardController`, `analyticsController`, `weeklyExcelQueries`, `excelFileQueries`, `dashboardQueries`, `analyticsQueries`, Excel settings in `multerConfig`. Frontend: `Dashboard`, `DashboardTable`, `DoubleStop`, `DriverPaymentUpdate`, `Analystic`, `UploadedData`, `TempUploadedData` and their slices (`dashSlice`, `dashboardUpdateSlice`, `paymentDashboardSlice`, `excelSlice`, `doublestopSlice`, `analyticsSlice`) | Jasil | Leave alone. Ask first. Issues #24 to #32. |
| Everything else (auth, middleware, route files, `app.js`, drivers, admins, cities, routes, journeys, availability, access codes, agreements, logging, docs, migrations, UI refresh outside Jasil's screens) | Jayasoorya | Issues #3 to #21 and #23. |
| Mobile app: the `mobile/` folder, `Frontend/src/native/` (bridge and session store), and the mobile parts of the sign-in code (`axiosInstance`, the driver and admin slices, the route guards) | Jasil | Issue #22. Handed over from Jayasoorya on 2 Nov 2026. Changes to the shared sign-in code still need the sign-in rules in `docs/MOBILE_APP_DESIGN.md` section 3. |
| Payroll and QuickBooks: new payroll and QuickBooks files only | Jayasoorya | Issues #30 and #31. Handed over from Jasil on 2 Nov 2026. Existing pay, Excel and dashboard files stay Jasil's: ask first before editing them. |
| Old `dev` branch | Jasil | Do not delete. Has 7 commits not on `main`. Issue #27. |

Work in progress is not listed here. Use `gh pr list` and the open issues.
