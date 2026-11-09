/**
 * The OAuth authorization server for the NASA Insights connector (issue #220), built on the MCP SDK's
 * OAuthServerProvider contract. The SDK's handlers do the protocol work (discovery documents, PKCE parameters,
 * form parsing, error shapes); this file decides who may sign in and what a token is worth:
 *
 *  - Clients register themselves (Dynamic Client Registration) but only with Claude's exact redirect URL.
 *  - The owner signs in on NASA's own page (consentRouter.js) with a NASA super-admin account.
 *  - Tokens are random, opaque and stored hashed. They are not NASA login tokens and no NASA route accepts them.
 *  - Every check at /mcp re-reads the account: removing or demoting the owner ends access on the next call.
 */
import { randomUUID } from 'node:crypto';
import {
  InvalidClientMetadataError, InvalidGrantError, InvalidTargetError, InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { canonicalResource, redirectAllowed } from './config.js';
import { renderConsent, pageHeaders } from './consentPage.js';
import * as store from './store.js';
import logger from '../../utils/logger.js';

const cleanName = (value) => String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 100) || null;

// Sends the browser back to the client with an OAuth error (only for a redirect URL that was already validated).
export function redirectWithError(res, redirectUri, error, state, description) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  res.redirect(302, url.toString());
}

