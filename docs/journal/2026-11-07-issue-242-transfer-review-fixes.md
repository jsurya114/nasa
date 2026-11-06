# Driver transfer history review fixes

- Date: 7 November 2026
- Author: Jasil with Codex
- PR: #246; issue #242

Scope the signed-in driver's transfer history to the configured environment so
sandbox deposits never appear as production payments. Preserve exact decimal
strings, individual statuses, history access and the approved statement link.
Compute the latest check chronologically for PostgreSQL Date values. Label the
record creation date as Recorded, including failed attempts, rather than Sent.

Show a retryable error when the native history/bank window reports failure.
Keep the authenticated self-only routes, no-store responses and separate,
restricted provider window. No provider payment or financial totals change.

Validation includes environment isolation with real database fixtures, transfer
privacy/status/decimal cases, timestamp ordering, native failures and the full
integrated setup/Pay page checks. No production enablement or real payment.
Physical phone and provider PDF testing remain staged acceptance work.
