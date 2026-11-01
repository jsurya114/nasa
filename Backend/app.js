import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import pool from './config/db.js';
import adminRoutes from './routes/adminRoutes.js'
import driverRoutes from "./routes/driverRoutes.js"
import cookieParser from 'cookie-parser';
import sanitizeMiddleware from './middlewares/sanitize.js';
import { notFound, errorHandler } from './middlewares/errorHandler.js';
import rateLimit from './middlewares/rateLimit.js';
import { trustProxyHops, assertTrustProxyConfigured } from './middlewares/loginRateLimit.js';
import { initializeAvailabilityResetCron } from './utils/availabilityCronJob.js';
import { assertAuthSecrets } from './services/jwtservice.js';

dotenv.config()

// Stop at start-up, with a clear message, if a token secret is missing or shared.
assertAuthSecrets()

const PORT = process.env.PORT;
const app = express();

// How many proxies sit in front of the app (TRUST_PROXY: 0 for none, 1 behind a single hosting proxy).
// Login limits use the client address, which is only correct when this matches reality.
assertTrustProxyConfigured();
app.set('trust proxy', trustProxyHops() || false);

// CORS configuration - credentials set to false since we're using localStorage
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: false
}))

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(cookieParser());
// Serve static uploads (e.g., access code images)
app.use('/uploads', express.static('uploads'));
// Global input sanitization for all requests
app.use(sanitizeMiddleware);
// Global rate limit (per IP per base path)
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

initializeAvailabilityResetCron()

app.use('/admin', (req, _, next) => {
  // Log method and path only. Never the Authorization header or the query string.
  console.log(req.method, req.originalUrl.split('?')[0], '**', Date().toString().slice(16, 25))
  next()
}, adminRoutes);

app.use('/driver', (req, _, next) => {
  // Log method and path only. Never the Authorization header or the query string.
  console.log(req.method, req.originalUrl.split('?')[0], '**', Date().toString().slice(16, 25))
  next()
}, driverRoutes)

// 404 for unmatched routes
app.use(notFound);
// Centralized error handler (must be last)
app.use(errorHandler);

app.listen(PORT, async () => {
  const { rows } = await pool.query('SELECT NOW()')
  console.log('✅ Database connected')
  console.log('🕒 DB Time:', rows[0].now)
  console.log(`Server running on http://localhost:${PORT}`)
})