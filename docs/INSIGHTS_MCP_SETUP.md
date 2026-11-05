# NASA Insights connector: setup, verification and operations

Issue #220. Design: [INSIGHTS_MCP.md](INSIGHTS_MCP.md). This page covers what exists after the connection milestone: the connector
signs the owner in and offers one tool, `get_metric_definitions`. Business-data tools come in later pull requests.

## Verified configuration (6 Nov 2026)

| Item | Value |
|---|---|
| SDK | `@modelcontextprotocol/sdk` 1.32.2 (pinned), `zod` 4.6.7 |
| Protocol revision served | 2025-11-25 (the SDK also accepts 2025-06-18 and 2025-03-26) |
| Transport | Streamable HTTP, stateless, JSON replies. `GET` and `DELETE` on `/mcp` answer 405. |
| Authentication | OAuth authorization code with PKCE (S256), opaque tokens stored as hashes |
| Client registration | Dynamic Client Registration, only Claude's exact redirect URL; every client is registered as a public client (Claude asks for client_secret_post and is answered with none, no secret) |
| Redirect URL | `https://claude.ai/api/mcp/auth_callback` |
| Scope | `nasa:insights:read` |
| Lifetimes | code 5 min (one use), access token 1 hour, refresh token 30 days (rotates), a connection ends after 180 days |
| Who can connect | A NASA `admin` account with `role = 'superadmin'` and `is_active = true`, checked on every call |

Tested against a disposable database with the official MCP SDK client (full flow: 401, discovery, registration, PKCE, NASA sign-in,
code exchange, `initialize`, `tools/list`, `tools/call`), with 21 automated tests, and with a real Claude account through a public
tunnel (see the verification section: staging and mobile are still pending).

## Turn it on (staging first)

1. Back up the database, then run `Backend/migrations/2026-11-06-issue-220-mcp-oauth.sql` (safe to repeat). Rollback:
   `...mcp-oauth.rollback.sql`.
2. Set in the backend environment (never commit real values):

   ```text
   MCP_ENABLED=true
   MCP_PUBLIC_BASE_URL=https://<the staging backend's public HTTPS address>   # origin only, no path
   TRUST_PROXY=<number of proxies in front of the backend>
   ```

3. Restart the backend. The log must say `NASA Insights connector is on`. If it says `connector is off: <reason>`, fix the setting.
   A wrong setting only turns the connector off; the rest of NASA keeps running.
4. The proxy in front of the backend must:
   - forward `/mcp`, `/authorize`, `/token`, `/register`, `/revoke`, `/mcp-consent` and `/.well-known/oauth-*` to the backend,
   - keep the original `Host` header (or list the public host in `MCP_ALLOWED_HOSTS`),
   - **not redirect to another host** (Claude drops the credential on a cross-host redirect),
   - not block Anthropic's outbound range (`160.79.104.0/21`, see Anthropic's IP address reference) with a firewall or bot rule,
   - resolve to a public IPv4 address (Claude rejects private and IPv6-only addresses).
5. Check from a public network (replace the host):

   ```bash
   curl -i -X POST https://<host>/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   curl -s https://<host>/.well-known/oauth-protected-resource/mcp
   curl -s https://<host>/.well-known/oauth-authorization-server
   ```

   The first must be `401` with a `WWW-Authenticate` header containing `resource_metadata`. The others must be JSON.

## Reporting views

Run in order after a backup: `2026-11-06-issue-220-reporting-views.sql`, then `2026-11-06-issue-220-reporting-claims-payments.sql`
(rollbacks alongside). The second reads the Everee table only if it exists, so it can run before or after the Everee migrations.

## Reporting database role (data tools)

The data tools read through a separate PostgreSQL login that can see only the `reporting` views (`reporting.cities`,
`reporting.delivery_facts`). The views hold business totals and driver display names; they hold no password, email, phone, bank, tax,
access code or sign-in record. Without the login below, the connector still works but offers only `get_metric_definitions`; it never
falls back to the application's database login.

1. As the database owner or a superuser, after a backup, run `Backend/migrations/2026-11-06-issue-220-reporting-views.sql`
   (safe to repeat). Rollback: `...reporting-views.rollback.sql` (drop the login role first).
