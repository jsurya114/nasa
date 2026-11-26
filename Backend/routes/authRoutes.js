import express from 'express';
import authController from '../controllers/authController.js';
import { loginRateLimit } from '../middlewares/loginRateLimit.js';

// The one sign-in for every account. The admin and driver areas keep their own refresh and logout routes.
// Each attempt counts against BOTH existing login limits, so this route gives no extra guesses beyond what
// /admin/login and /driver/login already allow. A success gives back only the counters of the area signed in to.
const SHARED = { sharedRoute: true };
const router = express.Router();
router.post('/login', loginRateLimit('admin', SHARED), loginRateLimit('driver', SHARED), authController.Login);

export default router;
