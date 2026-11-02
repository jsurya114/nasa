# Compress API responses with gzip (follow-up to #109)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #109 (latency) / see the pull request for this branch
- **Branch:** `perf/api-gzip-compression` (from `develop`)
- **Type and scope:** perf(backend)
- **Files touched:** `Backend/app.js`, `Backend/package.json`, `Backend/package-lock.json`. No reserved files.

**What and why.** API responses were sent uncompressed. The `compression` middleware now gzips responses over 1 KB when the browser asks for it (`Accept-Encoding`). It skips types that are already compressed, such as `.xlsx` downloads. Smaller responses mean faster loads on slow phone connections. Response bodies, status codes and URLs are unchanged.

**Database.** None.

**Config and dependencies.** Adds `compression` `^1.8.2` (the maintained Express middleware; 1.8.1 has a known memory-leak advisory, fixed in 1.8.2, so the patched version is pinned as the minimum). `npm audit --omit=dev` count is unchanged from before (11, all existing). No new environment variables. Rollback: remove the two lines in `app.js` and the dependency.

**Money impact.** None.

**Tested.** Local backend, admin sign-in, `GET /admin/routes?page=1&limit=100`: 21,366 bytes without gzip, 1,646 bytes with `Accept-Encoding: gzip` (`Content-Encoding: gzip`). Not tested: Excel downloads and uploads through the compression layer, and production behind its proxy. The reviewer should download one Excel export and run one upload before release.

**Risks and follow-ups.** Low. Brotli for the frontend is already done by Vercel. If a reverse proxy in front of the API already compresses, this is harmless (it skips responses already encoded).
