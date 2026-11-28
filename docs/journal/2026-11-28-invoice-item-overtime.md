# Item-based invoices: overtime columns, and the new signature

| Field | Value |
|---|---|
| Date | 2026-11-28 |
| Author | Jasil, with Claude Code (Claude Opus 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/invoice-item-overtime` (from `develop`) |
| Type / scope | `feat(invoices)` |
| Files touched | Backend: `services/invoices/invoiceRules.js`, `invoiceStore.js`, migration `2026-11-28-invoice-item-overtime.sql` (+ rollback), tests `invoiceRules`, `invoiceStore`. Frontend: `invoice/invoiceRules.js`, `ItemLines.jsx`, `buildInvoicePdf.js`, `VendorManager.jsx` (one hint), new `assets/invoice-signature.png`, removed `invoice/invoiceSignature.js`, tests `invoiceRules`, `buildInvoicePdf`, new `ItemLines.test.jsx`. This entry. |
| Reserved files touched | None. |

**What and why.** The client asked for overtime on item-based invoices: two columns after Quantity, **OT (hrs)** and **OT (rate)**, and a new signature on the invoice.

- **Calculation.** A line's total is `rate x quantity + OT hours x OT rate`, rounded once to the cent (half up). The client's example: `100 x 2 + 2 x 30 = 200 + 60 = 260.00`. The subtotal is still the sum of the rounded lines. The server works this out and saves it; the form only previews the same figure.
- **Optional.** Overtime is optional per line, but OT hours and OT rate go together: one without the other is refused with "Enter both the OT hours and the OT rate, or leave both empty." Overtime alone (no item, rate and quantity) is not a line.
- **Form.** Item lines show Date, Day, Item, Rate, Qty, OT (hrs), OT rate, Total. **PDF.** The item table prints DATE, DAY, ITEM, RATE, QTY, OT (HRS), OT (RATE), TOTAL; a line without overtime leaves both OT cells empty. Hourly invoices are unchanged.
- **Signature.** The owner's new signature (from the photo supplied) replaces the old traced one: a PNG with a clear background, centred over the signature line. "Include signature" works as before. A signed invoice is refused rather than printed without the image if the file is ever missing.

**Database.** Two new nullable columns on `invoice_lines` (`ot_hours`, `ot_rate`), and the line-shape check now also requires: both OT fields or neither, never on hourly lines, and `line_total = round(rate * quantity + coalesce(ot_hours * ot_rate, 0), 2)`. No row changes; invoices saved before keep NULL overtime and the same totals. **Back up first, run the migration before deploying the code.** Rollback: `2026-11-28-invoice-item-overtime.rollback.sql` (refuses while any line has overtime). **Config / dependencies.** None.

**Money impact.** Only invoices that use the new overtime fields. Pay runs, payroll, Excel and the dashboard are not touched. Paid invoices stay locked, overtime included.

**Tested.**
- Backend: `invoiceRules` 9 passed (new: the 260.00 example, single rounding, both-or-neither, overtime alone refused). Whole backend suite: 388 passed, 0 failed, 109 skipped (database tests).
- Database, on a throwaway local PostgreSQL 17 with the real migrations and store code: the migration runs twice; an invoice saved before it is unchanged (no overtime, same total); the 260.00 + 200.00 = 460.00 invoice saves and reloads; the database refuses a wrong total, half an overtime and overtime on an hourly line; a paid invoice's lines stay locked; the rollback refuses while overtime exists. The overtime case was also added to `invoiceStore.test.js` (runs with `PAYROLL_TEST_DB=1`).
- Frontend: whole suite 675 passed (new: rules, the form typing 100 x 2 + 2 x 30 = $260.00, the PDF with and without overtime, the missing-signature refusal). Lint clean on the invoice and Desi folders, `npm run build` ok. A sample PDF was rendered and checked by eye (columns, long item names shortened, signature placement).
- Tests were run with Node 22 (`.nvmrc`); Node 23 lacks `zlib.createZstdDecompress` and some test files then fail to load (also on clean `develop`).

**Not tested.** In the browser against a running server; on production data.

**Risks and follow-ups.**
- Reprinting an older item invoice shows the two new (empty) OT columns and the new signature: the amounts do not change.
- Item names now have a little less room on the PDF (138 pt instead of 165 pt); a long name is shrunk and then shortened with "...", as before.
