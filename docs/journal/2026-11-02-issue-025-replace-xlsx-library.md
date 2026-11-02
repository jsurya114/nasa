# Replace the outdated spreadsheet library (xlsx 0.18.5 to SheetJS 0.20.3)

- **Date:** 2026-11-02
- **Author:** Jasil (with Claude Code)
- **Issue / PR:** #25 / see the pull request for this branch
- **Branch:** `fix/replace-xlsx-library` (from `develop`)
- **Type and scope:** fix(deps)
- **Files touched:** `Backend/package.json`, `Backend/package-lock.json`. No source code. No reserved files edited (the daily upload controller only uses the library; its code is unchanged).

**What and why.** The daily upload reads the SpeedX file with the `xlsx` package. Version 0.18.5 is the last one on the npm registry. Its publisher moved releases to their own site, so npm never received the fixes for two known weaknesses (a prototype-pollution flaw and a slow-pattern denial-of-service flaw). Because the file comes from an upload, those mattered. The package is now the maintainer's own current release, 0.20.3, installed from `cdn.sheetjs.com` and pinned in the lock file with a content hash, so a changed file would fail to install.

**Database.** None.

**Config and dependencies.**
- `xlsx` changes from `^0.18.5` (npm registry) to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (version 0.20.3).
- The lock file drops five small helper packages that 0.20.3 now bundles (`codepage`, `frac`, `ssf`, `wmf`, `word`) and the list of helpers under the `xlsx` entry. Nothing else in the lock file changes.
- No new environment variables.
- Source of the dependency is now `cdn.sheetjs.com`, not the npm registry. Installs (local, CI, hosting) must be able to reach that address. If the hosting provider cannot, vendor the file into the repository instead.

**Money impact.** None expected, and checked on test files (below). Only the read step uses this library; the pay calculations are untouched.

**Tested.** On synthetic files only (fake data, built for this test; not committed). Both versions read the same files and the results were compared value by value:

| File | Rows | Result |
|---|---|---|
| Typed workbook: numbers, text-numbers, leading-zero text, real dates, text dates, blanks, a formula, a boolean, accented names, padded spaces | 1,500 | identical |
| Workbook written by the old library | 800 | identical |
| Legacy `.xls` format | 800 | identical |
| Header row only | 0 | identical |
| No sheet named `result` | n/a | identical (the controller's "Sheet named result not found" check still applies) |

Also checked: the values the upload turns each row into (route, sequence, lowercased address, unit, zip code, `seq_route_code`, complete time) are identical for all 1,500 rows; `npm ci` from the new lock file succeeds; `npm audit` no longer lists `xlsx` (high findings 3 to 2); the module loads with the same `import XLSX from "xlsx"` line the controller uses.

**Not tested.** A real SpeedX file and the full upload against a database. The change only affects how the file is read, and the read output was identical on every test file, so the later steps receive the same rows. Please run one real daily file on a copy of the database before this reaches `main`.

**Risks and follow-ups.**
- The new source is outside the npm registry (see above).
- `xlsx-populate` and `moment` are still listed but unused. Removing them belongs to Jayasoorya's clean-up issue (#17).
- The remaining high findings in `npm audit` are other packages, not this one.
