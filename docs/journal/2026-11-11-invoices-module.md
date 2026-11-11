# Invoices module: saved vendors, two invoice formats, history and payment received

The fill-and-download invoice on the Insights page (2026-11-10) becomes its own page, **Invoices** (`/admin/invoices`, super admin only, in the admin navigation). It has three parts: **Create invoice**, **Invoice history** and **Manage vendors**. The old button on Insights is gone.

**Vendors** hold a billing name, billing address, an optional contact name and email, and a required billing type: Hourly or Item-based. The GOFO details the old form filled in are carried forward as an editable Hourly vendor. Choosing a vendor on an invoice fills in Bill to and opens that vendor's format. The page asks before a vendor change throws away lines or Bill to edits. Editing a vendor changes new invoices only: each saved invoice keeps its own copy of Bill to.

**Hourly** keeps the template's layout and calculation: up to seven jobs (job, RE hours, overtime, total hours, total cost). Total hours follows RE hours + overtime until you type your own. The invoice total is the sum of the costs as entered.

**Item-based** lists one row for every calendar date from From to To, both included, weekends too. The date and weekday are filled in; you type the item, rate and quantity. Each line total is rate x quantity rounded half up to the cent, and the subtotal is the sum of those rounded lines ($200.00 x 4 = $800.00). Empty rows are skipped. A part-filled row is flagged. The invoice needs at least one complete line with an amount. If you move the dates, anything typed for a date still in range is kept. Lines that fall outside are shown in a warning and dropped only when you save (after a confirmation). The PDF runs over as many pages as needed. Every page repeats the column headers and has a page number. The last page holds the subtotal, terms, contact block and signature.

**Both PDFs** share one header and footer. The header has NASA LOGISTICS CARRIERS, ARLINGTON, TEXAS 76015 (the street line is gone everywhere, including the old hard-coded text), and separate lines for INVOICE NUMBER, INVOICE DATE and BILLING PERIOD. The footer has the new terms text and a Contact block with +1 (682) 699-3175, nasalogisticscarriers@gmail.com and Info@drivefornlc.com. There are no due dates, fees, taxes or payment instructions. The invoice date is the America/Chicago date on which the invoice is first saved, and it never changes. The PDF is always drawn from the saved invoice, so a PDF made again later prints the same number, date, Bill to, issuer and terms.

**Saved invoices** (migration `2026-11-11-invoices.sql`, additive: `invoice_vendors`, `invoices`, `invoice_lines`, `reporting.invoice_payments`):
- The server works out every amount again and saves its own figures. The numbers are unique, ignoring case.
- A retried create returns the invoice it already made (the browser's request id).
- Edits carry a version number, so a stale edit is refused.
- A pending invoice can be changed and saved again under the same number. It never becomes a second invoice.
- **Mark payment received** records a full payment that arrived outside NASA. It records the date (today in Chicago by default, never in the future), an optional reference, and who recorded it and when. Nothing is sent or moved.
- After that, the invoice and its lines are locked by database triggers, whatever code tries to change them. A paid invoice can still be opened and downloaded.
- Confirming the same payment twice records it once. Confirming a different date afterwards is refused.

**History** lists invoices newest first, 20 per page, paged on the server with a stable order. You can search by number or vendor, filter by vendor, type, status and invoice-date range, and sort by invoice date, payment received date or amount.

**Insights** has a new card, **Invoice payments received**. It is the saved total of each paid invoice, counted once, in the period that contains its payment received date. Pending invoices count as zero. It is company-wide: the card says so when a city or source filter is on. It is not added to delivery revenue, margin or driver earnings.

Validation:
- Backend: rule tests (8) pass. The database tests (12, in a rolled-back transaction plus one two-connection race) cover persistence after reload, numbering, regenerating under the same number, stale edits, vendor edits leaving saved invoices alone, the trigger locks, retried payments and history filters and sorts. They also cover the Insights figure: counted once, only in its receipt period, with delivery revenue, margin and driver earnings unchanged.
- Frontend: tests pass (rules, PDF, page and Insights; 568 in the whole suite).
- Lint shows no new findings.
- One PDF of each type was generated and inspected as an image (a 45-day item invoice ran to two pages). The page was used in a real browser: add a vendor, create, save, open, record a payment, and see the figure in Insights.
- API access was checked: super admin 200, admin 403, no token 401.

Not done: the handwritten sketch of the item layout mentioned in the request was not attached, so the item-based layout follows the written six-column description.
