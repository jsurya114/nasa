# Role and flow test matrix

Legend: **Unit** = automated tests run on 26-27 Nov 2026 on a Mac with no Xcode; **DB** = against a throwaway local PostgreSQL; **Device** / **TestFlight** = not run yet (no Xcode, no Apple account, no iPhone available to this work). Nothing below was run against production.

| Area | Check | Unit / DB | Simulator | Device | TestFlight |
|---|---|---|---|---|---|
| Sign-in | One page; admin, super admin, driver routed by server; generic failures; disabled account only after correct password; shared email asks to choose; limits count against both areas | Unit (backend 9, web 9) | - | Not run | Not run |
| Sign-in | Old /admin/login and /driver/login show the same page; "/" never 404 | Unit (web) | - | Not run | Not run |
| Sessions | One person on the phone; other area revoked at sign-in; old installs with both sessions signed out; storage error fails closed; refresh racing a sign-out revoked; offline start shows Try again | Unit (shell 80, web) | - | Not run | Not run |
| Sessions | Restart, expiry (15 min access / 7 day refresh), logout, account switch on a real phone | - | Not run | Not run | Not run |
| Roles and cities | Server checks unchanged (`requireRole`, city limits) | Existing tests | - | Not run as each role | Not run |
| Onboarding gates | Agreement then payment setup still enforced after the new sign-in; delete account reachable before them | Unit (web) | - | Not run | Not run |
| Documents | Invoice PDF, Desi pay-run PDF, statements CSV: browser download unchanged; app share sheet; older app told to update; 8 MB limit; one at a time; temp file deleted; long bridge messages need the nonce | Unit (shell, web) | - | Not run: share sheet, Save to Files, cancel | Not run |
| Account deletion | Request with password, withdraw, complete; pay rows unchanged (count and total); push tokens off; city access removed; last super admin and own request refused | DB (4) + web (3) | - | Not run | Not run |
| Push | Permission, denied state, tap routing, generic text | Existing unit tests | Not run | Not run; real APNs needs owner's Expo + APNs key | Not run |
| Everee / QuickBooks | Separate window, everee.com only; status from server | Existing unit tests | - | Not run in sandbox | Not run |
| Pickers | Camera/photo/Files pickers, denied permission, cancel, large file | - | - | Not run | Not run |
| Interrupted writes | Journey form uncertain-save; banner no longer promises kept input | Existing + shell | - | Not run on weak network | Not run |
| Android | Shared shell code unchanged except documents (expo-sharing works on Android) | Unit | - | Not run | - |
| Browser | All web tests (79 files, 665 tests) and `vite build` | Unit | - | - | - |
| Pay totals | No pay, rate, deduction or Excel logic changed in any of these PRs | Diff review | - | - | - |
