# Guard the form Cancel while a save runs (issue #234)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #234 / PR #235 (review by Jasil: P1)
- **Branch:** `feat/add-forms-in-modals`
- **Type and scope:** fix(ui), frontend only
- **Files touched:** `Frontend/src/components/Admin/AddUsers.jsx`, `Frontend/src/reuse/AddDriverForm.jsx`, `Frontend/src/reuse/AddAdminForm.jsx`, `Frontend/src/components/Admin/AddUsers.modal.test.jsx`. None are reserved files.

**Why.** The dialog's X, Escape and backdrop were already blocked while a save ran, but the Cancel button inside the Add Driver and Add Admin forms was not. Pressing it closed the dialog while the request was still out, so the typed values were lost if the save then failed, and an old response could close a dialog opened afterwards.

**What changed.** The form Cancel buttons are disabled while the save runs, and the close handlers they call do nothing while `saving` is true. A successful save still closes the dialog through its own path. Cancel works again once a failed save returns.

- **Also in this push:** the branch was rebased onto `develop` after #233 was squash-merged, dropping the old copy of #233's commit, which removed the conflict in `AddDriverForm.jsx` and its test. The modal behaviour (values survive a failed save) is kept.
- **Database, config, dependencies, money impact:** None.

**Tested.** Two new tests (Driver and Admin) press Cancel during a delayed save: the dialog stays, the values stay, and the save then completes and closes (or fails and Cancel works again). Both fail on the old code and pass now. Modal, form and driver tests pass (54); the full frontend suite passed before this change on the rebased branch (369) and is rerun below.

**Not tested.** In a real browser.
