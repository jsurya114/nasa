// The Everee webhook route (issue #31, part 2). Mounted at /webhooks/everee in app.js, before the JSON body parser, because the
// signature covers the exact bytes Everee sent.
import express from 'express';
import rateLimit from '../middlewares/rateLimit.js';
import { postEvereeWebhook } from '../controllers/payroll/evereeWebhookController.js';

const router = express.Router();
// The signature is checked before any database work, so a flood of bad requests is cheap; this keeps it small anyway.
router.use(rateLimit({ windowMs: 60 * 1000, max: 600 }));
router.post('/', postEvereeWebhook);

export default router;
