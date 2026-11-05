/**
 * Mounts the NASA Insights connector on the existing Express app (issue #220). Called once from app.js, before the global
 * JSON parser, sanitizer and rate limit, so MCP messages are never rewritten and the connector keeps its own limits.
 *
 * Off unless MCP_ENABLED=true and the settings are valid. A problem turns the connector off and is logged; it never
 * stops the rest of NASA from starting.
 */
import { loadMcpConfig } from './config.js';
import { createMcpRouter } from './router.js';
import { loginRateLimit } from '../../middlewares/loginRateLimit.js';
import logger from '../../utils/logger.js';

export function mountMcp(app, { env = process.env, db } = {}) {
  let config;
  try {
    config = loadMcpConfig(env);
  } catch (error) {
    logger.error('NASA Insights connector is off: configuration could not be read', error);
    return { enabled: false };
  }
  if (!config.enabled) {
    if (config.reason) logger.error(`NASA Insights connector is off: ${config.reason}`);
    return { enabled: false };
  }
  try {
    const { router } = createMcpRouter({ config, db, loginLimiter: loginRateLimit('admin') });
    app.use(router);
    logger.info('NASA Insights connector is on', { resource: config.resourceUrl });
    return { enabled: true, config };
  } catch (error) {
    logger.error('NASA Insights connector is off: it could not start', error);
    return { enabled: false };
  }
}
