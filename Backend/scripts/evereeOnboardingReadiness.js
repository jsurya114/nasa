// Counts only. No provider requests, activation, backfill, session links or personal data.
// From Backend: node scripts/evereeOnboardingReadiness.js --city-id 123
import pool from '../config/db.js';
import { onboardingReadiness } from '../services/payments/everee/onboardingReadiness.js';
const args = process.argv.slice(2);
try {
  if (args.length !== 2 || args[0] !== '--city-id' || !/^\d+$/.test(args[1])) throw new Error('usage');
  // A local database operator reads the same report as the owner. No admin identity is fabricated or recorded.
  const result = await onboardingReadiness(pool, { role: 'superadmin' }, { cityId: args[1] });
  console.log(JSON.stringify({ cityId: result.cityId, environment: result.environment, configured: result.configured,
    onboardingEnabled: result.onboardingEnabled, enforced: result.enforced, checkedAt: result.checkedAt, summary: result.summary }, null, 2));
} catch {
  console.error('Readiness could not be loaded. Check the database settings, migrations and --city-id argument.');
  process.exitCode = 1;
} finally { await pool.end(); }