2. Create the login (choose a long random password and keep it only in the server's environment):

   ```sql
   CREATE ROLE nasa_insights_ro LOGIN PASSWORD '<long random password>' CONNECTION LIMIT 8 IN ROLE nasa_reporting_reader;
   ALTER ROLE nasa_insights_ro SET default_transaction_read_only = on;
   ALTER ROLE nasa_insights_ro SET statement_timeout = '10s';
   ALTER ROLE nasa_insights_ro SET idle_in_transaction_session_timeout = '15s';
   ```

   On PostgreSQL 14 or older, everyone may create tables in the `public` schema by default. The connector's read-only transaction and
   read-only login setting already stop that, but also run `REVOKE CREATE ON SCHEMA public FROM PUBLIC;` if your application login owns
   the schema (it keeps its rights). PostgreSQL 15 and newer already refuse it.
3. Set `REPORTING_DB_HOST`, `REPORTING_DB_NAME`, `REPORTING_DB_USER=nasa_insights_ro`, `REPORTING_DB_PASSWORD` (and `REPORTING_DB_SSL=true`
   if the database requires TLS: the server certificate is then verified; add `REPORTING_DB_SSL_CA` with the database's CA certificate if it is
   not publicly trusted), then restart. The log must not say `data tools are off`.
4. Check as that login (for example with `psql`): `SELECT count(*) FROM reporting.delivery_facts;` works, and `SELECT 1 FROM drivers;`,
   `SELECT 1 FROM admin;` and any `INSERT`, `UPDATE` or `DELETE` are refused.
5. Rotate the password with `ALTER ROLE nasa_insights_ro PASSWORD '...'` and a restart. To switch the data tools off, remove
   `REPORTING_DB_PASSWORD` and restart (or `REVOKE nasa_reporting_reader FROM nasa_insights_ro`).

Limits: a pool of at most 3 connections (setting `REPORTING_DB_POOL_MAX`, up to 5), every report in a READ ONLY transaction with a
10 second time limit, a result size cap, 60 calls a minute per connection, and a cancelled request cancels its query. Reports never
write, so they cannot change pay, claims, deductions or payments.

## What the numbers count

- **Source:** the Dashboard's delivery records (`payment_dashboard`), the same rows its totals read, for daily and weekly cities.
  Weekly imports and daily journeys both end up there.
- **City:** the city of the record's route, as stored. A driver who changes city does not move old deliveries.
- **City rule:** as on the Dashboard when a city is selected, a daily city counts records with sequence numbers and a weekly city
  counts records without. Records that break the rule are left out and disclosed in the warnings.
- **Deliveries:** the stored delivered counts. A record is an aggregate, not an order.
- **Revenue:** stored gross driver earnings + stored company margin from the same records. Records with no stored amounts yet (still
  open) or only one amount are counted in deliveries, left out of revenue and margin, and disclosed. Missing is never zero.
- **Gross margin:** stored company margin, "gross profit before overheads". Margin percentage is margin / revenue, empty when
  revenue is zero.
- **Checked against the Dashboard:** for every city and two sample periods the tools' deliveries, driver earnings, margin and revenue
  equal the Dashboard's own summary query (`getSummaryData`) exactly (an automated test).
- **Claims:** the latest version of each carrier claim, by decision: chargeable, exempt, or unmatched (unresolved, ambiguous or
  review; a claim with no decision record counts as unmatched). "Deducted in approved pay runs" is what active claim lines in approved
  runs took, before any later refund; it is not a driver balance.
- **Payments:** pay statements of draft and approved runs (discarded and voided runs are not payments). Approved is not paid; a
  returned deposit is not counted as paid. These are as-of figures, separate from delivery periods.
- **Forecast:** recent weekday pattern, chosen by backtesting on the last 8 weeks without future data; partly imported weeks are left
  out; an estimate, not a promise; no revenue forecast.
- **Known gaps:** driver advances, debts and penalty balances (Payroll is the authority), route-level margin and a delivery success
  rate (no reliable denominator). NASA has no overheads, so there is no net profit.

## Tools

| Tool | What it answers |
|---|---|
| `get_metric_definitions` | What the metrics mean and their limits |
| `list_reporting_cities` | Cities, ids, type, first and last delivery date |
| `get_business_summary` | A period: deliveries, revenue, margin, margin %, active drivers, per-delivery figures; optional city filter and comparison with the previous equal-length period |
| `get_delivery_trends` | Deliveries, revenue and margin by day, week or month, the busiest weekdays and the five peak dates |
| `rank_cities` | Cities ranked by deliveries, revenue or gross margin, with share of total |
| `rank_drivers` | Top drivers by deliveries or deliveries per active day, with main city, active days and share (names and cities only) |
| `get_claim_exposure` | Carrier claims: chargeable, exempt and unmatched, counts and amounts, oldest unmatched claim |
| `get_payment_overview` | Driver pay now: pending approval, approved awaiting payment, processing, unconfirmed, failed, returned, paid, and what needs attention |
| `forecast_deliveries` | An estimate of the next 1 to 28 days, with method, backtest error and a range, or `insufficient_data` |

Periods are `YYYY-MM-DD` business dates, inclusive, at most 1,096 days. Unknown cities, bad dates, unsupported arguments and
unsupported ranking metrics are refused with a message, never guessed.

## Connect Claude (client guide, draft)

1. Open Claude, then **Customize > Connectors > Add custom connector**.
2. Name: `NASA Insights`. URL: `https://<host>/mcp`. If Claude asks how to identify itself, choose **Register automatically**.
3. Click **Connect**. A NASA page opens. Sign in with the NASA super-admin email and password and click **Allow read-only access**.
4. In a conversation, click **+ > Connectors** and switch **NASA Insights** on.
5. Ask: "What do the NASA metrics mean?" Claude should call `get_metric_definitions` (the first time it asks your permission).

## Verification with a real Claude account

Status: **works on a local test server behind a public tunnel (6 Nov 2026, claude.ai in a desktop browser). Not yet done on an HTTPS
staging deployment, and not yet from the mobile app.** The tunnel run used a Cloudflare quick tunnel to a small test server that serves
only the connector, with a scratch database and a test super-admin account.

| Check | Result |
|---|---|
| Connector added by URL ("Sign in now" + "Register automatically"), registration succeeds | passed (after a fix, see below) |
| NASA sign-in page opens; a wrong password is refused; the super-admin account is accepted and redirects to Claude | passed |
| Claude shows the tool (title "NASA metric definitions") and `get_metric_definitions` returns the definitions | passed |
| Claude reads the definitions correctly (margin is gross profit before overheads, revenue is not cash) | passed |
| A city admin or driver account is refused on the real sign-in page | covered by automated tests only |
| Token refresh after one hour | pending |
| Disconnect in Claude, then the next call needs sign-in again | pending |
| The same flow on the mobile app | pending |
| The same flow on an HTTPS staging deployment (real proxy, real domain) | pending |

What Claude actually did (from the server log), for the record:

- `POST /mcp` without a token, `GET /.well-known/oauth-protected-resource/mcp`, then `POST /register` from `python-httpx`.
- The registration asked for `token_endpoint_auth_method: "client_secret_post"` (with `application_type: "web"`, scope
  `nasa:insights:read`, redirect `https://claude.ai/api/mcp/auth_callback`). The first version refused this, which Claude showed as
  "Couldn't register". The server now registers every client as a public client protected by PKCE and answers with `none` and no secret.
- Claude then opened `/authorize` in the browser, exchanged the code at `/token`, and called `/mcp` with user agent `Claude-User`.
- Each MCP session starts with a `server/discover` probe for the newer protocol era. The server answers 400, Claude falls back to
  `initialize` (protocol 2025-11-25), `notifications/initialized` and `tools/list`, as the transport specification describes. Nothing to fix.
- Claude did not use Client ID Metadata Documents, since the server does not advertise them.

If Claude shows "Couldn't reach the MCP server" or "Authorization failed", follow Anthropic's troubleshooting page and keep the `ofid_`
reference from the error. Quick-tunnel addresses change on every restart, so the connector has to be added again each time.

## Operations

**Who is connected**

```bash
cd Backend && node scripts/mcpGrants.js list
```

Tokens are never shown or stored in readable form.

**Disconnect someone, or everyone**

```bash
node scripts/mcpGrants.js revoke-admin <admin id>
node scripts/mcpGrants.js revoke-all
```

Access ends on the next call. The owner can also disconnect from Claude's connector settings. Deactivating the NASA account,
removing its super-admin role or deleting it ends access on the next call without any other step.

**Turn the connector off**: set `MCP_ENABLED=false` (or remove it) and restart. All connector routes return 404 and nothing else changes.

**Roll back the code**: revert the pull request. The tables can stay (unused) or be removed with the rollback SQL.

**Monitoring**: log lines `MCP request` (request id, method, status, duration), `MCP tool` (tool, outcome, duration),
`MCP connection approved`, `MCP sign-in refused` (count only, never the email), `MCP grant revoked`. Tokens, passwords and codes are
never logged. Watch for repeated `MCP sign-in refused`, `authorization code reused` and `refresh token reused` (a possible stolen
credential: revoke and check).

**Cleanup**: expired requests, tokens and old revoked connections are removed automatically when someone signs in.
