# Login limits: keep login working while Redis reconnects (review fix for PR #48)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #10 / #48 (follow-up to `2026-10-31-issue-010-login-rate-limits.md`)
- **Branch:** `fix/login-rate-limit`
- **Type and scope:** fix(auth)
- **Files touched:** `Backend/middlewares/loginRateLimit.js`. No reserved files.

**What and why.** Jasil's review found that when Redis drops while the server is running, the Redis client keeps the connection open and queues commands instead of failing them. The login limiter waited on those commands forever, so login hung until Redis came back. Before this change login did not depend on Redis, so this was a new outage risk.

The limiter now (1) uses its in-memory counters straight away when the Redis client is not ready, and (2) gives each Redis step at most 500 ms, so a drop between the readiness check and the command also ends in the memory counters. The same guard covers clearing and giving back counters after a good login.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** Throwaway scripts (not committed) with a real local Redis:
- Redis stopped while the client stayed open and reconnecting: login answered in about 1 ms, the first 5 attempts passed and the 6th was blocked from memory.
- Drop between the readiness check and the command (forced): the request answered after about 0.5 s and was not left hanging.
- The earlier full set of limit checks still passes.
Not tested: a real hosting provider's Redis failover.

**Risks and follow-ups.**
- A command that timed out may still run once Redis returns, so a counter can be off by one. The effect is a limit slightly stricter, never looser.
- Each request pays up to 0.5 s extra only in the short gap before Redis reports not ready.
- Memory counters are per server process; with several backend instances the limit is looser while Redis is down.
