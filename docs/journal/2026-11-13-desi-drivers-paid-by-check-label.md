# Pay to drivers: Desi drivers are shown as paid by check, not Cash in Hand

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/desi-drivers-paid-by-check` |
| Type / scope | `feat(frontend)`, wording only |
| Files touched | Frontend: `payRuns/RecordPaymentDialog.jsx`, `payRuns/driverTypes.js`, `payRuns/quickbooks/QuickbooksResult.jsx`; tests `DriverTypeTabs`, `QuickbooksPay`. Journal entry. |
| Reserved files touched | None |

**What and why.** Desi drivers are paid by check, not cash in hand. The Pay to drivers screen still said "Cash in Hand" for them. For Desi drivers it now says "Check": the Desi tab hint, the fixed payment method ("Check, recorded in QuickBooks" or "Check (Desi drivers are paid by check only)"), the note placeholder, the summary line, the confirmation texts and the QuickBooks result messages ("Paid by check; ..."). Local drivers are unchanged and still show "Cash in Hand" or "Bank transfer (Everee)".

**Database.** None. The stored method value stays `cash` for every manual payment, so receipts, statements, reports and the API are unchanged.

**Config and dependencies.** None.

**Money impact.** None. Wording only; no amount, rule or request changes.

**Tested.** Frontend `payRuns` tests: 11 files, 75 tests passed, after updating the expected wording in two test files.

**Not tested.** By hand in the browser.

**Risks and follow-ups.**
- A saved receipt for a Desi payment still shows the stored method name "Cash in Hand", because the receipt does not record the driver type. Changing that needs the type on the receipt, or a new stored method (a database change); not done here.
- Backend messages and code comments still say "Cash in Hand" for Desi drivers; they are not shown on this screen.
