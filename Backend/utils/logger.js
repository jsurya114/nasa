/**
 * The one logger for the backend (issue #18).
 *
 *   logger.info('Server running', { port })
 *   logger.warn('Admin token is revoked')
 *   logger.error('Could not revoke token', error)
 *
 * It exists so that logs stay short and never carry secrets or personal data:
 *  - Values under keys that look sensitive (password, token, secret, authorization, cookie, body,
 *    email, phone, access code, ...) are replaced by "[redacted]", at any depth.
 *  - An Error is reduced to its name, message and code. The stack is printed only at level "debug".
 *  - Long text is cut, long lists and deep objects are shortened.
 *  - It never throws, whatever it is given.
 * Never pass a whole request, request body or database row on purpose; pass the few fields you need
 * (an id, a count, a path).
 *
 * LOG_LEVEL (error, warn, info, debug) sets what is printed. Default: "info" in production, "debug"
 * everywhere else.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_TEXT = 300;
const MAX_ITEMS = 10;
const MAX_DEPTH = 3;
const SENSITIVE_KEY = /pass(word|wd)?|token|secret|authorization|cookie|session|body|e-?mail|phone|access_?code|api_?key|signature|credential|otp/i;

function threshold() {
  const configured = LEVELS[String(process.env.LOG_LEVEL || '').toLowerCase()];
  if (configured !== undefined) return configured;
  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug;
}

function cut(text) {
  const s = String(text);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}...` : s;
}

function describeError(error) {
  const out = { error: error.name || 'Error', message: cut(error.message) };
  if (error.code !== undefined) out.code = cut(error.code);
  if (threshold() >= LEVELS.debug && error.stack) out.stack = cut(error.stack);
  return out;
}

// Returns a safe copy of any value: sensitive keys hidden, text cut, depth and size limited.
export function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return describeError(value);
  const type = typeof value;
  if (type === 'string') return cut(value);
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return String(value);
  if (type === 'function' || type === 'symbol') return `[${type}]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[invalid date]' : value.toISOString();
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[...]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => redact(item, depth + 1, seen));
    if (value.length > MAX_ITEMS) items.push(`[+${value.length - MAX_ITEMS} more]`);
    return items;
  }
  const out = {};
  for (const key of Object.keys(value).slice(0, MAX_ITEMS * 2)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(value[key], depth + 1, seen);
  }
  return out;
}

function write(level, message, meta) {
  try {
    if (LEVELS[level] > threshold()) return;
    let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${cut(message)}`;
    if (meta !== undefined) {
      const safe = redact(meta);
      const text = typeof safe === 'string' ? safe : JSON.stringify(safe);
      if (text !== undefined && text !== '{}') line += ` ${text}`;
    }
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(line);
  } catch {
    // Logging must never break a request.
  }
}

const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};

export default logger;
