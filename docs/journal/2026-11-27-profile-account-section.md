# Profile pages hold help, privacy, deletion requests and Delete account

| Field | Value |
|---|---|
| Date | 2026-11-27 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #353 |
| Branch | `feat/profile-account-section` (from `develop`) |
| Type / scope | `feat(ui)` |
| Files touched | `Frontend/src/components/account/AccountSection.jsx` (new), `AccountSection.test.jsx` (new), `AccountLinks.jsx`, `Frontend/src/components/Admin/Profile.jsx` (new), `Frontend/src/components/Drivers/Profile.jsx`, `Frontend/src/reuse/Header.jsx`, `Frontend/src/reuse/driver/Header.jsx`, `Frontend/src/App.jsx`, `Frontend/src/hooks/translation.js`, `Frontend/src/routes/driver/DriverSetupFlow.test.jsx`, this entry. |
| Reserved files touched | None. |

**What and why.** #353 put "Help and support", "Privacy policy", "Deletion requests" (super admin) and "Delete account" as separate links in both headers. The owner asked for one profile page that holds them instead.

- New admin page `/admin/profile`: name, email, role, and an "Account" card with the four links (Deletion requests only for a super admin). Read only, as before: a super admin still changes an admin's details.
- The driver's existing profile page gets the same "Account" card (help, privacy, Delete account).
- Admin header: the name and avatar are now a button to the profile; the separate links are gone (desktop and phone menu).
- Driver header: the links are gone, **except while the driver is locked** behind the agreement or the payment setup (Everee or QuickBooks). A locked driver cannot open the profile page, and Apple guideline 5.1.1(v) needs Delete account reachable, so they keep the short links in the header. No route guard changed.
- The labels are translated (English and Spanish keys `acct*`, `adminProf*`).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Frontend suite 674 passed (81 files), lint clean on the changed files, build passes. New tests: super admin profile shows details and all four links; a city admin has no Deletion requests; the admin header has no account links and its name opens the profile; the driver's card links; an unlocked driver's header has no account links. The existing locked-driver tests (help, privacy and Delete account still reachable during Everee and QuickBooks setup) pass unchanged. **Not tested:** in a browser or on a phone.
