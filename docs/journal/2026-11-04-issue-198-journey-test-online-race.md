# Flaky Journey test: the online event could arrive before the listener (issue #198)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #198 / see the pull request for this branch
- **Branch:** `fix/journey-test-online-race` (from `develop`)
- **Type and scope:** test(frontend), tests only
- **Files touched:** `Frontend/src/components/Drivers/Journey.test.jsx`; this entry. No application code, no reserved files.

**What failed.** CI's Frontend job failed on an unrelated backend-only pull request (#197) with `Unable to find role="button" and name "Route Already Saved"` in "a reload with the connection back later settles by itself when it returns". It had also failed once on a local run and passed alone.

**Cause (a race in the test, not in the app).** After a reload the page shows "Check again" once its automatic check has failed. It then starts listening for the browser's `online` event in an effect that runs just after that render. The test fired `online` once, right after "Check again" appeared; on a slow machine the event can arrive before the listener exists, so nothing happens and the page never re-checks. Two tests had the same pattern.

**Fix.** The test sends `online` again until the page has reacted (`connectionReturns`, a `waitFor` that dispatches the event and expects the saved state). The app is unchanged: a real "connection is back" event always comes long after the page has settled.

**Checked.** With the hook made to attach its listener 200 ms late (a temporary change, reverted), the old versions of both tests fail and the new versions pass. The Journey file passes (18 tests) and so does the whole frontend suite.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None.
- **Not tested.** Several parallel runs of the whole file only overloaded the machine (everything timed out), so the CI failure itself was not reproduced; the late-listener check above shows the mechanism.
