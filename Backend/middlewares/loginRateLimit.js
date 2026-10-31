import client from '../config/redis.js';
import HttpStatus from '../utils/statusCodes.js';
import { translateError, getLangFromRequest } from '../utils/backendI18n.js';

/**
 * Strict limits for the admin and driver login routes (issue #10).
 *
 * Two limits, counted per 15 minute window:
 *  - per account: at most 5 attempts for one email from one address.
 *  - per address: at most 50 failed attempts from one address, over all emails.
 * A successful login clears the account counter and gives back the address count,
 * so normal use is never limited.
 *
 * HOW THE ADDRESS IS KNOWN. Behind a proxy (such as the host's load balancer) the
 * address Express sees is the proxy's, so every user would look the same. Set
 * TRUST_PROXY to the number of proxies in front of the app (1 for a single
 * hosting proxy). Until it is set, a request that carries X-Forwarded-For is
 * treated as "address not trusted": the per-address limit is skipped, so one
 * attacker cannot lock every user out, and only the per-account limit applies.
 */

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS_PER_ACCOUNT = 5;
const MAX_FAILED_PER_ADDRESS = 50;

// Number of proxies in front of the app. 0 means none, or not configured.
export const trustProxyHops = () => Math.max(0, parseInt(process.env.TRUST_PROXY, 10) || 0);

// Fallback counters, used only while Redis is unavailable: key -> { count, resetAt }.
const memory = new Map();

const memoryBump = (key, windowSeconds) => {
  const now = Date.now();
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowSeconds * 1000 };
    memory.set(key, entry);
  }
  entry.count += 1;
  return { count: entry.count, ttl: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
};

// Adds one to the counter and returns { count, ttl }. The window starts at the first attempt.
async function bump(key, windowSeconds) {
  try {
    const count = await client.incr(key);
    let ttl = await client.ttl(key);
    if (count === 1 || ttl < 0) {
      await client.expire(key, windowSeconds);
      ttl = windowSeconds;
    }
    return { count, ttl };
  } catch (error) {
    console.log('redis Error: login limit is using memory:', error.message);
    return memoryBump(key, windowSeconds);
  }
}

async function clear(key) {
  memory.delete(key);
  try { await client.del(key); } catch { /* counter expires by itself */ }
}

async function giveBack(key) {
  const entry = memory.get(key);
  if (entry && entry.count > 0) entry.count -= 1;
  try { await client.decr(key); } catch { /* counter expires by itself */ }
}

/**
 * @param {'admin'|'driver'} area  each area has its own counters
 * @param {{windowSeconds?:number, maxPerAccount?:number, maxFailedPerAddress?:number}} [options]
 */
export function loginRateLimit(area, options = {}) {
  const windowSeconds = options.windowSeconds ?? WINDOW_SECONDS;
  const maxPerAccount = options.maxPerAccount ?? MAX_ATTEMPTS_PER_ACCOUNT;
  const maxFailedPerAddress = options.maxFailedPerAddress ?? MAX_FAILED_PER_ADDRESS;

  return async (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 150) : '';

    // Behind an unconfigured proxy the address is the proxy's, not the user's.
    const addressTrusted = trustProxyHops() > 0 || !req.headers['x-forwarded-for'];
    const address = addressTrusted ? String(req.ip || 'unknown') : 'shared';

    const accountKey = email ? `rl:login:${area}:acct:${address}:${email}` : null;
    const addressKey = addressTrusted ? `rl:login:${area}:ip:${address}` : null;

    const [account, addr] = await Promise.all([
      accountKey ? bump(accountKey, windowSeconds) : null,
      addressKey ? bump(addressKey, windowSeconds) : null,
    ]);

    const overAccount = account && account.count > maxPerAccount;
    const overAddress = addr && addr.count > maxFailedPerAddress;

    if (overAccount || overAddress) {
      const retryAfter = Math.max(overAccount ? account.ttl : 0, overAddress ? addr.ttl : 0, 1);
      const lang = getLangFromRequest(req);
      res.set('Retry-After', String(retryAfter));
      return res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        message: translateError(lang, 'auth.tooManyAttempts', { minutes: Math.ceil(retryAfter / 60) }),
      });
    }

    // A successful login clears the account counter and gives back the address count.
    res.on('finish', () => {
      if (res.statusCode === HttpStatus.OK) {
        if (accountKey) clear(accountKey);
        if (addressKey) giveBack(addressKey);
      }
    });

    next();
  };
}

export default loginRateLimit;
