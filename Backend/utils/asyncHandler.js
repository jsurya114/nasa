import logger from './logger.js';

/**
 * Wraps a request handler so it does not need its own try/catch (issue #20).
 *
 *   export const getThing = asyncHandler(async (req, res) => {
 *     ...
 *     res.json(thing);
 *   }, {
 *     log: 'getThing error',
 *     respond: (error, req, res) => res.status(500).json({ error: error.message }),
 *   });
 *
 * If the handler throws or rejects, the wrapper logs `log` with the error, then calls `respond` so the
 * answer is exactly the one the handler's own catch block used to send. Without `respond` the error is
 * passed on to the shared error handler (`next(error)`).
 *
 * The wrapper does not change what a handler does: same status codes, same JSON.
 */
export default function asyncHandler(handler, { log = 'Request failed', respond } = {}) {
  return async function wrappedHandler(req, res, next) {
    try {
      await handler(req, res, next);
    } catch (error) {
      logger.error(log, error);
      if (respond) return respond(error, req, res, next);
      return next(error);
    }
  };
}
