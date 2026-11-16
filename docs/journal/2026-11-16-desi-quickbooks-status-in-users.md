# Users page: Desi drivers show their QuickBooks setup status

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/desi-quickbooks-status-in-users` |
| Type / scope | `feat(drivers)` |
| Files touched | Backend: `services/admin/driverList.js`; test `driverList`. Frontend: `reuse/DriversList.jsx`, `reuse/driverEvereeStatus.js`, `redux/slice/admin/userLoadSlice.js`; test `DriversList.everee.test.jsx`. Journal entry. |
| Reserved files touched | None |

**What and why.** The Users page showed each Local driver's Everee onboarding status, but a Desi driver only showed "Not needed (Desi)", even after they
filled in the QuickBooks form. A Desi driver now shows their QuickBooks status in the same column, worked out from NASA's own records the way the driver
portal does it (`quickbooks/driverOnboarding.js` `getStatus`). Nothing is asked of QuickBooks.

| Desi driver | Status |
|---|---|
| a live QuickBooks vendor link for the connected company (made by the form, or by an admin) | **Onboarded** |
| no link | **Not started** |
| the driver changed their email or phone, the link was removed by an admin, or the link belongs to another QuickBooks company | **Needs review** |
| QuickBooks is switched off, not configured, or its tables are missing | **QuickBooks not set up** |

- The "Everee" column is now **Payment Setup**. Each row names its provider (Everee for Local, QuickBooks for Desi) and the status badge; a driver with
  no type shows no provider. A Desi driver who is not set up lists what is missing: the signed agreement, a valid email.
- The status chips, the status filter, the sort and the counts now cover both providers (a Desi driver is in the same "Onboarded" chip as a Local one;
  the Driver type filter separates them). The "Not needed" chip only appears if some driver has that status. Banners say when QuickBooks is not set up,
  its setup is switched off, or Desi drivers without it are on hold (`QUICKBOOKS_ONBOARDING_ENFORCED`), like the Everee ones.
- API: each driver has `quickbooks_status` and `quickbooks_needs` (null/empty for a driver who is not Desi); `everee_status` is unchanged (still
  `not-required` for a Desi driver). The answer has a new `quickbooks` object `{ available, configured, onboardingEnabled, enforced }`. Additive.

**Review fixes.**
- The "Onboarded" hint for a Desi driver no longer says the driver filled in the form or can be paid through QuickBooks. It says a QuickBooks vendor is
  linked, and that payments are made by check outside NASA and QuickBooks only records them (an admin can link an existing vendor without the form).
- New status `company-not-connected` ("Company not connected"). When QuickBooks is switched on but no company is connected for the environment, every
  Desi driver (linked or not) shows it instead of Not started or Needs review: nobody can be linked or checked yet, so none is sent toward the form and
  no form requirements are listed. A page banner says the same, and a chip with a count appears when any driver is in this state. The API's
  `quickbooks` object gains `companyConnected`. With QuickBooks switched off or not set up the status is still "QuickBooks not set up".

**Database.** None. The list query now also reads `quickbooks_vendors`, `quickbooks_connection` and `drivers.contact_changed_at`, which exist already.

**Config and dependencies.** None.

**Money impact.** None. A status label only; no payment, pay amount or access rule changes.

**Tested.**
- Backend `driverList` tests on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false
  QUICKBOOKS_PAYMENTS_ENABLED=false`): 12 passed. A new test covers: linked, not linked, no agreement, changed contact, removed link, another company's link,
  a link plus a changed contact (complete, as in the driver portal), a Local driver (no QuickBooks status), the missing-email need, the counts and filter, and
  QuickBooks off or onboarding paused. Two older expectations changed on purpose (a Desi driver is now "unavailable" when QuickBooks is not set up).
  Whole backend suite without the database: 427 tests, 330 passed, 0 failed (97 need the database).
- Frontend: full suite 605 passed; build clean. Lint shows 4 problems, all in `TempUploadedData` and `UploadedData`, identical on clean `develop`.

**Tested after the review.** `driverList` database tests on a local copy: 12 passed, including every Desi state with the company disconnected (all
`company-not-connected`, no needs, count and filter, a Local driver unaffected). Frontend `src/reuse` and `src/redux` tests: 54 passed (hint wording, banner,
the status shown without form requirements, the chip only when needed).

**Not tested.** In a browser against real data.

**Risks and follow-ups.**
- A Desi driver whose QuickBooks form found an existing vendor with the same email is told "your admin needs to confirm it", but NASA stores nothing about
  that, so the Users page shows them as "Not started", not "Needs review". Saving that outcome (a small table or column) would fix it: a follow-up.
- The chip counts mix Local (Everee) and Desi (QuickBooks) drivers; use the Driver type filter to separate them.
- Older receipts and the "Pay to drivers" window are not changed.
