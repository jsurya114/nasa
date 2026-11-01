import net from 'net';
import client from '../config/redis.js';
import HttpStatus from '../utils/statusCodes.js';
import { translateError, getLangFromRequest } from '../utils/backendI18n.js';

/**
 * Strict limits for the admin and driver login routes (issue #10).
 *
 * Three counters per 15 minute window, separate for each area:
 *  - per account and address: at most 5 attempts for one email from one address.
 *  - per account, any address: at most 20 attempts for one email. Stops an attack
 *    spread over many addresses. It is higher than the limit above on purpose, so
 *    a stranger cannot easily lock a real user out.
 *  - per address: at most 50 failed attempts from one address, over all emails.
 * A successful login clears the account counters and gives back the address count,
 * so normal use is never limited.
 *
 * THE ADDRESS is always req.ip. Nothing the client sends decides whether a limit
 * applies. Express builds req.ip from the TRUST_PROXY setting: behind N proxies
 * it takes the address those proxies saw, and ignores anything the client put in
 * X-Forwarded-For before them. Wrong TRUST_PROXY means wrong addresses (behind a
 * proxy, every user would look like one address), so in production the server
 * refuses to start until TRUST_PROXY is set (0 means "no proxy in front").
 */

const WINDOW_SECONDS = 15 * 60;
// While Redis reconnects, its client queues commands and never rejects them. Waiting longer than
// this for an answer means "Redis is down": the memory counters are used instead.
const REDIS_WAIT_MS = 500;
const MAX_ATTEMPTS_PER_ACCOUNT_AND_ADDRESS = 5;
const MAX_ATTEMPTS_PER_ACCOUNT = 20;
const MAX_FAILED_PER_ADDRESS = 50;

// Number of proxies in front of the app. 0 means none.
export const trustProxyHops = () => Math.max(0, parseInt(process.env.TRUST_PROXY, 10) || 0);

// Stops the server at start-up in production when TRUST_PROXY is missing or not a whole number.
export function assertTrustProxyConfigured() {
  if (process.env.NODE_ENV !== 'production') return;
  const value = process.env.TRUST_PROXY;
  if (value === undefined || !/^\d+$/.test(value.trim())) {
    throw new Error(
      'TRUST_PROXY must be set to the number of proxies in front of the app (0 if none, 1 behind a single hosting proxy). Login limits depend on it.'
    );
  }
}

// IPv4 stays as is; an IPv4-mapped IPv6 address becomes IPv4; other IPv6 addresses are
// grouped by their /64, because one customer is given a whole /64.
export function addressKeyPart(rawIp) {
  const ip = String(rawIp || 'unknown');
  const unmapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIPv4(unmapped)) return unmapped;
  if (!net.isIPv6(unmapped)) return ip;
  const [head, tail = ''] = unmapped.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const full = unmapped.includes('::')
    ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill('0'), ...tailParts]
    : headParts;
  return `${full.slice(0, 4).map((part) => part.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

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

// Runs a Redis job only when the connection is ready, and gives up after REDIS_WAIT_MS.
// A job that gives up may still run later, once Redis returns; at worst a counter is off by one.
async function withRedis(job) {
  if (!client.isReady) throw new Error('Redis is not connected');
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Redis did not answer in time')), REDIS_WAIT_MS);
  });
  try {
    return await Promise.race([job(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Adds one to the counter and returns { count, ttl }. The window starts at the first attempt.
async function bump(key, windowSeconds) {
  try {
    return await withRedis(async () => {
      const count = await client.incr(key);
      let ttl = await client.ttl(key);
      if (count === 1 || ttl < 0) {
        await client.expire(key, windowSeconds);
        ttl = windowSeconds;
      }
      return { count, ttl };
    });
  } catch (error) {
    console.log('redis Error: login limit is using memory:', error.message);
    return memoryBump(key, windowSeconds);
  }
}

async function clear(key) {
  memory.delete(key);
  try { await withRedis(() => client.del(key)); } catch { /* counter expires by itself */ }
}

async function giveBack(key) {
  const entry = memory.get(key);
  if (entry && entry.count > 0) entry.count -= 1;
  try { await withRedis(() => client.decr(key)); } catch { /* counter expires by itself */ }
}

/**
 * @param {'admin'|'driver'} area  each area has its own counters
 * @param {{windowSeconds?:number}} [options]
 */
export function loginRateLimit(area, options = {}) {
  const windowSeconds = options.windowSeconds ?? WINDOW_SECONDS;

  return async (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 150) : '';
    const address = addressKeyPart(req.ip);

    const addressKey = `rl:login:${area}:ip:${address}`;
    const accountAddressKey = email ? `rl:login:${area}:acct:${address}:${email}` : null;
    const accountKey = email ? `rl:login:${area}:acctall:${email}` : null;

    const [addr, accountAddress, account] = await Promise.all([
      bump(addressKey, windowSeconds),
      accountAddressKey ? bump(accountAddressKey, windowSeconds) : null,
      accountKey ? bump(accountKey, windowSeconds) : null,
    ]);

    const blocked = [
      addr.count > MAX_FAILED_PER_ADDRESS ? addr : null,
      accountAddress && accountAddress.count > MAX_ATTEMPTS_PER_ACCOUNT_AND_ADDRESS ? accountAddress : null,
      account && account.count > MAX_ATTEMPTS_PER_ACCOUNT ? account : null,
    ].filter(Boolean);

    if (blocked.length > 0) {
      const retryAfter = Math.max(...blocked.map((counter) => counter.ttl), 1);
      const lang = getLangFromRequest(req);
      res.set('Retry-After', String(retryAfter));
      return res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        message: translateError(lang, 'auth.tooManyAttempts', { minutes: Math.ceil(retryAfter / 60) }),
      });
    }

    // A successful login clears the account counters and gives back the address count.
    res.on('finish', () => {
      if (res.statusCode === HttpStatus.OK) {
        if (accountAddressKey) clear(accountAddressKey);
        if (accountKey) clear(accountKey);
        giveBack(addressKey);
      }
    });

    next();
  };
}

export default loginRateLimit;
