# Build on Vercel only for main and develop (issue #3)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #3 / see the pull request for this branch
- **Branch:** `chore/vercel-build-main-develop-only` (from `develop`)
- **Type and scope:** chore(config), deployment configuration
- **Files touched:** `Frontend/vercel.json`. No code, no reserved files.

**What and why.** Every pull request branch started its own Vercel preview build. With many stacked pull requests the Vercel plan's build limit was reached ("Deployment rate limited, retry in 24 hours"), so every new pull request showed a failed Vercel check. The owner asked for Vercel to build only `main` and `develop` (so the `develop` to `main` pull request still gets its preview). `vercel.json` now has an `ignoreCommand`: for any other branch it exits 0 and Vercel skips the build; for `main` and `develop` it exits 1 and the build runs as before. The rewrite rule is unchanged.

**Effect on production.** Production builds come from `main`, which always builds. This change reaches `main` only with the next release pull request from `develop`. Until then the Vercel dashboard setting is unchanged.

**Database.** None. **Dependencies.** None. **Money impact.** None.

**Tested.** `vercel.json` parses. The command was run locally with `VERCEL_GIT_COMMIT_REF` set to `main`, `develop` (both exit 1, build), and `feat/mobile-web-session`, `fix/something`, `style/ui-x` and an empty value (all exit 0, skip). Not tested: a real Vercel run. After merging, a pull request from a feature branch should show Vercel as skipped or canceled, and the first push to `develop` should still build.

**Risks and follow-ups.** Low. Feature branches no longer get a Vercel preview link, so reviewers run the branch locally or look at it on `develop`. If one preview is needed, change the command in a pull request or use the Vercel dashboard. The build limit itself is a plan limit and is not changed here.
