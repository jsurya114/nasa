# Label the October cost lines as including tax

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Author | Jasil, with Claude Code (Claude Opus 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #322 |
| Branch | `docs/cost-table-tax-label` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | `docs/infra/AWS_COST_OPTIMISATION.md` (section 0, the October table only), this entry. |
| Reserved files touched | None. |

**What and why.** In the #322 review, Jayasoorya noticed that the October lines in section 0 add up to $41.31, while the text says October before tax was $38.75. Both figures are right. The lines come from the bill and include tax: $41.31 is exactly October's total with tax, and each line is about 6.6% above its on-demand rate for 744 hours (for example `t3.micro`: $0.0104 × 744 = $7.74 before tax, $8.25 on the bill). The table now says the lines include tax and has a total row showing both figures, so it can't be compared with the before-tax rates in the next table by mistake. No figure changed.

**Database.** None. **Config and dependencies.** None. **Money impact.** None (documentation only). **Tested.** Added up the five lines ($41.31), and checked each line against its rate × 744 hours × about 1.066. **Not tested.** Nothing runs.

**Risks and follow-ups.** None.
