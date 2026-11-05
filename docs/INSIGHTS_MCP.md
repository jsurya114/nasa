# NASA Insights: private read-only connector for Claude

| Field | Value |
|---|---|
| Issue | #220 |
| Status | Design. No code in this document's pull request. |
| Owner | Jasil M |
| Related | The Insights page (Jayasoorya). Both read from the same reporting services. |

NASA Insights lets the owner ask questions about NASA Logistics from their own paid Claude account ("Compare revenue and gross margin by city last month"). Claude calls a private, read-only MCP server that runs inside the existing NASA backend. NASA builds no chat screen and calls no AI service.

## 1. Architecture

```text
Claude (claude.ai / Desktop / mobile)
   │  HTTPS, Authorization: Bearer <NASA Insights token>
   ▼
NASA backend (existing Express app, same domain and deployment)
   ├─ OAuth endpoints   /authorize /token /register /revoke /.well-known/*
   ├─ MCP endpoint      POST /mcp   (stateless Streamable HTTP, JSON replies)
   │      tools → shared reporting services (no MCP types inside)
   ▼
Restricted PostgreSQL reporting connection (separate role, SELECT on reporting views only)
```

Rules that shape everything below:

- **One server.** `/mcp` and the OAuth routes are mounted in `Backend/app.js`. No second listening process.
- **Reporting is independent of MCP.** Queries and metric definitions live in `Backend/services/reporting/`. The Insights page and the MCP tools both call them, so the two always show the same totals. MCP files only translate arguments and results.
- **Two database roles, two jobs.** The normal application pool stores connector sign-in records (`mcp_oauth_*` tables). A separate restricted role reads business data. The reporting role cannot see the sign-in tables and the sign-in code cannot read business data except through the account lookup it needs (`admin` table, to check the owner is still an active super admin).
- **Fails closed.** The connector is off unless `MCP_ENABLED=true` and the configuration is valid. A missing or bad setting disables only the connector, logs the reason, and leaves every NASA workflow running.
- **Read-only twice.** Tools are annotated read-only, but the real limit is the database role (SELECT only, read-only transactions, statement timeout). There is no SQL, shell, file or generic API tool, and no payment, payroll-edit, worker or Everee tool.

## 2. Protocol and SDK decisions (verified 6 Nov 2026)

| Item | Decision | Reason |
|---|---|---|
| SDK | `@modelcontextprotocol/sdk` 1.32.2, pinned | Current stable line. Ships the MCP authorization-server building blocks (`mcpAuthRouter`, `OAuthServerProvider`, `requireBearerAuth`) on Express 5, which NASA already runs. Node 18 or newer. |
| Protocol revision | 2025-11-25 (SDK also accepts 2025-06-18 and 2025-03-26) | These are the authorization specifications Claude's documentation says its client follows. The newer 2026-07-28 revision (SDK packages `@modelcontextprotocol/server` 2.x) is not listed in Claude's connector documentation, so it is not used yet. Moving to it later is a contained change inside `Backend/services/mcp/`. |
| Transport | Streamable HTTP, stateless: no session id, JSON replies (`enableJsonResponse`), `GET` and `DELETE` answer 405 | Each request is independent, so any instance can serve it and nothing is kept in memory per caller. |
| Authentication | OAuth 2.1 authorization code with PKCE (S256), opaque tokens | Claude's default custom-connector method. Claude's request-header authentication is beta and limited, so nothing depends on it. |
| Client identity | Dynamic Client Registration, restricted to Claude's exact redirect URL, public clients only. Client ID Metadata Documents are not offered in the first milestone. | DCR is documented and works for every Claude surface. CIMD would need Claude's exact `client_id` URL, which is confirmed on staging and added in a later pull request only if it is wanted. |
| Redirect URL | `https://claude.ai/api/mcp/auth_callback`, exact match | From Claude's authentication documentation. Claude Code's loopback redirect is off unless explicitly enabled. |

Claude's limits we design within: tool results about 150,000 characters, 240 seconds per tool call, OAuth discovery, registration and token endpoints must answer within 10 seconds (refresh 30), connections are IPv4 and the host must resolve to a public address, and requests come from Anthropic's published range (`160.79.104.0/21` at the time of writing).

## 3. Authentication and authorization

```text
1. Claude calls POST /mcp with no token            → 401 + WWW-Authenticate (resource_metadata=…)
2. Claude reads /.well-known/oauth-protected-resource/mcp, then the authorization-server metadata
3. Claude registers (DCR), opens /authorize in the owner's browser (PKCE, resource=<MCP URL>)
4. NASA shows its own sign-in and consent page
      owner enters NASA super-admin email and password → account must be an active super admin
      page names the app, the redirect host, and the single scope "nasa:insights:read"
5. Owner clicks Allow → one-time code → Claude exchanges it at /token (PKCE verified)
6. Claude calls /mcp with the access token; refresh tokens rotate on every use
```

- **Identity.** The owner proves identity with the existing NASA admin credentials (same password check, same login rate limits). Only `role = 'superadmin'` and `is_active = true` rows of the `admin` table qualify.
- **Scope.** `nasa:insights:read`. A token without it is refused with 403 `insufficient_scope`.
- **Separate credentials.** Connector tokens are random 256-bit opaque values stored only as SHA-256 hashes in their own tables. They are not NASA login JWTs, are not accepted by any NASA route, and no NASA token is accepted by `/mcp`.
- **Checks on every request** (a tool call is a request, so this covers every tool execution): token exists and is the access kind, not expired, its grant is not revoked, `resource` equals the canonical MCP URL, the scope is present, and the linked admin still exists, is active and is still a super admin. Removing or demoting the owner takes effect on the next call.
- **Lifetimes.** Authorization code 5 minutes, one use. Access token 1 hour. Refresh token 30 days, rotated on each use; reuse of an old refresh token revokes the whole grant.
- **Revocation.** The OAuth revoke endpoint, a script for operators, and plain SQL (see the operations guide). Disabling the feature flag stops all access at once.
- **No credentials in URLs or logs.** Codes and tokens travel in bodies and headers only. The logger redacts token fields. Log lines carry request id, tool name, duration and outcome.

