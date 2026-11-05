# NASA Insights connector: connection milestone

- Date: 2026-11-06
- Author: Jasil (with Claude)
- Issue / PR: #220
- Branch: `feat/insights-mcp-connection`
- Type and scope: feat(analytics), backend only

First milestone of the private, read-only MCP connector that lets the owner ask Claude about NASA Logistics. Design:
`docs/INSIGHTS_MCP.md`. Setup and operations: `docs/INSIGHTS_MCP_SETUP.md`.

- Add a feature-flagged `/mcp` endpoint (stateless Streamable HTTP) mounted in the existing Express app. Off unless
  `MCP_ENABLED=true`; a missing or invalid setting turns only the connector off and is logged.
- Add an OAuth authorization server for it (MCP SDK 1.32.2): discovery documents, Dynamic Client Registration limited to Claude's
  exact redirect URL, PKCE (S256), a NASA sign-in and consent page, rotating refresh tokens, revocation. Scope `nasa:insights:read`.
- Only an active NASA super admin can connect. The account is re-checked on every call, so deactivating, demoting or deleting it
  ends access at once. Connector tokens are random, stored only as hashes, and are not NASA login tokens.
- Add one tool, `get_metric_definitions`, read-only, with strict input and a full result envelope. The definitions live in
  `Backend/services/reporting/metricDefinitions.js`, to be shared with the Insights page.
- Add migration `2026-11-06-issue-220-mcp-oauth` (four new `mcp_oauth_*` tables, additive) and its rollback.
- Add `scripts/mcpGrants.js` to list and revoke connections.
- Export `legacyCredentialClean` from `middlewares/sanitize.js` so the sign-in page cleans passwords exactly as the admin login
  does. No behaviour change.

Database: new tables only; no existing table changes. Config: new optional `MCP_*` settings (placeholders in `.env.example`).
Dependencies: `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7, both pinned. Money calculations: unchanged. No business data is
read or written by this change.

Validation: 21 new tests (6 without a database, 15 steps end to end against a disposable PostgreSQL copy with made-up accounts):
missing, expired, revoked and wrong-scope tokens, wrong resource, non-super-admin and inactive accounts, PKCE, code replay,
refresh rotation and reuse, origin and host checks, business tables unchanged. The full backend suite passes (155 passed, 54
skipped for lack of a database, 0 failed). A run with the official MCP SDK client completed the whole flow, and the real
`app.js` was started with the connector off, misconfigured and on. **Not done:** a test with a real Claude account on an HTTPS
staging address (pending; see the setup guide).
