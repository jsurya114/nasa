# Mobile app: file pickers through the WebView, and the permissions the build ships

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `feat/mobile-file-pickers` (built on `feat/push-web-registration` and `chore/mobile-eas-profiles`; merge those first) |
| Type / scope | `feat(mobile)` |
| Files touched | `mobile/app.config.js`, `mobile/app.config.test.js`, `docs/MOBILE_APP_DESIGN.md` |
| Reserved files touched | None |

**What and why.** Items 2, 3 and 4 of the native MVP table (camera or photo picker, document picker, share sheet), and the permission rules of section 7.
- **Decision: the file pickers use the WebView's own picker; no bridge action is built.** The web app already has `<input type="file">` for the access-code photos (`accept` images) and for the Excel uploads (`.xls`, `.xlsx`, `.csv`). Inside the app the system picker opens for them (iOS: photo library, Take Photo, Files; Android: the system chooser with the camera as one choice). Doing it through the bridge would mean sending file bytes through the page's message channel, a second upload path next to the existing authenticated one, and a copy of the upload rules in the shell. `media.pickImages`, `file.pickDocument` and `file.share` stay reserved names (the shell answers `unsupported_action`; they are not in the capability list). **No share sheet: the web app has no download or export today** (searched the frontend for downloads, blobs and response types). The design document now says this, and lists the five push actions that were missing from its action table.
- **Camera.** Taking a photo from the picker needs the iOS reason text, which is set with a plain reason. The photo library needs no permission. **Android is given no camera permission, deliberately** (changed after an automated security review of the first version of this pull request, which declared `CAMERA`): the picker passes the photo to the system camera app, which needs none; an app that holds `CAMERA` would let a page in the WebView start the camera by itself, because react-native-webview grants a page's `getUserMedia` request when the app has the permission; and the library leaves the camera choice out of the picker when `CAMERA` is declared but not granted. iOS denies every camera and microphone request from a page (`mediaCapturePermissionGrantType="deny"`).
- **Found while checking the generated native projects (`expo prebuild`).** The build was shipping things the design says it must not:
  - `NSFaceIDUsageDescription` (added by the secure-store plugin by default). The decision of 2 Nov was no biometric text. It is now off.
  - `NSLocalNetworkUsageDescription` and `NSBonjourServices` (added by the development client), and `NSAllowsLocalNetworking` (shipped by the native iOS template itself). Kept in development builds, removed from preview and production by one plugin, `withoutLocalNetworkExceptions`, introduced in #130. (This note first listed only the first two; the third was caught in review and the plist tests now read the generated file.)
  - Android `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and `SYSTEM_ALERT_WINDOW`, added by default and used by nothing. They are now blocked (`tools:node="remove"`). `VIBRATE` stays because notifications use it.
  - Not changed: the web origin does not send a `Permissions-Policy` header, which would also stop a page in an ordinary browser from asking for the camera. That header lives in the hosting configuration (`Frontend/vercel.json`, Jayasoorya's zone); proposed to him rather than changed here, since the web app never uses the camera and the header's effect on the file picker was not verified on a device.

**Database.** None.

**Config and dependencies.** `mobile/app.config.js` only. No new packages.

**Money impact.** None.

**Tested.**
- `npm test` in `mobile/`: 68 of 68 pass (64 when first written, plus 4 from the review: the generated iOS Info.plist is read for development, preview and production, and has only the camera reason and no Face ID text in all three; the earlier 5 were: iOS has a camera reason and Android requests no permission itself, with the unused ones blocked, in every environment; Face ID text is off; the development-only entries plugin is present in preview and production and absent in development; the WebView denies page media capture on iOS; and the Android camera and microphone permissions are never declared).
- `expo prebuild` on both platforms, for development and production (generated, then deleted): iOS has `NSCameraUsageDescription` as its only usage text (the generated plist is now checked by tests, in all three environments; the local-network entries are in development only); Android has `INTERNET` and `VIBRATE`, with the three unused permissions marked for removal (rechecked after the camera permission was removed).
- **Not tested:** the pickers on a phone. That the iOS and Android pickers offer the camera, that a photo or an Excel file reaches the existing upload, and that blocking the Android storage permissions does not break the chooser on older Android versions (the library should use app-private storage and the system's access grants, but this was not run). If the Android chooser misbehaves on Android 12 or older, remove `READ_EXTERNAL_STORAGE` from the blocked list first. The Gradle manifest merge was not run, so the final merged manifest is unconfirmed.

**Risks and follow-ups.** Apple and Google ask for the reason behind every permission: the camera reason is the text above; Data safety and privacy answers belong to the store checklist (a later pull request). A share sheet, a bridge-based picker, or both, are reasonable later only if a real need appears (an export, or the pickers failing on a device).
