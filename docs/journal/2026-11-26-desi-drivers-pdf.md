# Pay to drivers: download the Desi drivers as a PDF

| Field | Value |
|---|---|
| Date | 2026-11-26 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `feat/desi-drivers-pdf` (from `develop`) |
| Type / scope | `feat(payroll)` |
| Files touched | `Frontend/src/components/Admin/payRuns/desi/buildDesiDriversPdf.js` (new), `desi/DesiPdfButton.jsx` (new), `desi/buildDesiDriversPdf.test.js` (new), `payRuns/driverStatus.js` (new), `payRuns/RecordPaymentDialog.jsx`, `payRuns/DriverTypeTabs.test.jsx`, `payRuns/PaymentRuns.test.jsx`, `invoice/buildInvoicePdf.js` (helpers exported, nothing else changed), this entry. |
| Reserved files touched | None. |

**What and why.** Desi drivers are paid by check, so the owner wants their list on paper. In "Pay to drivers", the Desi tab now has a **Download Desi drivers PDF** button, for the super admin only. The PDF uses NASA's invoice look (logo, side bar, purple) and shows the city, pay period, number of drivers and total ("Desi drivers are paid by check only."), then one card per Desi driver, as on screen: name, status (Awaiting payment, Needs review, Paid, Payment processing), amount, and any message that holds the payment back. It is made in the browser from the review already loaded; nothing is sent or stored. Long lists run over numbered pages. The PDF code loads only on the first click.

**Shared status.** The status words and hold messages moved from the dialog into `driverStatus.js`, so the screen and the PDF always say the same thing. What the dialog shows is unchanged.

**Database.** None. **Config and dependencies.** None (`pdf-lib` and the fonts are already used by the invoice PDF). **Money impact.** None: read-only print of amounts the server already returns.

**Tested.** Frontend suite 644 passed, lint clean, `npm run build` ok (PDF code in its own chunk). New tests: PDF page size, title, same file twice, hold message printed and already-paid note not, many drivers over several pages, no drivers, safe file name, button only on the Desi tab and only for the super admin. A sample PDF with made-up drivers was checked by eye. **Not tested:** clicking the button in a real browser against production data; non-Latin letters in a name (the font drops what it cannot draw, as the invoice does).

**Risks and follow-ups.** None known. Frontend goes live through Vercel after a release to `main`.
