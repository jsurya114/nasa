import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcrypt';
import { loadMcpConfig, redirectAllowed, canonicalResource, CLAUDE_REDIRECT_URI, MCP_SCOPE } from '../services/mcp/config.js';
import { renderConsent } from '../services/mcp/consentPage.js';
import { TOOLS } from '../services/mcp/tools/index.js';
import { METRIC_DEFINITIONS } from '../services/reporting/metricDefinitions.js';

const base = { MCP_ENABLED: 'true', MCP_PUBLIC_BASE_URL: 'https://api.example.test' };

test('the connector is off unless explicitly enabled, and a bad setting turns it off without throwing', () => {
  assert.deepEqual(loadMcpConfig({}), { enabled: false });
  assert.deepEqual(loadMcpConfig({ MCP_ENABLED: 'yes', MCP_PUBLIC_BASE_URL: base.MCP_PUBLIC_BASE_URL }), { enabled: false });
  const reasons = [
    {},
    { MCP_PUBLIC_BASE_URL: 'not a url' },
    { MCP_PUBLIC_BASE_URL: 'http://api.example.test' },
    { MCP_PUBLIC_BASE_URL: 'https://api.example.test/mcp' },
    { MCP_PUBLIC_BASE_URL: 'https://user:pw@api.example.test' },
    { MCP_PUBLIC_BASE_URL: 'http://localhost:5000', NODE_ENV: 'production' },
    { MCP_PUBLIC_BASE_URL: base.MCP_PUBLIC_BASE_URL, MCP_ALLOWED_ORIGINS: 'claude.ai' },
  ];
  for (const extra of reasons) {
    const result = loadMcpConfig({ MCP_ENABLED: 'true', ...extra });
    assert.equal(result.enabled, false, JSON.stringify(extra));
    assert.ok(result.reason, 'says why');
  }
});

test('a valid setup gives the exact resource, scope, redirect and origin rules', () => {
  const config = loadMcpConfig(base);
  assert.equal(config.enabled, true);
  assert.equal(config.resourceUrl, 'https://api.example.test/mcp');
  assert.equal(config.resourceMetadataUrl, 'https://api.example.test/.well-known/oauth-protected-resource/mcp');
  assert.equal(config.scope, 'nasa:insights:read');
  assert.deepEqual([...config.allowedOrigins], ['https://claude.ai', 'https://claude.com']);
  assert.equal(loadMcpConfig({ MCP_ENABLED: 'true', MCP_PUBLIC_BASE_URL: 'http://localhost:5000' }).enabled, true, 'http localhost outside production');
  assert.equal(canonicalResource('HTTPS://API.Example.test:443/mcp/?x=1#f'), 'https://api.example.test/mcp');
});

test('only Claude\'s exact redirect URL is accepted; the Claude Code loopback only when switched on', () => {
  const config = loadMcpConfig(base);
  assert.equal(redirectAllowed(config, CLAUDE_REDIRECT_URI), true);
  for (const bad of ['https://claude.ai/api/mcp/auth_callback/', 'https://claude.ai/api/mcp/auth_callback?x=1', 'https://evil.example/api/mcp/auth_callback', 'http://claude.ai/api/mcp/auth_callback', 'http://localhost:3118/callback', 'javascript:alert(1)', '']) {
    assert.equal(redirectAllowed(config, bad), false, bad);
  }
  const loop = loadMcpConfig({ ...base, MCP_ALLOW_CLAUDE_CODE_LOOPBACK: 'true' });
  assert.equal(redirectAllowed(loop, 'http://localhost:3118/callback'), true);
  assert.equal(redirectAllowed(loop, 'http://127.0.0.1:9/callback'), true);
  assert.equal(redirectAllowed(loop, 'http://localhost:3118/other'), false);
  assert.equal(redirectAllowed(loop, 'http://evil.localhost.example:3118/callback'), false);
});

