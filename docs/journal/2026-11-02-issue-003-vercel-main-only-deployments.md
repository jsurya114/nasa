# Vercel: deploy only from main, by stopping the deployment (issue #3, supersedes the earlier entry)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #3 / review on PR #128
- **Branch:** `chore/vercel-build-main-develop-only`
- **Type and scope:** chore(config), deployment configuration
- **Files touched:** `Frontend/vercel.json`. No code, no reserved files.

**What changed after review.** Jasil's review found that the first version (an `ignoreCommand`) cancels the *build* after Vercel has already created the *deployment*. The failure we saw is the daily deployment limit (`api-deployments-free-per-day`, 100 deployments), not build minutes, and Vercel counts builds cancelled through Ignored Build Step toward its deployment and concurrent-build limits. So that version would not have saved any quota. The owner also clarified that Vercel must deploy **only from `main`**, not `develop`.

`Frontend/vercel.json` now uses Vercel's deployment-level branch control and no `ignoreCommand`:

```json
"git": { "deploymentEnabled": { "**": false, "main": true } }
```

Vercel's Git configuration documents that branch keys use minimatch syntax, that unspecified branches default to enabled (so the catch-all `**` is needed), and that a branch matching several rules deploys if at least one is `true` (so `main` wins over `**`). The rewrite rule is unchanged.

**How it reaches branches.** Vercel reads `vercel.json` from the commit being pushed. After this is merged into `develop`, `develop` stops deploying and every branch created from it inherits the rule. A feature branch that was created earlier keeps deploying until it contains this file (merge `develop` into it). Production is not affected until this reaches `main` with a release pull request; `main` stays enabled.

**What it does not do.** It does not clear today's failed Vercel checks and does not reset the daily deployment count: those fail because the limit was already used and reset on Vercel's own schedule. GitHub's own checks (commit messages, frontend lint and build, backend, mobile) are not affected and keep running on every pull request. Preview links for branches no longer exist, so reviewers run a branch locally.

**Database.** None. **Dependencies.** None. **Money impact.** None.

**Tested.** `vercel.json` parses, and the rewrites are identical to before. The branch rules were run through the real `minimatch` library with Vercel's documented rule (deploy if any matching rule is true, unmatched deploys): only `main` deploys; `develop`, `dev`, `Main`, `MAIN`, `feat/mobile-web-session`, `fix/driver-route-access`, `style/ui-add-delivery-form`, `docs/a/b/c`, `release/1.0`, `main/foo`, `origin/main` and `refs/heads/main` do not. Not tested: a live Vercel run, so the saving in deployment count is unverified until after merge (a push to a feature branch should create no deployment, and a push to `main` should).

**Risks and follow-ups.** Low. If a preview of one branch is needed, add a temporary `true` rule for it in a pull request or use the Vercel dashboard. Dashboard Git settings are not changed here.
