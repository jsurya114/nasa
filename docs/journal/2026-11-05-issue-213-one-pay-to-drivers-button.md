# Pay runs: one "Pay to drivers" button, with Bank transfer (Everee) as a method (issue #213)

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #213 (approved with conditions by Jasil on 5 Nov) / #31 / see the pull request for this branch. It contains the commit of #214 (single super admin) until that merges.
- **Branch:** `feat/one-pay-to-drivers-button`
- **Type and scope:** feat(payroll), backend and frontend
- **Files touched:** Backend: `batchPreview.js`, `batchSubmit.js` (a driver selection), `controllers/payroll/evereeBatchController.js`, `evereePaymentController.js`, new `statementIdList.js`. Frontend: `RecordPaymentDialog.jsx` (now the single payment flow), `PaymentRuns.jsx`, `RunPaymentStatus.jsx` (button text), new `everee/EvereeRunResults.jsx`, `EvereeSummary.jsx`, `ProviderPaymentLine.jsx` and `evereeLabels.js` (wording). Removed: `PayWithEvereeButton.jsx`, `EvereePayDialog.jsx`, `EvereePreview.jsx`. Tests: `evereeSubmit.test.js`, `statementIdList.test.js`, `EvereePay.test.jsx` (rewritten), `PaymentRuns.test.jsx`. **`RecordPaymentDialog.jsx`, `PaymentRuns.jsx` and the payment flow are Jasil's area; his decision approves the change** (see issue #213).

**What changed.**
1. One button, **Pay to drivers**, replaces "Mark all/remaining N as paid" and "Pay with Everee", on the Driver payments cards and on the run detail.
2. It opens the driver review. After choosing drivers, **Continue with payment** goes to the payment step.
3. The method is chosen on purpose, **nothing pre-selected**: **Bank transfer (Everee)** (offered only to a super admin on a server where Everee is set up), **Cash**, **Other**. Only Bank transfer (Everee) calls Everee; Cash and Other record money paid outside NASA and send nothing, as before.
4. **Reference** is removed; only **Payment note** remains (Cash and Other, at least 3 characters). It is sent in the same server field as before, so the manual receipt shape is unchanged and saved receipts keep their reference. An Everee payment's reference comes from Everee. The Everee method has no note and no "Paid on".
5. The payment step shows a summary naming **method, driver count and total** before the final **Pay**. For Everee the count and total are the server's preview of the chosen drivers. The final button is **Pay**.
6. **Everee sends only the chosen drivers.** The preview and the confirm accept an optional `statementIds` list (GET `?statementIds=1,2,3`, POST body array). The server checks every ID belongs to the run (400 otherwise), previews and fingerprints only those, and sends only those. Without the list the whole run is used, as before. A hash made for the whole run no longer fits a chosen subset (409).
7. After Pay the dialog says **Submitted to Everee** and shows the results (Check now, Retry what failed, refreshing by itself every minute while payments wait). The results also appear at the top of the review for a run that already has Everee payments.
8. **Payment history wording:** `Submitted to Everee` while waiting, `Transaction successful` only when Everee reports every payout PAID (the server's rule is unchanged). The batch results use the same words.
9. **Identification:** unchanged and as approved: drivers are matched to Everee workers by email or phone, never by name. A driver who cannot be paid is listed with the reason, and the driver's own name and phone are what the review checks.

**Not changed.** Frozen amounts, two steps (choose and review, then pay), the duplicate guards and locks, request-ID idempotency, partial failure with safe retry, "paid" only when the deposit is verified, sandbox only, no live keys. The single super admin rule is #214. Everee's portal approval is still a manual step, and Everee's documentation describes no return link after approval, so there is no redirect back; the dialog stays open and the status refreshes. Jayasoorya asks Everee support about a return link and about the work location for contractors.

**Database, config, dependencies:** none. **Money impact:** none; amounts come from the approved run.

**Tested.** Backend (rolled-back DB tests, fake Everee): only the chosen drivers are previewed and sent (2 of 3, $21.00), a statement of another run or an empty list is refused, a whole-run hash is refused for a subset; the list parser. Frontend: no method is pre-selected; Everee is offered only to a super admin where it is set up; choosing Everee previews exactly the chosen statements and names method, count and total; only Pay sends, with the preview hash and a request ID; a lost answer repeats the same request ID; a changed preview shows the new summary and a new request ID; a blocked batch disables Pay and says why; warnings show before Pay and do not block; Cash and Other call no Everee and still need a note and a confirmation; results show words, retry and check; history shows the Everee payment beside the manual receipt.

**Not tested.** A real sandbox payment, the Everee portal approval, and the screens in a browser. The full frontend run shows 4 unrelated failures under load (Journey, Availability, Dashboard, Payroll) that pass alone; two older backend pay-run tests assume no recovery limit and the local copy has one.
