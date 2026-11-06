# Drivers can no longer add access codes (issue #240)

- **Date:** 2026-11-07
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #240 / see the pull request for this branch.
- **Branch:** `fix/driver-no-access-code-create`
- **Type and scope:** fix(access-codes), backend and frontend
- **Files touched:** changed `Backend/routes/driverRoutes.js`, `Backend/controllers/driver/accessCodeControllers.js`, `Backend/services/driver/accessCodeQueries.js`, `Frontend/src/components/Drivers/accessCode.jsx`, `Frontend/src/redux/slice/driver/driverAccessCodeSlice.js`; new `Backend/tests/driverAccessCodeReadOnly.test.js`, `Frontend/src/components/Drivers/accessCode.test.jsx`. None are reserved files; access codes are Jayasoorya's area (`docs/OWNERSHIP.md`).

**Why.** Access codes are meant to be added by admins only, but a driver could add one from the driver Access codes page, and the server accepted it from a driver token.

**What changed.**
- **Server:** the driver route that created an access code is removed, with its controller function and database query. The driver router now has only the read route (`GET /driver/access-codes/list`). A driver request to create one is no longer handled. The admin routes (add, edit, delete) are unchanged.
- **Driver page:** the "Add new access code" card (form, photo upload, validation and save) is removed, with its state. The search, the list and the details dialog stay. The empty-state hint no longer tells the driver to create a code. The create action is removed from the driver slice.

- **Database:** None. Codes drivers added earlier stay as they are. **Config and dependencies:** None. **Money impact:** None.

**Tested.** A backend test reads the driver and admin route files and the driver controller and queries: no write route, no create function for drivers, admin add/edit/delete still present (fails on the old code, passes now). A screen test renders the driver page: the list shows, there is no form, file input or save button, and no POST is sent (fails on the old code, passes now). The full frontend suite passes (390), the build and lint are clean.

**Not tested.** In a real browser, and a real request from a signed-in driver against the running server.

**Risks and follow-ups.** `notifyAccessCodeSubmitted` in `services/push/pushEvents.js` (the push to admins when a driver submitted a code) is now unused; it has its own tests, so it was left for the team to decide. The driver translation texts for the removed form are unused and were left. Any access code a driver added before this change stays in the table.
