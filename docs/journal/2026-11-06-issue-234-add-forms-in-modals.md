# Add forms open in a modal dialog (issue #234)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #234 / see the pull request for this branch.
- **Branch:** `feat/add-forms-in-modals` (from `develop`, with the commit of the driver type pull request #233 / issue #232 brought in, see below)
- **Type and scope:** feat(ui), frontend only
- **Files touched:** new `Frontend/src/reuse/Modal.jsx`, `Frontend/src/reuse/Modal.test.jsx`, `Frontend/src/components/Admin/AddUsers.modal.test.jsx`, `Frontend/src/components/Admin/AddForms.modal.test.jsx`; changed `Frontend/src/components/Admin/AddUsers.jsx`, `Jobs.jsx` (Cities), `routes-form.jsx` (Routes), `AccessCode.jsx`, `Frontend/src/reuse/AddDriverForm.jsx`, `Frontend/src/reuse/AddAdminForm.jsx`; this entry. No reserved files. No backend, API or database change.

**Includes the driver type work.** The Add Driver dialog has to show the Local / Desi dropdown, which lives in pull request #233 (issue #232, not merged yet). That one commit is cherry-picked at the start of this branch, so this branch contains it. When #233 is merged into `develop`, rebase this branch onto `develop` and git drops the duplicate commit. The only conflict was in `AddDriverForm.jsx`, resolved by keeping the dropdown and removing the "clear the form after Add" block (see the behaviour change below). The #233 test that expected the form to clear after Add now expects it to keep what was chosen. Two new dialog tests check that the Add Driver dialog has the dropdown, sends the choice and shows it in the table, and that Edit shows the current type.

**Why.** The Add forms sat on their pages as permanent cards and pushed the tables down. The owner asked for each page to show its table and a "+ Add" button, with the existing form opening in a dialog.

**What changed.**
- **One shared dialog, `Modal`:** a title, an X button, Cancel inside the form, closing on Escape or a click on the backdrop. It cannot be closed (X, Escape, backdrop) while a save is running. A long form scrolls inside the dialog, not the page behind it, which is locked while the dialog is open. Focus moves to the first field when it opens, stays inside while Tab is pressed, and returns to the button that opened it. It fits a phone (small margin, nearly full width, `100dvh` height limit).
- **Drivers and Admins** (one page, two tabs): the tab switch, its saved state, the access rule for the Admins tab, the tables, filters, search and pagination are untouched. The Drivers tab has **+ Add Driver**, the Admins tab **+ Add Admin**, each opening only its own dialog with the same form component. Switching tabs closes any open dialog.
- **Cities:** **+ Add City** (super admin only, as the form was). **Routes:** **+ Add Route**. **Access Codes:** **+ Add Access Code**. The existing form fields, validation, requests, toasts and refresh logic are the same code, moved into the dialog. The big "Add New Access Code" heading card is gone with the form.
- **Edit** on a row opens the same dialog, filled in, titled "Edit Driver", "Edit Admin", "Edit City" or "Edit Route". The inline card was the only place Edit worked, so it needed somewhere to go (before, it also scrolled the page to the top; that scroll is removed). The Access Codes page already had its own Edit dialog and is unchanged.
- **After a save:** success closes the dialog, shows the same success message and updates the table the way it did before. Failure keeps the dialog open with everything that was typed, and the same error message as before.
- **Two small changes inside the forms (this is a behaviour change, on purpose):** `AddDriverForm` and `AddAdminForm` used to clear themselves the moment Add was pressed, even when the save then failed. They no longer clear: the dialog closing on success discards the form, and a failed save keeps what was typed (the requirement). They also show a **Cancel** button on Add, not only on Edit, because the dialog needs one.

- **Database:** None. **Config and dependencies:** None (the X icon is from `lucide-react`, already used). **Money impact:** None.

**Tested.**
- `Modal.test.jsx` (6): dialog role and title, first-field focus and page lock, closing by X / Escape / backdrop and focus returning to the opener, no close from a click inside, no close while busy, Tab stays inside, content scrolls inside.
- `AddUsers.modal.test.jsx` (10, real page with a fake server): no inline form and a "+ Add Driver" button; the dialog opens with every field and closes four ways; the validation message and nothing sent for an empty form; a successful add closes it, shows "User Added Successfully!!" and the new driver in the table, and reopens empty; a failed add keeps the dialog with every typed value and shows the error; not dismissable while saving; Edit opens it filled in; tab switching keeps one table and one Add button per tab and the forms never mix; Add Admin succeeds after a failure with the values kept; a non-super admin still cannot open the Admins tab.
- `AddForms.modal.test.jsx` (19): the same checks for Cities (7), Routes (6) and Access Codes (6), including the page's own rules (route needs Enabled ticked; city name and code required; access code and zip validation).
- Whole frontend suite run serially: **335 passed**. Build passes. Lint clean on the changed files.

**Not tested.**
- In a real browser against the running app (the local browser was not signed in and I had no test login): the real look, spacing and the phone layout were not seen. Please open each of the five pages once.
- Safari, Firefox, a screen reader, a real file upload through the Access Code dialog (the form is the same code; the tests send text fields).
- Editing an admin in the dialog (only adding an admin is covered by a test; the edit path is the old code in a new place).

**Risks and follow-ups.**
- `AddDriverForm.jsx` is also changed by the driver type pull request (#233), in nearby lines. Whichever merges second needs a small rebase.
- The pages are now shorter, so the table is the first thing seen. Closing a dialog with a click on the backdrop discards what was typed (the same rule as the Cancel button); say if the backdrop should not close a form that has text in it.
