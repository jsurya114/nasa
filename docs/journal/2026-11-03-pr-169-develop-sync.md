# Sync the reviewed ledger edit branch with develop

- Date: 2026-11-03
- Author: Codex, reviewing for Jasil
- PR: #169; issue #166
- Branch: feat/ledger-edit-history
- Scope: mechanical merge from develop after #167 and #168 were reviewed and merged.

The controller, route and ledger-rule conflicts repeat the settlement additions already present on this branch. Keep this branch's versions of those three files, which contain those same settlement additions and the reviewed edit/history additions. Other files merge normally, including the approved balance-category allocation. No business rule, database migration, dependency or configuration is added by this sync.

Validation: compare the three resolutions with the reviewed feature head and the merged settlement implementation; run the full backend suite with both payroll and assignment database flags on the local review copy. Record the exact result in the PR review. Fixtures are synthetic and rolled back. CI must pass on the resulting head before merging. No production changes.
