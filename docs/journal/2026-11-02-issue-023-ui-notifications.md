# UI redesign, stage 3: one notification system and themed confirm dialogs (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-notifications` (built on `style/ui-glass-navigation`; merge stages 1 and 2 first)
- **Type and scope:** style(frontend)
- **Files touched:** new `Frontend/src/utils/toast.js`, `Frontend/src/utils/confirmDialog.js`, `Frontend/src/reuse/AppToaster.jsx`; `Frontend/src/App.jsx`, `Frontend/src/index.css`, `Frontend/src/hooks/translation.js`; the `toast` import line in 18 non-reserved screens and lists; small edits in `Drivers/accessCode.jsx`, `reuse/driver/Header.jsx`, `Drivers/DriverLogin.jsx`, `Drivers/DriverAgreement.jsx`, `Admin/AccessCode.jsx`, `Admin/AdminDriverAvailability.jsx`, `Admin/AdminDriverAgreements.jsx`, and removal of the extra toast containers in `Admin/Jobs.jsx`, `Admin/routes-form.jsx`, `Drivers/Delivery.jsx`. No reserved files.

**What and why.**
- **One container.** Four screens rendered their own toast container next to the app-wide one. In react-toastify 11, containers without an id replace each other, so placement and timing depended on which page had been opened last. Now there is one container (`AppToaster`), used everywhere. Jasil's `DriverPaymentUpdate` still renders its own; that is his file and is listed for him.
- **New look.** White card, coloured left edge and icon per kind (success green, error red, warning amber, info violet), Inter text, soft shadow, thin progress line. A 44px dismiss button with a translated label. On phones the messages sit under the header with side margins, so they never cover the bottom navigation or main buttons. Slide-in motion, cut when "reduce motion" is on.
- **Behaviour (`utils/toast.js`, same calls as before).** The same message is never stacked twice while on screen. At most three show at once; the rest wait. Success 3.5s, info 4.5s, warning 6.5s, error 8s (errors and warnings never shorter, even if a screen asks for less); all pause while hovered or focused. Errors and warnings are announced to screen readers at once (`role="alert"`), others politely (`role="status"`). The container decides the position, so per-screen positions are ignored.
- **Loading that becomes the real result.** `toast.track()` shows a loading message and replaces it with the actual success or failure; success is only shown after the save succeeds, and the error is still passed on to the screen. Used for the driver access-code upload (with photos) and the driver language switch.
- **Driver messages in English and Spanish.** The login success message and the four agreement messages were English-only; they now use the translation helper (new keys: `dismissNotification`, `savingAccessCode`, `agreeTermsRequired`, `agreementNameDateRequired`, `agreementSigned`, `agreementSubmitFailed`).
- **Confirm dialogs.** The two plain browser confirm boxes (reset all availability, revoke agreement) and the delete-access-code dialog now use one themed SweetAlert2 dialog (already a dependency). Same question, same two choices; focus starts on Cancel, Escape cancels, buttons are large enough to tap. The access-code details shown in the delete dialog are still escaped.

**Not changed.** What is saved, when, or what the server receives; which screens show which messages (apart from the translations above); field validation stays next to its field; no Undo was added; no failure is hidden.

**Database.** None. **Dependencies.** None added (react-toastify, sweetalert2 and lucide-react were already installed). **Config.** None. **Money impact.** None.

**Tested.** `npx eslint` on all changed files: no findings. `npm run build` succeeds. In a browser with local synthetic data (375px phone):
- Success, error, warning and info look distinct; a repeated error showed once; with five messages only three showed and the rest waited.
- `toast.track` showed "Saving access code..." and then "Access code created." only after the promise finished.
- Roles: error and warning `alert`, success `status`; dismiss button 44x44 with a label; messages sit below the header with 12px side margins.
- Revoke agreement: the themed dialog opened with focus on Cancel; Escape cancelled and the database still had the same number of signed agreements.

Not tested: a real upload with photos to Cloudinary (no keys locally), Safari/Firefox, a screen reader (roles were checked in the DOM only).

**Known issue found.** The admin Agreements page is wider than a 375px phone (fixed-width search box and table), which also pushes dialogs off-centre on that page. Fixed in the admin screens stage.

**Risks and follow-ups.** Low. Next stages: driver screens, then admin screens.
