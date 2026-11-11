# Driver payment setup: Look up, Link and Unlink controls, and a warning for near-duplicate driver names

| Field | Value |
|---|---|
| Date | 2026-11-12 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request. Stacked on #278 (merge #278 first) |
| Branch | `feat/everee-admin-link-controls` |
| Type / scope | `feat(payroll)` |
| Files touched | Backend: `services/payments/everee/workerStore.js`, `controllers/payroll/evereeWorkerController.js`, `services/admin/driverName.js`, `controllers/admin/addUserController.js`, new tests `evereeAdminLinking.test.js` and `driverSimilarName.test.js`. Frontend: `components/Admin/EvereeLinkPanel.jsx` (new) and its test, `components/Admin/PaymentSetupOverview.jsx`, `components/Admin/AddUsers.jsx`, `redux/slice/admin/userLoadSlice.js`, `components/Admin/AddUsers.modal.test.jsx` |
| Reserved files touched | None |

**What and why.** A driver can end up registered twice (an old disabled record that is already linked to her Everee worker, and a new active record). The new record then sits at "Needs review" and the driver is locked out, and an admin had no way to fix it except calling the backend directly. Agreed with Jasil on Slack (12 Nov): keep the active record, keep the old disabled one for history, reuse the existing Everee worker, and add admin controls.

1. **Look up, Link and Unlink on Driver payment setup** (super admin only; the server checks the role and the admin's cities again). Every needs-review card has "Look up in Everee". The result shows the candidate worker's name and masked email and phone, whether it matched on email, phone or both, and a conflict if one detail matches and the other differs. The rules are unchanged: a worker is linked only from one exact email or phone match, never by name.
2. **A disabled record's link is now visible.** When the worker is still linked to another driver record, Look up returns that record (name, driver code, enabled or disabled, city) and whether it has unsettled Everee payments. "Remove link from that record" needs a reason of at least 3 characters, works across cities for a super admin, then looks up again so the admin sees the clean match before pressing "Link this worker". The old link row is kept as history (who, when, why).
3. **Unlink now refuses while the driver has unsettled Everee payments** (sent and not confirmed, not sent, or a returned deposit: the same rule the readiness page uses) unless the request says `acknowledgeOutstanding: true`. The screen asks for a tick box first. This is the "check outstanding payments before moving the link" step.
4. **Adding a driver with a name that already exists names the record to review** (driver code and enabled or disabled) instead of only "already exists". A name that differs only by punctuation or spacing ("Sam Lee" and "Sam Lee..") is a question: the server answers 409 `similar_driver` with the matching records, and the Add Driver screen asks "This is a different person: create anyway" or "Go back". Only records in cities the admin manages are named. The old exact-name rule (#177) is unchanged.

**Not changed:** the name rule, the exact-match linking rules, what makes a driver Onboarded (only a link to a worker that Everee reports complete), and anything about pay amounts.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No pay, rate, deduction or payment logic changes. Moving a link changes which NASA driver record the Everee worker belongs to; old work and pay records stay on their original records. The unsettled-payments check only makes an Unlink harder, never easier.

**Tested.**
- Database tests (`PAYROLL_TEST_DB=1`, in a rolled-back transaction, fake Everee): `evereeAdminLinking` (Look up names the holding disabled record and masks the worker; Link refused while it holds the worker; Unlink refused for a plain admin, a blank reason and unsettled payments, then works; the old link is kept as history; Look up again is a clean match and Link works) and `driverSimilarName` (exact name names the record; a punctuation-only difference is a question, confirmed with `confirmSimilar`; an unrelated name is not questioned). The existing Everee, readiness, onboarding and contact tests still pass (44 passed, 0 failed in those files).
- Backend suite without the database: 318 passed, 0 failed (one earlier run showed one failure in the Insights access test; it passed alone, on a clean checkout and in two more full runs, so I treat it as a flaky test, not this change).
- Frontend: 599 passed in 67 files, build and lint of the changed files pass. New cases cover the whole move (masked candidate, holder named, reason required, Unlink sent for the other record in its own city, Look up again, Link), the unsettled-payments tick box, the no-match, conflict and incomplete-driver messages, a server refusal, and the similar-name question.

**Not tested.** Real Everee or the production database; a click-through in a browser; a phone. The "unsettled payments" test replaces the answer to that one query (building a pay run and payment item for it needs a long chain of records); the same SQL runs unchanged in the Look up test and on the readiness page. That an admin without access to a city is not told about a record in it is written into the code but not covered by a test.

**Risks and follow-ups.**
- Look up on the new record finds the worker only if the new record's email or phone equals the worker's. If the two NASA records have different contact details, the lookup says no match; confirm the real details with the driver and correct them in Users first (a driver whose own email or phone change is waiting for confirmation, from #278, is also blocked until a super admin confirms it).
- Do the production move in this order: check the exact review reason on the card, check the worker in the production Everee company and the old record's payments, Look up, remove the link from the old record with a reason that names the move, Look up again, Link, ask the driver to reopen the app.
- The near-duplicate check ignores everything except letters and digits and uses the database's idea of a letter, so with a plain "C" database an accented letter can be dropped on both sides. It is a warning only, never a block.
- An admin can still press "create anyway" for a genuinely different person with a near-identical name.