export class NasaInsightsProvider {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
    this.clientsStore = {
      getClient: (clientId) => this.getClient(clientId),
      registerClient: (client) => this.registerClient(client),
    };
  }

  // Runs `job` in one transaction when given a pool; inside a caller's transaction (a client) it just runs.
  async tx(job) {
    if (typeof this.db.connect !== 'function') return job(this.db);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await job(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------- clients ----------
  async getClient(clientId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(clientId))) return undefined;
    const row = await store.getClientRow(this.db, clientId);
    if (!row) return undefined;
    return {
      client_id: row.client_id,
      client_name: row.client_name ?? undefined,
      redirect_uris: row.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: this.config.scope,
    };
  }

  async registerClient(client) {
    const uris = (client.redirect_uris || []).map(String);
    const method = client.token_endpoint_auth_method;
    // Redirect URLs and the auth method are public client metadata, not secrets: logged so a refused registration can be explained.
    const refuse = (message) => {
      logger.warn('MCP client registration refused', { reason: message, redirectUris: uris.slice(0, 5), authMethod: method });
      throw new InvalidClientMetadataError(message);
    };
    if (uris.length === 0 || uris.length > 5 || !uris.every((u) => redirectAllowed(this.config, u))) {
      refuse('redirect_uris must be the callback URL Claude documents for connectors');
    }
    // Claude asks for client_secret_post when it registers. The server may answer with different values (RFC 7591 section 3.2.1):
    // every client here is registered as a public client, protected by PKCE and by the owner's sign-in, and no secret is issued.
    if (await store.countClients(this.db) >= this.config.maxClients) {
      await store.pruneUnusedClients(this.db);
      if (await store.countClients(this.db) >= this.config.maxClients) {
        throw new InvalidClientMetadataError('Too many registered clients. Try again later.');
      }
    }
    const clientId = client.client_id || randomUUID();
    await store.insertClient(this.db, { clientId, clientName: cleanName(client.client_name), redirectUris: uris });
    logger.info('MCP client registered', { clientId });
    return {
      client_id: clientId,
      client_id_issued_at: client.client_id_issued_at,
      client_name: cleanName(client.client_name) ?? undefined,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: this.config.scope,
    };
  }

  // ---------- authorization ----------
  // Called by the SDK's /authorize handler after it checked the client, the redirect URL, PKCE and the parameters.
  // The owner is not known yet, so this shows NASA's sign-in and consent page.
  async authorize(client, params, res) {
    const redirectUri = params.redirectUri;
    if (!redirectAllowed(this.config, redirectUri)) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Unregistered redirect_uri' });
      return;
    }
    const scopes = params.scopes?.length ? params.scopes : [this.config.scope];
    if (!scopes.every((s) => s === this.config.scope)) {
      return redirectWithError(res, redirectUri, 'invalid_scope', params.state, `Only ${this.config.scope} is available`);
    }
    if (params.resource && canonicalResource(params.resource) !== this.config.resourceUrl) {
      return redirectWithError(res, redirectUri, 'invalid_target', params.state, 'resource must be the NASA Insights MCP URL');
    }
    store.pruneExpired(this.db).catch(() => {});
    const requestId = await store.createRequest(this.db, {
      clientId: client.client_id,
      redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scope: this.config.scope,
      resource: this.config.resourceUrl,
      ttlSeconds: this.config.requestTtlSeconds,
    });
    res.status(200).set(pageHeaders(new URL(redirectUri).origin));
    res.send(renderConsent({
      requestId,
      clientName: client.client_name,
      redirectHost: new URL(redirectUri).host,
      scope: this.config.scope,
    }));
  }

  async challengeForAuthorizationCode(client, code) {
    const row = await store.peekToken(this.db, code, 'code');
    if (row && row.client_id === client.client_id && row.used_at) {
      // A code that was already used came back: whatever it produced is revoked.
      await store.revokeGrant(this.db, row.grant_id, 'authorization_code_reused');
      logger.warn('MCP authorization code reused; grant revoked', { grantId: row.grant_id });
    }
    if (!row || row.client_id !== client.client_id || row.used_at || !row.live || row.revoked_at) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return row.code_challenge;
  }

  // Turns a pending, owner-approved sign-in into a one-time code. Called by the consent page after the owner agreed.
  async issueCode(db, { adminId, request }) {
    const grantId = await store.createGrant(db, { adminId, clientId: request.client_id, scope: request.scope, resource: request.resource });
    return store.insertToken(db, {
      grantId, kind: 'code', ttlSeconds: this.config.codeTtlSeconds,
      codeChallenge: request.code_challenge, redirectUri: request.redirect_uri,
    });
  }

  async issueTokens(db, grantId, scope) {
    const access = await store.insertToken(db, { grantId, kind: 'access', ttlSeconds: this.config.accessTtlSeconds });
    const refresh = await store.insertToken(db, { grantId, kind: 'refresh', ttlSeconds: this.config.refreshTtlSeconds });
    return { access_token: access, token_type: 'Bearer', expires_in: this.config.accessTtlSeconds, refresh_token: refresh, scope };
  }

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const outcome = await this.tx(async (db) => {
      const used = await store.useToken(db, code, 'code');
      if (!used) {
        // A code that was already used means someone replayed it: everything issued from it is revoked.
        const earlier = await store.peekToken(db, code, 'code');
        if (earlier?.used_at && earlier.client_id === client.client_id) await store.revokeGrant(db, earlier.grant_id, 'authorization_code_reused');
        return { error: 'Invalid or expired authorization code' };
      }
      if (used.client_id !== client.client_id) {
        await store.revokeGrant(db, used.grant_id, 'code_presented_by_another_client');
        return { error: 'Authorization code was issued to another client' };
      }
      if (redirectUri !== undefined && redirectUri !== used.redirect_uri) return { error: 'redirect_uri does not match the authorization request' };
      if (resource && canonicalResource(resource) !== used.resource) return { target: true };
      if (!(await store.adminEligible(db, used.admin_id))) {
        await store.revokeGrant(db, used.grant_id, 'account_not_eligible');
        return { error: 'The account is no longer eligible' };
      }
      return { tokens: await this.issueTokens(db, used.grant_id, used.scope) };
    });
    if (outcome.target) throw new InvalidTargetError('resource must be the NASA Insights MCP URL');
    if (outcome.error) throw new InvalidGrantError(outcome.error);
    return outcome.tokens;
  }

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const outcome = await this.tx(async (db) => {
      const earlier = await store.peekToken(db, refreshToken, 'refresh');
      if (earlier?.used_at && earlier.client_id === client.client_id) {
        // An old refresh token came back after it was replaced: treat the grant as stolen.
        await store.revokeGrant(db, earlier.grant_id, 'refresh_token_reused');
        return { error: 'Invalid refresh token' };
      }
      const used = await store.useToken(db, refreshToken, 'refresh');
      if (!used || used.client_id !== client.client_id) return { error: 'Invalid or expired refresh token' };
      if (Date.now() - new Date(used.created_at).getTime() > this.config.maxGrantAgeSeconds * 1000) {
        await store.revokeGrant(db, used.grant_id, 'grant_too_old');
        return { error: 'The connection is too old. Connect again.' };
      }
      if (scopes?.length && !scopes.every((s) => used.scope.split(' ').includes(s))) return { error: 'Requested scope is wider than the original grant' };
      if (resource && canonicalResource(resource) !== used.resource) return { target: true };
      if (!(await store.adminEligible(db, used.admin_id))) {
        await store.revokeGrant(db, used.grant_id, 'account_not_eligible');
        return { error: 'The account is no longer eligible' };
      }
      return { tokens: await this.issueTokens(db, used.grant_id, used.scope) };
    });
    if (outcome.target) throw new InvalidTargetError('resource must be the NASA Insights MCP URL');
    if (outcome.error) throw new InvalidGrantError(outcome.error);
    return outcome.tokens;
  }

  // The check behind every call to /mcp.
  async verifyAccessToken(token) {
    const row = await store.verifyAccess(this.db, token);
    if (!row) throw new InvalidTokenError('Invalid or expired token');
    if (row.stale) store.touchGrant(this.db, row.grant_id).catch(() => {});
    return {
      token,
      clientId: row.client_id,
      scopes: row.scope.split(' '),
      expiresAt: Number(row.expires_at),
      resource: new URL(row.resource),
      extra: { grantId: row.grant_id, adminId: row.admin_id },
    };
  }

  // RFC 7009: a client disconnects by revoking its token. The whole grant ends, so the paired refresh token stops too.
  async revokeToken(client, request) {
    const found = await store.findAnyToken(this.db, request.token);
    if (found && found.client_id === client.client_id) {
      await store.revokeGrant(this.db, found.grant_id, 'revoked_by_client');
      logger.info('MCP grant revoked by client', { grantId: found.grant_id });
    }
  }
}
