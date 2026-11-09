# Driver payment setup: testing and rollout

This implements issue #242 using Everee hosted payroll and worker Embed. It does not change earnings, deductions, approved statement amounts or payment settlement. Only independently verified worker onboarding unlocks a Local driver's work and new payments when enforcement is on. Desi remains cash-only. An unknown type requires classification. Existing transfers keep reconciling.

## Install before activation

1. Back up the target database and test its restoration. Apply migrations first on an isolated copy:
   - `Backend/migrations/2026-11-07-issue-242-everee-driver-onboarding.sql`
   - `Backend/migrations/2026-11-07-everee-onboarding-sync.sql`
2. Keep sandbox and production token, tenant and webhook settings separate. An existing link without a verified tenant stays under review. Never copy a sandbox worker or completion into production. Verify old links individually; do not blanket backfill their tenant.
3. Leave `EVEREE_ONBOARDING_ENFORCED` off. Confirm the owner can open Payroll → Driver payment setup and select a city. This report previews readiness even while the setup/enforcement switches are off. It reads only local records; Refresh status reloads those records, not every worker at Everee.
4. Optional counts-only operator check, from Backend: `node scripts/evereeOnboardingReadiness.js --city-id <city-id>`. It prints counts and configuration state, never driver names, contact details or session URLs. Run once per city.

## Switches

- `EVEREE_DRIVER_ONBOARDING_ENABLED=true`: Local drivers can start/continue setup. Existing Local drivers receive the prompt and permanent setup entry. New Local drivers go from their NASA agreement to setup. This flag alone does not activate the hard gate.
- `EVEREE_ONBOARDING_ENFORCED=true`: together with the driver-onboarding flag, blocks Local drivers without verified completion from work and all new payments, including cash. Keep off until readiness and acceptance are reviewed. There is no browser activation button.
- `EVEREE_ONBOARDING_SYNC_ENABLED=true`: enables background recovery, only while driver onboarding is also enabled and Everee is configured. Off by default. Runs every five minutes, at most ten drivers and about 35 seconds of work before stopping the batch. Multiple backend instances serialize via a database session lock. Errors get durable exponential backoff with jitter; provider quota exhaustion pauses the company until the reset time. Missed-create recovery only searches/reads; it never creates a worker, changes profile data, opens a session or sends money.
- Existing payment switches are separate. Enabling onboarding never enables payments or approves a payroll at Everee.

## Sandbox acceptance

Use a disposable NASA database, sandbox credentials and fictional worker details. Everee accepts fictional tax/bank data in sandbox and no real funds move. For a supervised sandbox test, set the email on the test driver's NASA profile to the controlled inbox, and use that driver only for the fictional worker. Setup always uses the driver's own NASA email; there is no separate test-email setting. Use a controlled test inbox: the actual Embed screens require an email verification code. An `example.com` address can prove screen loading but cannot finish this step. Never use real driver tax or banking details for this test.

1. Unsigned Local: sign the NASA agreement, then reach payment setup without a redirect loop. Existing incomplete Local: login shows a prompt; dismissing it preserves the banner and permanent setup entry. Desi skips setup.
2. Start setup with accurate test name/contact/start date and fictional address. Exactly one worker is created. Retry after a lost connection: the same stable external ID is recovered, never replaced. Matching contact conflicts require admin review.
3. Everee opens inside NASA with a fresh ONBOARDING V2_0 session. Verify MessageChannel registration, stay on the healthy screen for over ten seconds, then close/resume. A new opening requests a new single-use session. Never save or log its URL.
4. Complete Everee's email verification, tax/signature and bank screens with the synthetic identity. NASA must re-read the worker. Closing the frame or a forged completion message alone must not unlock anything. Test delayed completion and an API timeout: Check again stays available.
5. Before verified completion: work and a new cash/Everee payment are refused server-side; with enforcement on, the screen lock (client requirement) shows a Local driver only the payment setup page, so past pay, the agreement view and password change are also hidden until verified. Logout stays available. The agreement page and drivers still to be classified are not locked. After verification: work is allowed and the existing payment review accepts an otherwise eligible driver. Onboarding completion and payment readiness remain separate: tax verification failure or termination still blocks Everee payment readiness.
6. Pay page: open PAYMENT_HISTORY V1_0 and PAYMENT_DEPOSIT V1_0. Verify server-owned identity, fresh sessions, loading/error recovery and no sensitive URL storage. A submitted/failed/returned transfer never says deposited. Existing cash receipts and pay statements remain separate.
7. One synthetic sandbox pay run: approved fixed amounts → explicitly select Everee → confirm → same owner manually approves in Everee → independently verify deposit status. A payroll marked PAID with a still-PENDING deposit is not NASA settlement. Ask Everee about simulation timing if deposits remain pending; never fabricate settlement or submit again to speed it up.
8. Desktop and narrow phone browser: usable keyboard/form, no horizontal overflow and recoverable failures. Physical iOS/Android builds: separate provider window, back/close, deep links, keyboard, PDF opening/download and external document host behavior. Do not broadly allow external navigation to make a PDF work; verify the real host and review a narrow document-opening change if needed.

## Production acceptance

Review every city's unclassified/held counts, current open-work routes and outstanding transfers with the owner. Plan the handover of work already in progress without deleting or rewriting it. Give Local drivers notice and a setup period with onboarding on and enforcement off. The feature flags currently apply to all Local drivers: stage through sandbox and a separate staging instance first; do not describe them as a production per-city cohort switch.

Before enabling the global production gate, obtain explicit owner approval after complete sandbox/browser/device acceptance, verified production links/configuration and route handover. Do not activate production from this runbook alone. Confirm a small controlled production acceptance with the owner before expanding use; production never receives fictional profiles.

## Recovery and rollback

For a missing create response, the scheduled job looks for the existing external ID and verifies its canonical worker ID. A still-invisible worker stays pending. For ambiguous identities, tenant mismatches or an admin unlink, resolve the identity in the admin workflow; do not create a substitute worker or flip completion manually. A retry cannot bypass an active lease.

Stop `EVEREE_ONBOARDING_SYNC_ENABLED` before rolling its code back. The sync rollback SQL removes scheduling metadata only and preserves onboarding/link/audit/payment history. Keep the original onboarding migration while application code uses it. If the owner authorizes suspending enforcement, turn off only the enforcement flag; keep existing transfer reconciliation running. Never erase paid history, alter debts, or change Local to Desi as a recovery shortcut.

## Official contracts checked

- [Embed components and versions](https://developer.everee.com/docs/everee-embed)
- [Create contractor for Embed](https://developer.everee.com/reference/add-a-contractor-for-embedded-onboarding)
- [Create session](https://developer.everee.com/reference/create-embedded-experience-url)
- [Private MessageChannel](https://developer.everee.com/docs/web-react-iframe)
- [Native WebView event handler](https://developer.everee.com/docs/react-native-reactnativewebview-library)
- [Component events](https://developer.everee.com/docs/handling-events)
- [Rate limits and reset metadata](https://developer.everee.com/docs/rate-limits)
- [Sandbox isolation and test data](https://developer.everee.com/docs/sandbox-and-production)
