# Mobile app: store readiness checklist

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `docs/mobile-store-readiness` (built on `feat/mobile-weak-connection` and the stack below it) |
| Type / scope | `docs(mobile)` |
| Files touched | `docs/MOBILE_STORE_READINESS.md` (new) |
| Reserved files touched | None |

**What and why.** Section 9 of the design asked for a store checklist. This is it: for Apple and Google, what is done, what needs a device, and what needs the owner (accounts, identifiers, artwork, privacy text), plus what the build ships, the tests that still have to run on a phone, and what was left unbuilt on purpose. Statuses are taken from the work in the pull requests it sits on, not from anything run on a device.

**Database, config, money.** None.

**Tested.** Documentation only. Every "Done" row refers to a check recorded in an earlier journal entry (generated-project permission checks, configuration tests, unit tests). **Correction after review (2 Nov 2026).** The first version said the Android permissions were "verified" and that nothing was needed beyond the platform defaults, but it came from the generated project manifest only and the Gradle manifest merge was never run. The locked `expo-notifications` 58.1.7 declares `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` in its own manifest (and `expo-file-system` declares `INTERNET` and the two storage permissions, which the project manifest removes). The checklist now lists the project manifest, the library-declared permissions (read from the locked packages) and the merged release manifest as three separate rows; the first two are Done as lists of what is declared, and the merged release manifest is **Pending** and says how to check it. The rows for local-network entries and cleartext now rest on the generated iOS Info.plist, after #130 found that `NSAllowsLocalNetworking` was still present in preview and production. **Not verified:** the merged Android manifest; any store requirement against the stores' current wording; the rows marked "check at submission time" depend on rules that change.

**Risks and follow-ups.** The privacy and Data safety answers need the owner's review before anything is filed. The account-deletion decision gates two rows.
