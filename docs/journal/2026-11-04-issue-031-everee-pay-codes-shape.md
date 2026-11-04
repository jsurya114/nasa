# Everee: read the pay codes the way the sandbox sends them (issue #31)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / see the pull request for this branch
- **Branch:** `fix/everee-pay-codes-shape` (from `develop`)
- **Type and scope:** fix(payroll), backend
- **Files touched:** `Backend/services/payments/everee/evereeService.js`, test `Backend/tests/evereeConnection.test.js`; this entry. No reserved files.

**What happened.** The first real call to the Everee sandbox (the read-only connection test from #192, `GET /integration/v1/pay-codes`) succeeded: the sandbox accepted the token and tenant ID. But the answer was a plain list of 28 pay codes, while Everee's reference page shows a page object with `items`, and #192 read only `items`. So the test said "connected" and listed no pay codes.

**The change.** The reader accepts both a plain list and a page object with `items`. Nothing else changes.

**Sandbox evidence (no personal data).** Environment sandbox; the connection check returned OK; 28 pay codes, each with `payCodeType`, `displayLabel` and `apiKey`; `CONTRACTOR` is among them (Jasil accepted it as the default pay code); `REIMBURSEMENT` and `ADVANCE` also exist.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None (a read-only display).

**Tested.** `evereeConnection.test.js` (10): the plain list, the page object and an empty answer. Run against the real sandbox once (counts above).

**Not tested.** In the browser panel.
