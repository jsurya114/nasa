# Bring the mobile README status up to date

| Field | Value |
|---|---|
| Date | 2026-11-04 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `docs/mobile-readme-status` |
| Type / scope | `docs(mobile)` |
| Files touched | `mobile/README.md` (Status section only) |
| Reserved files touched | None. |

**What and why.** The Status section still said push, the permissions work and the journey weak-connection handling were "next", although they are merged (#130 to #137). It now lists what is merged, what is left (a real-device test, the Android merged release manifest, the owner's decisions and accounts, store paperwork, artwork) and what is left out on purpose, and points to `docs/MOBILE_STORE_READINESS.md` for the status of each item. Still stated plainly: it has not run on a phone or simulator yet.

**Money impact.** None. Documentation only.

**Tested.** Read against `docs/MOBILE_STORE_READINESS.md` and the merged PR list. No code changed.
