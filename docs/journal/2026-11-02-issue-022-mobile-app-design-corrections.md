# Mobile app design: review corrections (issue #22)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #22 / review on PR #123
- **Branch:** `docs/mobile-app-design`
- **Type and scope:** docs
- **Files touched:** `docs/MOBILE_APP_DESIGN.md`. No code.

**What changed, and why** (all three points are from Jasil's review of #123; the earlier journal entry for this design is left as it was).
- **Online-only wording.** The introduction and the issue #22 note still said "online-only". They now match the weak-connection clarification: reliable on weak or intermittent connections, no offline writes or replay queues unless agreed.
- **Push testing split.** Simulated or local notifications (permission prompt, lock-screen text, tap routing) are listed separately from the real remote path (token registration, server targeting by role and city, delivery through Expo to APNs or FCM, receipts, logout cleanup). A test payload does not prove the second. Credentials are listed per platform, with a link to Expo's setup guide, and the testing table has a separate row for each.
- **Account deletion.** The blanket statement is replaced by an assessment of the real flow: no self sign-up, but admins and super admins create accounts inside the single app, so neither Apple's nor Google's rule is assumed not to apply. The document plans as if deletion applies, keeps business and accounting records, and lists the decisions still open (who may request deletion, the retention period, what stays on paid history).

Biometric unlock stays recorded as out of the initial release (already corrected in the previous commit). Developer-account ownership stays deferred.

**Database.** None. **Config and dependencies.** None. **Money impact.** None. **Tested.** Read-through only; no code changed.
