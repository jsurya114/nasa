# Unlisted distribution: request draft and steps

Source: Apple, "Unlisted app distribution" and App Store Connect Help (read 26 Nov 2026). Nothing here has been submitted.

## Order of steps

1. App Store Connect > the app > **Pricing and Availability**: leave **App Distribution Method = Public** (Unlisted is requested for a public app; it is not chosen up front).
2. On the version page, **App Store Version Release > "Manually release this version"**. This keeps an approved build in *Pending Developer Release*, so it is never listed publicly while the unlisted request is pending.
3. Fill the metadata (METADATA.md), App Privacy (PRIVACY_WORKSHEET.md), Sign-In Information and Review Notes (REVIEW_NOTES.md, which says we want unlisted distribution).
4. **Submit for Review.** Apple declines unlisted requests for apps that have not been submitted to App Review, or for betas.
5. Then submit the request at https://developer.apple.com/contact/request/unlisted-app/ with the text below.
6. When Apple approves it, Pricing and Availability shows **Unlisted App**. Only then press **Release This Version**. Share the link only with NASA's workforce. The setting applies to future versions too and cannot be changed back.
7. If App Review approves but the unlisted request is declined or still pending: **do not release**. Reply to Apple, or decide with the owner. Apple reminds after 30 days in Pending Developer Release.

Unlisted does not replace sign-in: anyone with the link can download the app, and only NASA-created accounts can sign in.

## Request text (draft)

> **App:** NASA Routes (Apple ID [app id]), developer [legal entity name].
>
> NASA Logistics Carriers LLC is a delivery logistics company in [city/state]. NASA Routes is its internal workforce app. It is used only by NASA's authorised delivery drivers and contractors ([confirmed number] people) and its city and super administrators ([confirmed number]) to record deliveries and availability, see pay statements, complete payroll onboarding, and run day-to-day operations.
>
> Every account is created by a NASA administrator; there is no public sign-up and the app has no function for anyone outside NASA. Drivers are independent contractors and part-time workers who use their own, unmanaged iPhones, so Apple Business Manager custom distribution is not an option for most of them.
>
> General App Store discovery would expose a company-internal tool to the public and generate failed sign-ins and support requests from people who cannot use it. We ask for unlisted distribution so NASA can give the link only to its workforce. The app has been submitted to App Review with demo accounts for each role.

Use only audience numbers the owner confirms.