test('the consent page escapes what an app chose and names the redirect host', () => {
  const html = renderConsent({ requestId: 'r"><script>', clientName: '<img src=x onerror=alert(1)>', redirectHost: 'claude.ai', scope: MCP_SCOPE, error: '<b>bad</b>' });
  assert.ok(!/<img|<script|<b>/.test(html));
  assert.ok(html.includes('claude.ai'));
  assert.ok(!/<script/i.test(html), 'the page has no scripts at all');
});

test('every tool is read-only by design: strict input, named scope, and no write-style tool exists', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['get_metric_definitions']);
  for (const tool of TOOLS) {
    assert.equal(tool.requiredScope, MCP_SCOPE);
    assert.equal(tool.inputSchema.safeParse({ extra: 1 }).success, false, 'unsupported arguments are rejected');
    assert.equal(tool.inputSchema.safeParse({}).success, true);
    assert.ok(!/pay|write|update|delete|sql|exec|shell|everee/i.test(tool.name));
  }
  assert.ok(METRIC_DEFINITIONS.find((m) => m.id === 'gross_margin').label.includes('before overheads'));
  assert.ok(METRIC_DEFINITIONS.find((m) => m.id === 'company_margin').caveats[0].includes('not total revenue'));
});

// ---------------------------------------------------------------------------------------------------------------
// The whole connection over HTTP, against a disposable PostgreSQL copy that has the app's tables and the connector's
// migration (never production): MCP_TEST_DB=1 and the DB_* variables. All accounts are made up and removed at the end.
const hasDb = process.env.MCP_TEST_DB === '1';

