# App Review notes (draft, for App Store Connect)

Paste into **App Review Information > Notes**. Put the reviewer accounts **only** in the Sign-In Information fields of App Store Connect, never in this repository. Placeholders in `[brackets]` need the owner.

---

NASA Routes is the workforce app of NASA Logistics Carriers LLC, a delivery logistics company in [city/state]. It is used only by NASA's own authorised workforce: delivery drivers and contractors, city administrators and super administrators. **We are requesting Unlisted App distribution**, because the app is useless to the public: every account is created by a NASA administrator and there is no public sign-up.

**Signing in.** One sign-in screen for everyone (email and password). NASA's server decides whether the account is a driver or an administrator and which cities it may see; the person never chooses a role. Demo accounts (in Sign-In Information): super administrator, city administrator, Local driver (Everee pay set up), Desi driver (QuickBooks set up)[, a driver who still has to sign the agreement]. They contain made-up data only, never real workers.

**What drivers do.** Record the day's journey and deliveries, set weekly availability, see deliveries and pay statements, submit access-code photos for gated addresses, sign the driver agreement, and complete payment setup.

**What administrators do.** Manage drivers, routes and cities; upload the carriers' daily and weekly Excel reports; review journeys, availability, access codes and claims; prepare pay runs; download invoices and pay-run PDFs (shared through the iPhone share sheet).

**Payments.** Payments in the app are NASA paying its own workers for delivery work and NASA's own accounting. Nothing is sold to users; there is no digital content, subscription or purchase, so In-App Purchase does not apply. The app never initiates a real payment during review: the review environment's pay runs are synthetic and its Everee and QuickBooks connections are sandbox accounts.

**External services.**
- *Everee* (payroll provider) shows its own onboarding screens (identity, tax and bank details) in a separate in-app window. NASA never sees or stores the bank or tax details. The review environment uses Everee's sandbox: [describe the test identity/route Everee provides, or that the Local demo driver is already fully set up].
- *QuickBooks Online* (Intuit) is used for Desi drivers' vendor setup and NASA's bookkeeping, through Intuit's sandbox in the review environment.
- Push notifications go through Expo and APNs. Lock-screen text is generic ("You have a pay update."), never amounts or names.

**Native features.** Secure session storage in the Keychain (no passwords stored), push notifications for availability, pay updates, agreements and access codes (the app works fully if permission is denied; status is in the app's menu), the share sheet for invoices and pay-run PDFs (preview, Save to Files), the system camera/photo picker for access-code photos, Files for Excel uploads, connection-loss handling.

**Account deletion.** Menu > Delete account (also reachable before onboarding is finished). It asks for the password and confirmation; a super admin completes it within 30 days and the person sees the progress. Pay and delivery records NASA must keep for accounting are kept, as the screen explains. Super admins see requests under Menu > Deletion requests.

**Sign in with Apple.** Not offered: the app uses only NASA's own company accounts (guideline 4.8 exception).

**Contact during review:** [name, phone, email of the owner's contact].
