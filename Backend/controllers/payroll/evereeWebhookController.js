// HTTP side of the Everee webhook (issue #31, part 2). Public: Everee calls it, so there is no sign-in; the signature is the proof
// (see webhookService.js). The body is the raw bytes (app.js mounts express.raw for this path before any JSON parsing).

import pool from '../../config/db.js';
import logger from '../../utils/logger.js';
import { receiveEvent } from '../../services/payments/everee/webhookService.js';

export const postEvereeWebhook = async (req, res) => {
  try {
    const { status, body } = await receiveEvent(pool, { rawBody: req.body, headers: req.headers });
    return res.status(status).json(body);
  } catch (error) {
    logger.error('Everee webhook failed', { message: error.message });
    return res.status(500).json({ message: 'could not process the event; please deliver it again' });
  }
};
