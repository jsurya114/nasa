# Payment confirmation: returned deposits, approval link and warnings

- Date: 2026-11-05
- Author: Jasil (with Codex)
- Issue / PR: #213 / #215
- Branch: `feat/one-pay-to-drivers-button`
- Type and scope: fix(payroll), frontend only

The unified payment screen must distinguish a returned deposit from a successful
payment, provide the Everee approval action, and retain financial disclosures.

- Give the provider's return flag precedence over the success label in results
  and payment history. Keep the saved receipt, reference and original settlement
  evidence. Show success again only after the server clears the return flag.
- Keep returned deposits checkable and refresh their results and history even
  when the immutable paid count does not change.
- Open the official Everee portal in a separate tab after submission and from
  pending results. Preserve NASA's current screen and status refresh, with no
  guessed return URL or credentials in the link.
- Show each eligible driver's name, frozen amount and warning details directly
  before confirmation. Disclosures remain nonblocking.
- Merge current develop, retaining the city-derived pay-data label from #211
  and the single-superadmin policy from #214.

Database, config, dependencies and money calculations: unchanged. Backend files
are identical to the previously reviewed #215 head; only display and navigation
were corrected. No payment request or paid-history record is rewritten.

Validation: all 250 frontend tests passed across 29 files with Node 22, including
returned paid/submitted deposits, confirmed retry settlement, unchanged evidence,
refresh when paid counts stay equal, the portal link and real warning payloads.
The regression cases reproduced the defects before the fixes. Frontend build and
lint on the changed files passed. Earlier review of the unchanged backend passed
84 targeted payment, webhook and selection-parser tests using fake Everee calls.

Not tested: a real browser/mobile-device portal round trip, real Everee approval
or a sandbox payment reaching PAID. No provider transfer or production operation
was performed for this fix.
