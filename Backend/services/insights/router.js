/**
 * The Express router for the Insights page's data (issue #227). Super admin only: the router checks the token and then the role before any route
 * runs, so a new route added below cannot be reached without both. It has no Redis or other app-wide imports of its own: the real `adminAuth` is
 * passed in by routes/insightsRoutes.js, and tests pass their own.
 *
 * Read-only. Nothing here recalculates pay, changes a rate, touches a claim, marks anyone paid or calls Everee.
 */
import express from 'express';
import rateLimit from '../../middlewares/rateLimit.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { InputError, getCities, getCityRanking, getDefinitions, getLosses, getOverview, getTrends } from './insightsService.js';

export function createInsightsRouter({ adminAuth, requireRole, run }) {
  if (typeof adminAuth !== 'function' || typeof requireRole !== 'function' || typeof run !== 'function') {
    throw new Error('createInsightsRouter needs adminAuth, requireRole and run');
  }
  const router = express.Router();

  // Everything below is for the super admin only. Keep new Insights routes below this line.
  router.use(adminAuth);
  router.use(requireRole('superadmin'));
  router.use(rateLimit({ windowMs: 60 * 1000, max: 120, keyGenerator: (req) => `insights:${req.admin?.id ?? req.ip}` }));
  // Company-wide financial figures are never cached by a browser or a proxy.
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // A request the caller gives up on cancels its query.
  const handle = (action, job) => async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    try {
      return res.status(HttpStatus.OK).json(await job(req, { signal: abort.signal }));
    } catch (error) {
      if (error instanceof InputError) return res.status(HttpStatus.BAD_REQUEST).json({ message: error.message });
      if (abort.signal.aborted) return undefined;
      if (error?.code === '57014') return res.status(HttpStatus.GATEWAY_TIMEOUT ?? 504).json({ message: 'This question took too long to answer. Try a shorter period or fewer cities.' });
      logger.error(`Insights ${action} failed`, { code: error?.code, message: error?.message });
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Insights could not complete this request. Try again in a moment.' });
    }
  };

  router.get('/definitions', handle('definitions', async () => getDefinitions()));
  router.get('/cities', handle('cities', (_req, options) => getCities(run, options)));
  router.get('/overview', handle('overview', (req, options) => getOverview(run, req.query, options)));
  router.get('/losses', handle('losses', (req, options) => getLosses(run, req.query, options)));
  router.get('/trends', handle('trends', (req, options) => getTrends(run, req.query, options)));
  router.get('/rankings/cities', handle('city ranking', (req, options) => getCityRanking(run, req.query, options)));

  return router;
}
