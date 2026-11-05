/**
 * The Express router for the NASA Insights connector (issue #220): OAuth endpoints, the sign-in form and POST /mcp.
 * It has no Redis or other app-wide imports, so tests can build it alone; mountMcp.js adds the login limiter.
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CONSENT_PATH, MCP_PATH } from './config.js';
import { NasaInsightsProvider } from './provider.js';
import { createConsentRouter } from './consentRouter.js';
import { buildMcpServer } from './server.js';
import rateLimit from '../../middlewares/rateLimit.js';
import logger from '../../utils/logger.js';

const OWN_PATHS = [MCP_PATH, CONSENT_PATH, '/authorize', '/token', '/register', '/revoke', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'];
const rpcError = (res, status, code, message) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

// Limits are per client address and window. Tests raise them; production uses the defaults.
export const DEFAULT_LIMITS = Object.freeze({ register: 20, authorize: 60, token: 60, revoke: 60 });

export function createMcpRouter({ config, db, loginLimiter, limits = DEFAULT_LIMITS }) {
  if (typeof loginLimiter !== 'function') throw new Error('createMcpRouter needs a loginLimiter');
  const provider = new NasaInsightsProvider({ db, config });
  const router = express.Router();

  // Only the connector's own paths are checked: every other request passes through untouched.
  router.use(OWN_PATHS, hostHeaderValidation(config.allowedHosts.map((host) => new URL(`http://${host}`).hostname)));

  router.use(mcpAuthRouter({
    provider,
    issuerUrl: config.issuerUrl,
    resourceServerUrl: new URL(config.resourceUrl),
    scopesSupported: [config.scope],
    resourceName: 'NASA Insights',
    authorizationOptions: { rateLimit: { windowMs: 15 * 60 * 1000, max: limits.authorize } },
    clientRegistrationOptions: { rateLimit: { windowMs: 60 * 60 * 1000, max: limits.register } },
    tokenOptions: { rateLimit: { windowMs: 15 * 60 * 1000, max: limits.token } },
    revocationOptions: { rateLimit: { windowMs: 15 * 60 * 1000, max: limits.revoke } },
  }));
  router.use(createConsentRouter({ db, provider, config, loginLimiter }));

  const byAddress = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, keyGenerator: (req) => `mcp:ip:${req.ip}` });
  const perOwner = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: (req) => `mcp:grant:${req.auth?.extra?.grantId ?? req.ip}` });

  // Claude's servers send no Origin. A browser page does, and must not be able to drive this endpoint.
  const checkOrigin = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) return rpcError(res, 403, -32000, 'Origin not allowed');
    return next();
  };

  const methodNotAllowed = (_req, res) => { res.set('Allow', 'POST'); return rpcError(res, 405, -32000, 'Method not allowed'); };
  router.get(MCP_PATH, methodNotAllowed);
  router.delete(MCP_PATH, methodNotAllowed);

  router.post(
    MCP_PATH,
    checkOrigin,
    byAddress,
    // Everything on /mcp needs a valid token, including listing the tools: an unauthenticated call gets 401 and
    // the pointer Claude needs to start sign-in.
    requireBearerAuth({
      verifier: provider,
      requiredScopes: [config.scope],
      resourceMetadataUrl: config.resourceMetadataUrl,
      expectedResource: config.resourceUrl,
    }),
    perOwner,
    express.json({ limit: '256kb' }),
    async (req, res) => {
      const requestId = randomUUID();
      const started = Date.now();
      res.set('X-Request-Id', requestId);
      const server = buildMcpServer({ requestId });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
        logger.info('MCP request', { requestId, rpc: req.body?.method, status: res.statusCode, ms: Date.now() - started });
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error('MCP request failed', { requestId, message: error?.message });
        if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error');
      }
    }
  );

  // A body that is not JSON gets a JSON-RPC parse error instead of the app's general error page.
  router.use(MCP_PATH, (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.parse.failed') return rpcError(res, 400, -32700, 'Parse error');
    if (error?.type === 'entity.too.large') return rpcError(res, 413, -32600, 'Request too large');
    return next(error);
  });

  return { router, provider };
}

