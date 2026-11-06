# Driver setup screen review fixes

- Date: 7 November 2026
- Author: Jasil with Codex
- PR: #245; issue #242

Integrate the author's final session-registration correction: registration is
attached to its session, so a late effect cannot reset a completed handshake.
Retain the dedicated widget tests for registration, timeout, expiry and events.
An independent controlled-clock regression also rejected the original widget.
The previous mixed network/fake-clock test and diagnostic output are removed.

Show a clear, retryable error when the native window reports failure rather
than treating that outcome as normal completion. Integrate the approved #244
gate while preserving Spanish refusals and the complete driver flow.

Validation: setup/widget tests and the complete frontend suite, build, mobile
bridge tests and integrated browser checks are recorded on the PR. No actual
provider/payment or production switch is used. Physical-device acceptance is
still required before activating enforcement.