test('sign-in, tokens and every tool call, end to end', { skip: !hasDb && 'set MCP_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const { createMcpRouter } = await import('../services/mcp/router.js');
  const pool = new pg.Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME, password: process.env.DB_PASSWORD });
  const tag = randomBytes(4).toString('hex');
  const password = `Test-pass-${tag}`;
  const hash = await bcrypt.hash(password, 4);
  const addAdmin = async (label, role, active = true) => {
    const { rows } = await pool.query('INSERT INTO admin (password, name, email, role, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id, email', [hash, `mcp-test-${label}-${tag}`, `mcp-test-${label}-${tag}@example.test`, role, active]);
    return rows[0];
  };
  const owner = await addAdmin('owner', 'superadmin');
  const cityAdmin = await addAdmin('city', 'admin');
  const blocked = await addAdmin('blocked', 'superadmin', false);
  const second = await addAdmin('second', 'superadmin');

  const app = express();
  app.set('trust proxy', false);
  let server;
  let config;
  app.use((req, res, next) => router(req, res, next));
  let router = (_req, _res, next) => next();
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  config = loadMcpConfig({ MCP_ENABLED: 'true', MCP_PUBLIC_BASE_URL: origin });
  assert.equal(config.enabled, true);
  router = createMcpRouter({ config, db: pool, loginLimiter: (_req, _res, next) => next(), limits: { register: 1000, authorize: 1000, token: 1000, revoke: 1000 } }).router;
  app.use((_req, res) => res.status(404).json({ not: 'found' }));

  const counts = async () => (await pool.query('SELECT (SELECT count(*) FROM drivers) AS d, (SELECT count(*) FROM dashboard_data) AS dd, (SELECT count(*) FROM pay_runs) AS pr')).rows[0];
  const before = await counts();

  const url = (path) => `${origin}${path}`;
  const json = async (path, init = {}) => {
    const res = await fetch(url(path), { redirect: 'manual', ...init });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { res, body };
  };
  const rpc = (token, body, extra = {}) => json('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify(body),
  });
  const register = (redirect_uris, more = {}) => json('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], ...more }) });
  const pkce = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }; };
  const authorizeUrl = (client, challenge, extra = {}) => {
    const q = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: challenge, code_challenge_method: 'S256', state: 'state-123', resource: config.resourceUrl, scope: MCP_SCOPE, ...extra });
    return `/authorize?${q}`;
  };
  const consent = (html, fields) => {
    const requestId = /name="request" value="([^"]+)"/.exec(html)[1];
    return json('/mcp-consent', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request: requestId, ...fields }) });
  };
  const token = (fields) => json('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

  // Signs in as `who` and returns the tokens.
  const connect = async (who = owner) => {
    const { body: client } = await register([CLAUDE_REDIRECT_URI]);
    const { verifier, challenge } = pkce();
    const page = await json(authorizeUrl(client.client_id, challenge));
    const done = await consent(page.body, { email: who.email, password, decision: 'allow' });
    assert.equal(done.res.status, 302, 'approved');
    const location = new URL(done.res.headers.get('location'));
    assert.equal(location.origin + location.pathname, CLAUDE_REDIRECT_URI);
    assert.equal(location.searchParams.get('state'), 'state-123');
    const code = location.searchParams.get('code');
    const issued = await token({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: CLAUDE_REDIRECT_URI, resource: config.resourceUrl });
    assert.equal(issued.res.status, 200, JSON.stringify(issued.body));
    return { client, code, verifier, ...issued.body };
  };

  try {
    await t.test('without a token, /mcp answers 401 and tells Claude where to sign in', async () => {
      for (const body of [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_metric_definitions', arguments: {} } }]) {
        const { res } = await rpc(null, body);
        assert.equal(res.status, 401);
        assert.match(res.headers.get('www-authenticate'), /^Bearer .*resource_metadata="http:\/\/localhost:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);
      }
      assert.equal((await rpc('not-a-real-token', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 401);
    });

    await t.test('discovery documents match what Claude needs', async () => {
      const prm = (await json('/.well-known/oauth-protected-resource/mcp')).body;
      assert.equal(prm.resource, config.resourceUrl);
      assert.deepEqual(prm.authorization_servers, [`${origin}/`]);
      assert.deepEqual(prm.scopes_supported, [MCP_SCOPE]);
      const as = (await json('/.well-known/oauth-authorization-server')).body;
      assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
      assert.ok(as.token_endpoint_auth_methods_supported.includes('none'));
      assert.ok(as.registration_endpoint.endsWith('/register'));
      assert.equal(as.client_id_metadata_document_supported, undefined, 'client ID metadata documents are not advertised yet');
      assert.deepEqual(as.scopes_supported, [MCP_SCOPE]);
    });

    await t.test('client registration accepts only Claude\'s exact redirect URL and only public clients', async () => {
      assert.equal((await register(['https://evil.example/cb'])).res.status, 400);
      assert.equal((await register([CLAUDE_REDIRECT_URI, 'https://evil.example/cb'])).res.status, 400);
      assert.equal((await register(['http://localhost:3118/callback'])).res.status, 400, 'loopback is off by default');
      assert.equal((await register([CLAUDE_REDIRECT_URI], { token_endpoint_auth_method: 'client_secret_post' })).res.status, 400);
      const ok = await register([CLAUDE_REDIRECT_URI]);
      assert.equal(ok.res.status, 201);
      assert.equal(ok.body.token_endpoint_auth_method, 'none');
      assert.equal(ok.body.client_secret, undefined);
    });

    await t.test('the sign-in page is not frameable and an unknown redirect or scope is refused', async () => {
      const { body: client } = await register([CLAUDE_REDIRECT_URI]);
      const { challenge } = pkce();
      const page = await json(authorizeUrl(client.client_id, challenge));
      assert.equal(page.res.status, 200);
      assert.equal(page.res.headers.get('x-frame-options'), 'DENY');
      assert.match(page.res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(page.res.headers.get('cache-control'), 'no-store');
      assert.equal((await json(authorizeUrl(client.client_id, challenge, { redirect_uri: 'https://evil.example/cb' }))).res.status, 400);
      const noPkce = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE_REDIRECT_URI, state: 'x' });
      assert.equal((await json(`/authorize?${noPkce}`)).res.status, 302, 'refused by redirecting an error to the validated callback');
      const scope = await json(authorizeUrl(client.client_id, challenge, { scope: 'nasa:insights:write' }));
      assert.equal(new URL(scope.res.headers.get('location')).searchParams.get('error'), 'invalid_scope');
      const target = await json(authorizeUrl(client.client_id, challenge, { resource: 'https://other.example/mcp' }));
      assert.equal(new URL(target.res.headers.get('location')).searchParams.get('error'), 'invalid_target');
    });

    await t.test('only an active super admin with the right password can allow access', async () => {
      const { body: client } = await register([CLAUDE_REDIRECT_URI]);
      const { challenge } = pkce();
      const freshPage = () => json(authorizeUrl(client.client_id, challenge));
      for (const fields of [
        { email: owner.email, password: 'wrong-password', decision: 'allow' },
        { email: cityAdmin.email, password, decision: 'allow' },
        { email: blocked.email, password, decision: 'allow' },
        { email: 'nobody@example.test', password, decision: 'allow' },
        { email: '', password: '', decision: 'allow' },
      ]) {
        const res = await consent((await freshPage()).body, fields);
        assert.equal(res.res.status, 401, JSON.stringify({ ...fields, password: '…' }));
        assert.match(res.body, /cannot use NASA Insights/);
        assert.ok(!res.body.includes(password));
      }
      const page = await freshPage();
      const denied = await consent(page.body, { email: owner.email, password, decision: 'deny' });
      assert.equal(denied.res.status, 302);
      assert.equal(new URL(denied.res.headers.get('location')).searchParams.get('error'), 'access_denied');
      assert.equal((await consent(page.body, { email: owner.email, password, decision: 'allow' })).res.status, 400, 'a cancelled request cannot be used again');
    });

    await t.test('a sign-in request locks after repeated wrong passwords and works only once', async () => {
      const { body: client } = await register([CLAUDE_REDIRECT_URI]);
      const { challenge } = pkce();
      const page = await json(authorizeUrl(client.client_id, challenge));
      for (let i = 0; i < 5; i += 1) assert.equal((await consent(page.body, { email: owner.email, password: 'nope', decision: 'allow' })).res.status, 401);
      assert.equal((await consent(page.body, { email: owner.email, password, decision: 'allow' })).res.status, 400, 'the request is gone');
      const again = await json(authorizeUrl(client.client_id, challenge));
      assert.equal((await consent(again.body, { email: owner.email, password, decision: 'allow' })).res.status, 302);
      assert.equal((await consent(again.body, { email: owner.email, password, decision: 'allow' })).res.status, 400, 'single use');
    });

    await t.test('the code needs the right PKCE verifier, client and redirect; a replayed code revokes what it made', async () => {
      const { body: client } = await register([CLAUDE_REDIRECT_URI]);
      const { body: other } = await register([CLAUDE_REDIRECT_URI]);
      const { verifier, challenge } = pkce();
      const page = await json(authorizeUrl(client.client_id, challenge));
      const done = await consent(page.body, { email: owner.email, password, decision: 'allow' });
      const code = new URL(done.res.headers.get('location')).searchParams.get('code');
      const exchange = (extra) => token({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: CLAUDE_REDIRECT_URI, ...extra });
      assert.equal((await exchange({ code_verifier: pkce().verifier })).body.error, 'invalid_grant', 'wrong verifier');
      assert.equal((await exchange({ client_id: other.client_id })).res.status, 400, 'another client');
      const good = await exchange({});
      assert.equal(good.res.status, 200);
      assert.equal((await rpc(good.body.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 200);
      const replay = await exchange({});
      assert.equal(replay.res.status, 400);
      assert.equal((await rpc(good.body.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 401, 'replaying the code revoked the grant');
    });

    await t.test('a code presented for another resource is refused and cannot be used again', async () => {
      const { body: client } = await register([CLAUDE_REDIRECT_URI]);
      const { verifier, challenge } = pkce();
      const page = await json(authorizeUrl(client.client_id, challenge));
      const done = await consent(page.body, { email: owner.email, password, decision: 'allow' });
      const code = new URL(done.res.headers.get('location')).searchParams.get('code');
      const exchange = (extra) => token({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: CLAUDE_REDIRECT_URI, ...extra });
      assert.equal((await exchange({ resource: 'https://other.example/mcp' })).body.error, 'invalid_target');
      assert.equal((await exchange({})).res.status, 400);
    });

    await t.test('an authorized call lists and runs the read-only tool with a full envelope', async () => {
      const tokens = await connect();
      assert.equal(tokens.token_type, 'Bearer');
      assert.equal(tokens.scope, MCP_SCOPE);
      assert.ok(tokens.access_token.length >= 40 && tokens.refresh_token.length >= 40);
      const init = await rpc(tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
      assert.equal(init.res.status, 200);
      assert.equal(init.body.result.serverInfo.name, 'nasa-insights');
      assert.equal(init.res.headers.get('mcp-session-id'), null, 'stateless: no session id');
      const list = await rpc(tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
      assert.deepEqual(list.body.result.tools.map((x) => x.name), ['get_metric_definitions']);
      const tool = list.body.result.tools[0];
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(tool.annotations.openWorldHint, false);
      assert.ok(tool.outputSchema && tool.inputSchema);
      const call = await rpc(tokens.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_metric_definitions', arguments: {} } });
      assert.equal(call.res.status, 200);
      assert.ok(call.res.headers.get('x-request-id'));
      const out = call.body.result.structuredContent;
      assert.equal(call.body.result.isError, undefined);
      assert.ok(!Number.isNaN(Date.parse(out.meta.generatedAt)));
      assert.equal(out.meta.units.currency, 'USD');
      assert.deepEqual(out.meta.coverage, []);
      assert.equal(out.data.connector.readOnly, true);
      assert.equal(out.data.connector.scope, MCP_SCOPE);
      assert.ok(out.data.definitions.some((d) => d.id === 'gross_margin' && d.label.includes('before overheads')));
      assert.equal(JSON.parse(call.body.result.content[0].text).data.connector.name, 'NASA Insights');
      // Unsupported arguments and unknown tools are rejected, not guessed at.
      const extra = await rpc(tokens.access_token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_metric_definitions', arguments: { sql: 'select 1' } } });
      assert.ok(extra.body.error || extra.body.result?.isError);
      const unknown = await rpc(tokens.access_token, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'run_sql', arguments: {} } });
      assert.ok(unknown.body.error || unknown.body.result?.isError);
    });

    await t.test('the endpoint refuses other methods, other origins, other hosts and unparseable bodies', async () => {
      const tokens = await connect();
      const get = await json('/mcp', { headers: { authorization: `Bearer ${tokens.access_token}` } });
      assert.equal(get.res.status, 405);
      assert.equal((await json('/mcp', { method: 'DELETE' })).res.status, 405);
      assert.equal((await rpc(tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'https://evil.example' })).res.status, 403);
      assert.equal((await rpc(tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'https://claude.ai' })).res.status, 200);
      const wrongHost = await new Promise((resolve) => {
        import('node:http').then(({ default: http }) => {
          const r = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
          r.end('{}');
        });
      });
      assert.equal(wrongHost, 403, 'DNS rebinding protection');
      const bad = await json('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}`, accept: 'application/json, text/event-stream' }, body: '{not json' });
      assert.equal(bad.res.status, 400);
      assert.equal(bad.body.error.code, -32700);
    });

    await t.test('refresh tokens rotate, and an old one coming back revokes the connection', async () => {
      const first = await connect();
      const refreshed = await token({ grant_type: 'refresh_token', client_id: first.client.client_id, refresh_token: first.refresh_token });
      assert.equal(refreshed.res.status, 200);
      assert.notEqual(refreshed.body.refresh_token, first.refresh_token);
      assert.equal((await rpc(refreshed.body.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 200);
      assert.equal((await token({ grant_type: 'refresh_token', client_id: first.client.client_id, refresh_token: 'made-up' })).body.error, 'invalid_grant');
      const reused = await token({ grant_type: 'refresh_token', client_id: first.client.client_id, refresh_token: first.refresh_token });
      assert.equal(reused.body.error, 'invalid_grant');
      assert.equal((await rpc(refreshed.body.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 401, 'the whole grant was revoked');
      assert.equal((await token({ grant_type: 'refresh_token', client_id: first.client.client_id, refresh_token: refreshed.body.refresh_token })).res.status, 400);
    });

    await t.test('expired tokens and wrong-scope tokens are rejected', async () => {
      const tokens = await connect();
      await pool.query("UPDATE mcp_oauth_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [createHash('sha256').update(tokens.access_token).digest('hex')]);
      assert.equal((await rpc(tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 401, 'expired');
      const again = await connect();
      await pool.query("UPDATE mcp_oauth_grants g SET scope = 'other:scope' FROM mcp_oauth_tokens t WHERE t.grant_id = g.id AND t.token_hash = $1", [createHash('sha256').update(again.access_token).digest('hex')]);
      assert.equal((await rpc(again.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 403, 'missing scope');
      const third = await connect();
      await pool.query("UPDATE mcp_oauth_grants g SET resource = 'https://other.example/mcp' FROM mcp_oauth_tokens t WHERE t.grant_id = g.id AND t.token_hash = $1", [createHash('sha256').update(third.access_token).digest('hex')]);
      assert.equal((await rpc(third.access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).res.status, 401, 'issued for another resource');
    });

    await t.test('revoking, deactivating, demoting or deleting the owner ends access on the next call', async () => {
      const call = (tk) => rpc(tk, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).then((r) => r.res.status);

      const a = await connect();
      assert.equal((await json('/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: a.client.client_id, token: a.refresh_token }) })).res.status, 200);
      assert.equal(await call(a.access_token), 401, 'revoked by the client');

      const b = await connect(second);
      assert.equal(await call(b.access_token), 200);
      await pool.query('UPDATE admin SET is_active = false WHERE id = $1', [second.id]);
      assert.equal(await call(b.access_token), 401, 'deactivated');
      assert.equal((await token({ grant_type: 'refresh_token', client_id: b.client.client_id, refresh_token: b.refresh_token })).res.status, 400);
      await pool.query('UPDATE admin SET is_active = true, role = $2 WHERE id = $1', [second.id, 'admin']);
      assert.equal(await call(b.access_token), 401, 'no longer a super admin');
      await pool.query("UPDATE admin SET role = 'superadmin' WHERE id = $1", [second.id]);

      const c = await connect(second);
      assert.equal(await call(c.access_token), 200);
      await pool.query('DELETE FROM admin WHERE id = $1', [second.id]);
      assert.equal(await call(c.access_token), 401, 'account removed');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM mcp_oauth_grants WHERE admin_id = $1', [second.id])).rows[0].n, 0, 'its grants were removed with it');
    });

    await t.test('two owners\' calls never share state, and nothing in the business tables changed', async () => {
      const x = await connect();
      const y = await connect();
      const results = await Promise.all([x, y, x, y].map((tk, i) => rpc(tk.access_token, { jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'get_metric_definitions', arguments: {} } })));
      for (const r of results) assert.equal(r.res.status, 200);
      assert.equal(new Set(results.map((r) => r.res.headers.get('x-request-id'))).size, 4, 'a new request id every time');
      assert.deepEqual(await counts(), before, 'drivers, daily rows and pay runs are unchanged');
    });

    await t.test('the connector\'s paths are the only ones it answers; everything else passes through', async () => {
      assert.equal((await json('/admin/anything')).res.status, 404);
      assert.equal((await json('/', { headers: { host: 'anything.example' } })).res.status, 404);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DELETE FROM admin WHERE id = ANY($1)', [[owner.id, cityAdmin.id, blocked.id, second.id]]);
    await pool.query("DELETE FROM mcp_oauth_clients c WHERE NOT EXISTS (SELECT 1 FROM mcp_oauth_grants g WHERE g.client_id = c.client_id)");
    await pool.end();
  }
});
