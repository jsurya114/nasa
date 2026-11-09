# UI refresh, part 3: driver journey and delivery screens (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/driver-journey-delivery` (built on `style/driver-header-nav`; merge the two earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/components/Drivers/Journey.jsx`, `Frontend/src/components/Drivers/Delivery.jsx`. No reserved files.

**What and why.** Appearance only, for the two main driver screens, with a phone in mind.
- **Brand colours.** Main buttons, the selected "view" button and the focus rings were bright blue; they now use the shared purple, like the login and the header. The loading spinner on the journey screen too. Data colours inside the tables, the info and error boxes and the weekly (purple) button keep their meaning and are unchanged.
- **Phone spacing.** Page and card padding is smaller on phones (`px-4`) and stays the same from the `sm` size up. Table cells on the journey records are tighter on phones, so less side-scrolling.
- **Easier tapping and typing.** Inputs, selects and the main buttons are taller, and the input text is 16px so iPhones no longer zoom in when a field is tapped. The row of view buttons on the delivery screen wraps instead of overflowing on a narrow phone.
- **Labels.** The four journey form fields now have `id`s with matching `htmlFor` on their labels, so tapping a label focuses its field and screen readers read them properly.

**Not changed on purpose.** Handlers, validation, Redux calls, API calls, dates, calculations, texts and the tooltip logic. One known limit stays: the route price tooltip on the delivery table opens on mouse hover, so it does not open by touch on a phone. Fixing that changes behaviour, so it is a separate task.

**Database.** None. **Config and dependencies.** None. **Money impact.** None: no pay, price or total is calculated or shown differently.

**Tested.** `npx eslint` on both files: no findings. `npm run build` succeeds. The diff was read: every change is a CSS class or an added `id`/`htmlFor`. Not tested: the screens in a browser with a driver sign-in. The reviewer should check at phone and desktop width: save a journey, filter deliveries, switch the view buttons, and confirm the numbers are the same as before.

**Risks and follow-ups.** Low. Next parts: driver availability and password screens, then the driver access-code and agreement screens.
