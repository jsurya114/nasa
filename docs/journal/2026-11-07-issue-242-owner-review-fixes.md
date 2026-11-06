# Everee onboarding work eligibility review fix

- Date: 7 November 2026
- Author: Jasil with Codex
- PR: #244; issue #242

The work gate must retain every target driver's classification until the work
transaction commits. Lock all requested driver rows before reading their live
Everee mappings and evaluating eligibility. Keep driver-before-mapping order,
the existing per-driver advisory protocol, and the gate-off behavior.

Add an independent-connection regression for classification changes before the
first work mutation. Verify that subsequent work follows the new classification.
Also make the existing payment identity assertion change its fixture value even
when a fresh database's first statement ID is 1.

Validation: 124 onboarding, gate, workers, submit/status, cash-record and work
transaction tests passed with zero skips on an isolated disposable database.
Provider calls were mocked. Pay amounts, deductions and approved history are
unchanged. Production enforcement and deployments remain untouched.
