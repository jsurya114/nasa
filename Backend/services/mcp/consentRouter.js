/**
 * The form handler behind NASA's connector sign-in page (issue #220). The owner proves who they are with their NASA
 * super-admin email and password (same password cleaning and same login limits as the admin login) and either
 * allows or cancels. Nothing is decided by the page's contents except through the pending request it carries,
 * which is random, single-use and expires, so a page cannot be forged or replayed from another site.
 */
import express from 'express';
import bcrypt from 'bcrypt';
import { CONSENT_PATH } from './config.js';
import { pageHeaders, renderConsent, renderMessage } from './consentPage.js';
import { redirectWithError } from './provider.js';
import * as store from './store.js';
import { legacyCredentialClean } from '../../middlewares/sanitize.js';
import logger from '../../utils/logger.js';

const MAX_FAILED_ATTEMPTS = 5;
// Compared against when the email is unknown, so an unknown email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function createConsentRouter({ db, provider, loginLimiter, verifyPassword = bcrypt.compare }) {
  const router = express.Router();
  const send = (res, status, html, origin) => res.status(status).set(pageHeaders(origin)).send(html);
  const expired = (res) => send(res, 400, renderMessage('This sign-in has expired', 'Go back to Claude and choose Connect again.'));

  router.post(
    CONSENT_PATH,
    express.urlencoded({ extended: false, limit: '8kb' }),
    loginLimiter,
    async (req, res, next) => {
      try {
        const body = req.body ?? {};
        const requestId = typeof body.request === 'string' ? body.request.slice(0, 100) : '';
        const request = requestId ? await store.getRequest(db, requestId) : undefined;
        if (!request) return expired(res);
        const origin = new URL(request.redirect_uri).origin;

        if (body.decision === 'deny') {
          await store.consumeRequest(db, requestId);
          return redirectWithError(res, request.redirect_uri, 'access_denied', request.state, 'The owner did not allow access');
        }

        const email = typeof body.email === 'string' ? body.email.trim().slice(0, 150) : '';
        const password = typeof body.password === 'string' ? legacyCredentialClean(body.password.slice(0, 200)) : '';
        const account = email && password ? await store.findEligibleAdminByEmail(db, email) : null;
        const passwordOk = await verifyPassword(password || 'x', account?.password ?? DUMMY_HASH);

        if (!account || !passwordOk || !account.eligible) {
          const failures = await store.recordFailedAttempt(db, requestId);
          logger.warn('MCP sign-in refused', { failures });
          if (failures >= MAX_FAILED_ATTEMPTS) {
            await store.consumeRequest(db, requestId);
            return send(res, 401, renderMessage('Too many attempts', 'Go back to Claude and choose Connect again.'), origin);
          }
          return send(res, 401, renderConsent({
            requestId,
            clientName: request.client_name,
            redirectHost: new URL(request.redirect_uri).host,
            scope: request.scope,
            error: 'Sign-in failed, or this account cannot use NASA Insights. Only the NASA super admin can approve.',
          }), origin);
        }

        const issued = await provider.tx(async (tx) => {
          const consumed = await store.consumeRequest(tx, requestId);
          if (!consumed) return null;
          return { code: await provider.issueCode(tx, { adminId: account.id, request: consumed }), consumed };
        });
        if (!issued) return expired(res);

        logger.info('MCP connection approved', { adminId: account.id, clientId: issued.consumed.client_id });
        const target = new URL(issued.consumed.redirect_uri);
        target.searchParams.set('code', issued.code);
        if (issued.consumed.state) target.searchParams.set('state', issued.consumed.state);
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.redirect(302, target.toString());
      } catch (error) {
        return next(error);
      }
    }
  );

  // Unexpected failures show a plain page. Details stay in the log, which redacts sensitive fields.
  router.use((error, _req, res, _next) => {
    logger.error('MCP consent failed', error);
    send(res, 500, renderMessage('Something went wrong', 'NASA Insights could not finish this sign-in. Try again in a moment.'));
  });

  return router;
}
