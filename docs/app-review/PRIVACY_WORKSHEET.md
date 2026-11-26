# App Privacy worksheet (draft for the owner)

Checked in the code on 26 Nov 2026 (develop at 2700fa5 plus the mobile review branches). Apple counts data collected through the app's WebView and by third-party partners in the app, so the shell being "a WebView" changes nothing. Sources: https://developer.apple.com/app-store/app-privacy-details/

## Tracking audit

No advertising, analytics, attribution, crash-reporting or tracking SDK in the shell (`mobile/package.json`), the web app (`Frontend/package.json`, `index.html`) or the backend. No IDFA, no App Tracking Transparency prompt, no data broker. The app-level privacy manifest says `NSPrivacyTracking = false` with no tracking domains. **Answer: no data is used for tracking.**

## Data flows

| Where | What leaves the phone | Recipient |
|---|---|---|
| NASA web app (in the WebView) and API (`api.nasaroutes.com`, AWS us-east-1; database on AWS RDS; Redis host for sessions and rate limits) | Everything in the table below that NASA stores | NASA Logistics Carriers LLC |
| Cloudinary | Access-code photos the driver chooses | Image host for NASA |
| Expo push service, then APNs | Expo push token, generic notification text | Expo, Apple |
| Everee window (Everee's own pages, a separate isolated WebView) | Identity, tax ID, bank details, documents the driver enters | Everee (NASA receives only status and pay records) |
| QuickBooks Online (Intuit) | Desi drivers' vendor details incl. tax ID passed through NASA (not stored by NASA); bills and payment records | Intuit |
| Vercel | Serves the web app; standard request logs | Vercel (hosting) |
| Insights connector (if the owner uses it) | Aggregated business figures requested by a super admin's AI client | The owner's AI provider (not part of the driver experience; owner to confirm whether it is in use) |

## Answers by Apple category (all: linked to the user, not used for tracking)

| Apple data type | Collected? | What | Purposes |
|---|---|---|---|
| Contact Info: Name | Yes | Account name | App Functionality |
| Contact Info: Email Address | Yes | Sign-in email | App Functionality |
| Contact Info: Phone Number | Yes | Driver phone | App Functionality |
| Contact Info: Physical Address | Owner to check | Only if Everee or the agreement collects a home address | App Functionality |
| Financial Info: Payment Info | Yes (by Everee in the app) | Bank account for payouts | App Functionality |
| Financial Info: Other Financial Info | Yes | Earnings, deductions, pay statements, payments, claims, tax ID (Everee, QuickBooks) | App Functionality |
| Location | No | No GPS or location permission. Delivery addresses are work data, not the user's location | - |
| User Content: Photos or Videos | Yes | Access-code photos | App Functionality |
| User Content: Other User Content | Yes | Agreement signature, availability, journeys, claims, Excel reports (admins) | App Functionality |
| Identifiers: User ID | Yes | NASA account id, driver code | App Functionality |
| Identifiers: Device ID | Yes (recommended disclosure) | Expo push token | App Functionality |
| Other Data | Yes (by Everee) | Identity-verification details and documents on Everee's screens | App Functionality |
| Usage Data, Diagnostics, Browsing/Search History, Contacts, Health, Purchases, Sensitive Info | No | Server logs record method and path only, for operations; no product analytics or crash data | - |

## Retention (owner decision)

Kept as business and accounting records: deliveries, statements, payments, claims and history. Removed on account deletion: sign-in email and password, phone (drivers), city access (admins), push tokens (docs/ACCOUNT_DELETION.md). No retention period is set; the owner decides it. Everee and Intuit retain under their own policies.

## Required-reason APIs (from the generated iOS project, 26 Nov)

Declared by the SDKs' own privacy manifests, not copied by hand: React Native (FileTimestamp C617.1, UserDefaults CA92.1, SystemBootTime 35F9.1), expo-constants and expo-notifications (UserDefaults CA92.1), expo-device (SystemBootTime 35F9.1), expo-file-system (FileTimestamp 0A2A.1, 3B52.1; DiskSpace E174.1, 85F4.1), expo-application (FileTimestamp C617.1). expo-secure-store, expo-crypto, expo-sharing and react-native-webview ship no manifest. **Still to do on a Mac with Xcode 26:** archive, then Xcode > Generate Privacy Report, and check every SDK in Apple's commonly-used-SDK list has its signature and manifest in the archive.