## 4. Hosting

- Mounted before NASA's global JSON parser, sanitizer and rate limiter, so MCP messages are never rewritten. The MCP routes have their own body limit (256 KB) and rate limits.
- `Origin` is validated: a request with an `Origin` that is not on the allow-list is refused with 403. Claude's server-side calls normally carry none. `Host` must match the configured public host.
- `TRUST_PROXY` must describe the real proxy count so rate limits see client addresses.
- The reverse proxy must forward `/mcp`, `/authorize`, `/token`, `/register`, `/revoke` and `/.well-known/oauth-*`, must not redirect to another host (Claude drops the Authorization header on a cross-host redirect), and must not block Anthropic's range.
- Reporting load stays away from payroll: small separate pool, statement timeout, row and size caps, per-owner rate limits, cancellation releases connections.

## 5. Tools

| Tool | Purpose | Milestone |
|---|---|---|
| `get_metric_definitions` | Revenue, margin, deliveries, claims, limitations, connector information | 1 |
| `list_reporting_cities` | Cities the owner can report on | 3 |
| `get_business_summary` | Revenue, completed deliveries, gross margin and %, active drivers | 3 |
| `get_delivery_trends` | Day, week or month trend, peak weekdays | 3 |
| `rank_cities` | Rank by deliveries, revenue or gross margin | 3 |
| `rank_drivers` | Top 10 by completed deliveries with city and active days | 3 |
| `get_claim_exposure` | Chargeable, exempt and unmatched claims | 3 |
| `get_payment_overview` | Approved pay awaiting payment, processing, returned or failed | 3 |
| `forecast_deliveries` | Estimate with method, error and intervals, or `insufficient_data` | 4 |

Every result states its scope (dates, cities), units, currency (USD), generation time, source coverage and warnings. Money is returned as exact decimal strings (for example `"12345.67"`). Current balances and payment backlogs are labelled "as of" and never mixed with delivery-period activity. Unsupported arguments are rejected, not guessed.

## 6. Metric definitions

These are the rules the tools and the Insights page must follow. They preserve what the client has approved; nothing here changes how pay is calculated.

| Metric | Definition | Notes |
|---|---|---|
| Completed deliveries | The stored `delivered` count on eligible rows (daily and weekly sources, same inclusion rules as the existing reports). | One database row is an aggregate, not one order. No "unique orders" claim. |
| Gross driver earnings | Stored `driver_payment` on the same rows. | |
| Company margin | Stored `company_earnings`: the company price minus the driver price, per delivery, at the time the row was calculated. | **Not total revenue.** |
| Earned delivery revenue | Gross driver earnings + company margin, same rows. | Revenue earned, not cash received from the carrier. Daily and weekly sources are each verified before being summed together. |
| Gross margin | Company margin. Label: "Gross profit before overheads". | Not net profit: no overheads or operating costs are recorded. |
| Margin % | Company margin ÷ earned revenue. | `N/A` when revenue is zero. |
| Active drivers | Distinct drivers with at least one delivery in the period. | |
| Deliveries per active day | Deliveries ÷ distinct driver-days with deliveries. | |
| Claims | Chargeable, exempt (including the DFWGOFO + Tracking interruption exemption) and unmatched, counted and valued separately. | Unmatched claims are never silently assigned or deducted. Carrier claims sit under penalty balances as already approved. |
| Payment overview | Approved pay awaiting payment, processing or unconfirmed, returned or failed, from the frozen pay-run and Everee status records. | Current (as-of) figures. |

Never done: recalculating history from today's route rates, counting advances, insurance withholding or debt recovery as revenue, a delivery success rate without a reliable denominator, treating missing data as zero.

Historical city attribution follows the route stored on each row, so a driver who moves city does not move old deliveries. Each fact source (deliveries, claims, ledger, statements, payments) is aggregated on its own before results are combined, so joins cannot multiply totals.

## 7. Forecasting (later milestone)

A separate `forecast_deliveries` tool, after historical totals reconcile with the Insights page. Seasonal baseline and weekday averages first, backtested on past periods without using future data, incomplete imports distinguished from real zero days, prediction intervals only when justified, `insufficient_data` when history cannot support a useful answer, always labelled an estimate. No other AI model and no AI API key. Revenue forecasts wait until delivery forecasts are validated.

## 8. Rollout plan

1. This design (docs).
2. Connection milestone: flag, OAuth, `/mcp`, `get_metric_definitions`; proved with a real Claude account on an HTTPS staging endpoint.
3. Restricted reporting role and views, shared reporting services, historical tools, reconciled with the Insights page.
4. Forecast tool.
5. Client setup guide and operations guide.

Each step is its own pull request into `develop`. Nothing is deployed to production and `main` is untouched under issue #220. Rollback for every step is turning `MCP_ENABLED` off and, if needed, running the step's rollback SQL.

## 9. Coordination with the Insights page

The Insights page and this connector share one reporting layer. Agreement proposed to Jayasoorya:

- Reporting services live in `Backend/services/reporting/` and are plain functions: `(database, filters) → result`, no Express or MCP types.
- Metric definitions live in one file, `Backend/services/reporting/metricDefinitions.js`. This design adds that file (data only). The page and the tools read from it.
- The Insights API routes call the same functions as the MCP tools. If a query is missing, it is added there, not duplicated.
- Until those services land, the connector ships only `get_metric_definitions`, which needs no business data.
