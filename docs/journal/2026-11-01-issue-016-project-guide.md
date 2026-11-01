# Project documentation (issue #16)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #16 / see the pull request for this branch
- **Branch:** `docs/project-guide`
- **Type and scope:** docs(docs)
- **Files touched:** `docs/PROJECT_GUIDE.md` (new), `Backend/.env.example` (one setting name added). No application code. No reserved files were edited; the Excel and pay sections were written by reading them.

**What and why.** Issue #16 asked for the project documentation as a Slack canvas. Slack refused to create it ("not available on free teams"), so the guide lives in the repository instead, where everyone who works on the code already reads. It covers: what the system is, how to run it, the setting names, hosting and deployment (including the database changes still waiting to run in production), the roles, the database tables, the daily and weekly Excel upload flows, and the pay rules, all written from the code on `develop` as it is today. It holds names only: no values, secrets, real driver data or uploaded files.

`Backend/.env.example` now also lists `TRUST_PROXY` (name and purpose only). The server already refuses to start in production without it (issue #10), but the example file did not mention it.

**Database.** None. **Config and dependencies.** One new setting *name* in the example file; no value, no package.

**Money impact.** None. Nothing in the pay or Excel code was changed; the pay rules were only described.

**Tested.** Documentation only. Every statement about the Excel and pay flow was checked against the code it describes (`fileUploadsController`, `weeklyUploadsController`, `excelFileQueries`, `weeklyExcelQueries`, `dashboardQueries`, `dashboardController`). Setting names were collected from every `process.env` and `import.meta.env` use in the code and match `.env.example`.

**Risks and follow-ups.**
- The backend host line is left for the owner to fill in (provider, branch, number of proxies); it is not recorded anywhere I can read.
- The guide says Vercel's Production Branch must be `main`; that setting could not be checked from here.
- The production triggers that fill the pay table are not in the repository; the guide says so and asks for a copy to be saved.
- `Backend/config/dbquery.txt` is an older snapshot of the schema; the guide says so.
- Jasil owns the Excel and pay sections and updates them when his work changes the code. Findings from reading that code were sent to the owner directly, not written here.
