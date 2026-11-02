# Courier claim rules and Claims Detail parser (issue #141, part 1)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #141 (part of #138; depends on #140 for matching) / see the pull request for this branch
- **Branch:** `feat/payroll-claim-rules` (from `develop`)
- **Type and scope:** feat(payroll)
- **Files touched:** new `Backend/services/payroll/claims/claimRules.js`, new `Backend/services/payroll/claims/claimsParser.js`, new tests `Backend/tests/claimRules.test.js` and `Backend/tests/claimsParser.test.js`, this journal entry. No reserved files. Nothing existing imports the new files yet.

**What and why.** The first, database-free part of automatic courier claims. It holds the owner-confirmed rules in one place and reads the carrier's "Claims Detail" sheet. Part 2 (next pull request) stores claims and keeps their match results. Applying a deduction to pay is #143. Nothing here charges anyone.

Rules (`claimRules.js`):
- **Deduction** = absolute value of "The total expenses-exclusive of taxes", to the cent: +40 and -40 both deduct 40. "Declared value (USD)" is kept only as evidence. Blank, zero, text and amounts with more than two decimals are refused, never turned into zero or rounded.
- **Exemption:** city key `dfwgofo` **and** claim type "Tracking interruption". Both must hold. Case, spaces and punctuation are ignored; other cities (`dfw`, `dallasgofo`, ...) stay distinct.
- **Who owes it:** decided only from the delivery history for the waybill (driver ID and city at the time), never from a name. No history, an unlinked delivery ID or no verified city leaves it `unresolved`. Two drivers, two cities, or a city different from the one the file was uploaded for makes it `ambiguous`. Neither status carries a deduction.
- **Identity:** courier + waybill + claim type (SHA-256). It does not include the amount, so a changed amount is a new version of the same claim, or the file name, so the same claim in two uploads is one claim.
- **Dates:** carrier dates are month first (`MM/DD/YYYY hh:mm:ss`). This was checked on the sample workbooks, where the second number goes above 12. Impossible dates are refused.
- `CLAIM_RULES_VERSION` is stored with each result in part 2, so a later rule change is traceable.

Parser (`claimsParser.js`): finds the "Claims Detail" sheet and matches column titles without case or spacing. A missing required column stops the sheet with one clear problem. Every non-blank row becomes a claim or a reported problem with its Excel row number. A claim type never seen before is still read. The same claim twice in one file is imported once; two copies with different facts are both held back for a person to check. The carrier's "Courier" (name) column is not kept.

**Database.** None in this part.

**Config and dependencies.** None. Uses the existing `xlsx` dependency.

**Money impact.** None. Nothing calls the new code, and nothing applies a deduction. Expected values for part 2 and #143: a claim of -40 deducts 40.00; an exempt DFW GOFO tracking-interruption claim deducts 0.00.

**Tested.**
- New unit tests (18):
  - +40/-40 to 40;
  - zero, blank, text and over-precise amounts;
  - the declared value differing from the charge;
  - all four city and type combinations;
  - case and space variants;
  - unknown, empty and other cities;
  - month-first dates and impossible dates;
  - claim identity;
  - no history, an unlinked delivery and no city;
  - two drivers and two cities;
  - same display name, different driver;
  - a driver who later changed city (history decides);
  - a file uploaded for a different city;
  - every known claim type plus a new one;
  - bad rows with row numbers;
  - repeated and conflicting rows;
  - a missing column;
  - reading from a workbook with and without the sheet.
- Whole backend suite: 63 tests, 31 run and pass, 32 database tests skipped as before.
- Read-only check on the three sample GOFO workbooks on the developer's machine (not in the repository). Only counts and claim types were printed: each has one claim (Driver Violent Delivery, fake pod, Damaged Item), with no problems, the negative charge read as a positive deduction, dates parsed, and the declared value kept separately.

**Not tested.** Offsets and prior-period lookups (they need the waybill history from #140 and part 2). A DFW GOFO workbook (none supplied; covered by synthetic tests only). SpeedX claims (no sample).

**Risks and follow-ups.**
- **The exempt city name needs confirming.** The rule matches a city stored as "DFW GOFO". The local copy of production (1 Nov) has **"Dallas GOFO"**, which does *not* match, so Tracking-interruption claims there would be chargeable. If "Dallas GOFO" is the DFW GOFO city, the owner must confirm it before part 2 is used; the fix is one line in `EXEMPTIONS`.
- Claim identity is provisional: it assumes one waybill cannot carry two separate claims of the same type (open decision in #138).
