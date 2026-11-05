/**
 * Settings for the NASA Insights connector (issue #220). Reads the environment once and either returns a complete,
 * valid setup or says why the connector stays off. It never throws: a missing or wrong setting turns off the
 * connector only, and every other part of NASA keeps working.
 *
 *   MCP_ENABLED                  must be exactly "true" to turn the connector on (default: off)
 *   MCP_PUBLIC_BASE_URL          the public HTTPS address of this backend, no path, e.g. https://api.example.com
 *                                (http is accepted only for localhost outside production)
 *   MCP_ALLOWED_HOSTS            optional, comma separated extra Host header values to accept
 *   MCP_ALLOWED_ORIGINS          optional, comma separated Origin values accepted on /mcp (default: https://claude.ai,https://claude.com)
 *   MCP_ALLOW_CLAUDE_CODE_LOOPBACK  "true" also accepts Claude Code's local redirect (http://localhost or 127.0.0.1, any port, path /callback)
 */

export const MCP_SCOPE = 'nasa:insights:read';
export const MCP_PATH = '/mcp';
export const CLAUDE_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
export const CONSENT_PATH = '/mcp-consent';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

// Lowercase scheme and host, no trailing slash, no default port: the form Claude sends as the "resource".
export const canonicalResource = (value) => {
  const url = new URL(String(value));
  url.hash = '';
  url.search = '';
  return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
};

export function loadMcpConfig(env = process.env) {
  if (env.MCP_ENABLED !== 'true') return { enabled: false };

  const off = (reason) => ({ enabled: false, reason });
  let base;
  try {
    base = new URL(env.MCP_PUBLIC_BASE_URL);
  } catch {
    return off('MCP_PUBLIC_BASE_URL is missing or not a valid URL');
  }
  const production = env.NODE_ENV === 'production';
  const local = LOCAL_HOSTS.has(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local && !production)) {
    return off('MCP_PUBLIC_BASE_URL must be an https address (http only for localhost outside production)');
  }
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
    return off('MCP_PUBLIC_BASE_URL must be an origin only: no path, query, fragment or credentials');
  }

  const origin = base.origin;
  const redirectUris = [CLAUDE_REDIRECT_URI];
  const allowedOrigins = env.MCP_ALLOWED_ORIGINS ? list(env.MCP_ALLOWED_ORIGINS) : ['https://claude.ai', 'https://claude.com'];
  if (allowedOrigins.some((o) => { try { return new URL(o).origin !== o; } catch { return true; } })) {
    return off('MCP_ALLOWED_ORIGINS must be a comma separated list of origins such as https://claude.ai');
  }

  return Object.freeze({
    enabled: true,
    scope: MCP_SCOPE,
    publicOrigin: origin,
    issuerUrl: new URL(origin),
    resourceUrl: `${origin}${MCP_PATH}`,
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`,
    allowedHosts: Object.freeze([base.host, ...list(env.MCP_ALLOWED_HOSTS)]),
    allowedOrigins: Object.freeze(allowedOrigins),
    redirectUris: Object.freeze(redirectUris),
    allowClaudeCodeLoopback: env.MCP_ALLOW_CLAUDE_CODE_LOOPBACK === 'true',
    codeTtlSeconds: 5 * 60,
    requestTtlSeconds: 10 * 60,
    accessTtlSeconds: 60 * 60,
    refreshTtlSeconds: 30 * 24 * 60 * 60,
    maxGrantAgeSeconds: 180 * 24 * 60 * 60,
    maxClients: 200,
  });
}

// True only for a redirect URL Claude is documented to use: the exact hosted callback, or (when switched on)
// Claude Code's loopback callback on any port.
export function redirectAllowed(config, uri) {
  if (config.redirectUris.includes(uri)) return true;
  if (!config.allowClaudeCodeLoopback) return false;
  try {
    const url = new URL(uri);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      && url.pathname === '/callback' && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}
