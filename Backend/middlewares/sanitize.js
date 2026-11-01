// Global sanitization and basic validation middleware
// - Recursively sanitizes req.body and req.query; URL parameters through sanitizeRouterParams
// - Removes the "<" that starts an HTML tag, so no tag can be formed (see removeTagStarts)
// - Removes prototype pollution keys
// - Ensures only plain JSON-compatible types pass through

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// HTML tags cannot start without a "<" followed by a letter, "/", "!" or "?". Instead of trying to read
// tags the way a browser does (which always leaves some difference to exploit), this removes every
// such "<" and leaves the rest of the text alone. Without that "<" no browser starts a tag, whatever
// quotes, slashes or odd characters follow, so there is nothing to bypass. A run of "<" before the
// tag start goes together ("<<img" cannot leave "<img"). One pass over the text, no backtracking.
function removeTagStarts(s) {
  if (!s.includes("<")) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "<") {
      const next = s.indexOf("<", i);
      const stop = next === -1 ? s.length : next;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] === "<") j++;
    const startsTag = j < s.length && /[a-zA-Z/!?]/.test(s[j]);
    if (!startsTag) out += s.slice(i, j);
    i = j;
  }
  return out;
}

// Removes the way into active HTML from a string and leaves everything else alone: ordinary text,
// addresses, "&", quotes, "=", and "<" or ">" in sentences ("2 < 4") are kept. A value that starts
// with "javascript:" (a link) loses that prefix. This is a safety net, not the main protection: the
// screens must still escape what they show, and queries use parameters.
function sanitizeString(str) {
  const s = removeTagStarts(String(str)).replace(/^\s*javascript:\s*/i, "");
  return s.trim();
}

// Passwords and tokens are never shown as HTML, only hashed or compared, and people may already use
// "<" in a password. They keep the surrounding-space trimming they always had and nothing else.
const SECRET_KEYS = new Set(["password", "oldPassword", "newPassword", "confirmPassword", "refreshToken", "previousRefreshToken"]);

function sanitizeValue(value, depth = 0) {
  if (depth > 50) return undefined; // prevent cyclic/too deep structures
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1)).filter((v) => v !== undefined);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      const nk = sanitizeString(k);
      const nv = SECRET_KEYS.has(k) && typeof v === "string" ? v.trim() : sanitizeValue(v, depth + 1);
      if (nv !== undefined) out[nk] = nv;
    }
    return out;
  }
  // Drop unsupported types (functions, symbols, BigInt, dates, buffers)
  return undefined;
}

const isNonEmptyObject = (value) => value && typeof value === "object" && Object.keys(value).length > 0;

// Express 5 rebuilds req.query on every read, so assigning into it has no effect. The cleaned
// copy is put on the request as its own property instead, which later reads return.
function setRequestQuery(req, cleaned) {
  Object.defineProperty(req, "query", { value: cleaned, writable: true, configurable: true, enumerable: true });
}

export default function sanitizeMiddleware(req, res, next) {
  try {
    if (isNonEmptyObject(req.body)) {
      req.body = sanitizeValue(req.body);
    }
    if (isNonEmptyObject(req.query)) {
      setRequestQuery(req, sanitizeValue(req.query));
    }

    // Basic size guard
    const MAX_BODY_SIZE_KEYS = 5000;
    if (req.body && isPlainObject(req.body) && Object.keys(req.body).length > MAX_BODY_SIZE_KEYS) {
      return res.status(413).json({ error: "Request body too large" });
    }

    next();
  } catch (err) {
    next(err);
  }
}

// URL parameters (/:id) only exist once a route has matched, so they cannot be cleaned by the
// global middleware. Each router registers this for every parameter name its routes use.
export const PARAM_NAMES = ["id", "driverId", "driver_id", "journey_id"];

export function sanitizeParam(req, res, next, value, name) {
  req.params[name] = sanitizeString(value);
  next();
}

export function sanitizeRouterParams(router) {
  PARAM_NAMES.forEach((name) => router.param(name, sanitizeParam));
}
