# Use query parameters where SQL was built from strings

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Issue / PR | `#7` / pull request into `develop` |
| Branch | `fix/sql-parameters` |
| Type / scope | `fix(db)` |
| Files touched | `Backend/services/admin/dbQueries.js`, `Backend/controllers/admin/addAdminController.js` |
| Reserved files touched | None |

**What and why.** When a superadmin creates or updates an admin, the chosen cities were joined into the SQL text (`VALUES (id, <city>), ...`) straight from the request body. A crafted city value could add its own SQL. The cities are now sent as one query parameter (`UNNEST($2::int[])`), never as part of the SQL.

- New `parseCityIds()` turns the submitted list into unique whole numbers and refuses anything else (decimals, zero, negatives, null, arrays, text).
- `insertAdmin` and `updateAdmin` share one small `insertAdminCities()` that uses parameters only.
- `createAdmins` and `updateAdmin` in the controller answer `400 "Invalid city selection"` for a bad list, before any database work. Before, a bad value ended in a `500` (or ran).
- Normal use is unchanged: the admin form still sends `[{ value, label }]` and the result is the same.

**Whole backend searched.** Only these two places put request values into SQL. The rest were checked and left as they are: search text and filters are bound parameters, the `WHERE` and `VALUES` pieces are fixed text with numbered placeholders, the availability day column is checked against an allow-list of the seven day names, and the Excel upload table name is a constant (those files are in Jasil's zone and were not edited).

**Database.** None. No schema change.

**Config and dependencies.** None.

**Money impact.** None. No Excel, pay or dashboard file was touched.

**Tested.** On a real PostgreSQL 17 started just for this test (private port, deleted afterwards; the normal dev server was not used), with the same `admin`, `city` and `admin_city_ref` tables as the schema notes. 21 checks on the new code all passed: create with several cities (including a duplicate and an id sent as text), update replaces the list, superadmin ignores cities, a crafted hostile value is refused and nothing extra runs, the admin row is rolled back, bad values are refused, an unknown city id still fails and rolls back, and the controllers answer 400. Run on the old code, the crafted value really ran its extra SQL (an `INSERT` into the city table), and 10 checks failed. A first, simpler hostile value was blocked on the old code only by a syntax error, so a value that stays valid SQL was used to prove the flaw. Not tested: the admin form in a browser.

**Risks and follow-ups.** The 400 is a small change in a response: bad input used to give a 500. The frontend only sends numbers, so normal use is not affected.
