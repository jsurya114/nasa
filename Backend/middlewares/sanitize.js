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

// PASSWORDS KEEP THEIR OLD CLEANING. Before this file changed, every password was cleaned by the rules
// below before it was hashed or compared, so some stored hashes stand for the cleaned text (for example
// a password that contained "onclick=x" was stored without it). Cleaning passwords differently now
// would lock those people out. These four fields therefore keep exactly the old rules, byte for byte,
// until passwords are migrated on purpose (verify the old way, then re-hash). Do not "improve" this
// function without that migration. Only the first LEGACY_CLEAN_LIMIT characters are cleaned, because
// the old rules can be made very slow by a huge input and bcrypt only reads the first 72 bytes.
const LEGACY_CLEAN_LIMIT = 2000;
const LEGACY_CREDENTIAL_KEYS = new Set(["password", "oldPassword", "newPassword", "confirmPassword"]);
// Tokens are never shown as HTML and cannot contain the old rules' patterns; they are only trimmed.
const TOKEN_KEYS = new Set(["refreshToken", "previousRefreshToken"]);

function legacyCredentialClean(str) {
  const whole = String(str);
  let s = whole.length > LEGACY_CLEAN_LIMIT ? whole.slice(0, LEGACY_CLEAN_LIMIT) : whole;
  const rest = whole.length > LEGACY_CLEAN_LIMIT ? whole.slice(LEGACY_CLEAN_LIMIT) : "";
  s = s.replace(/<\/(script|style)>/gi, "").replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, "");
  s = s.replace(/on\w+\s*=\s*"[^"]*"/gi, "");
  s = s.replace(/on\w+\s*=\s*'[^']*'/gi, "");
  s = s.replace(/on\w+\s*=\s*[^\s>]+/gi, "");
  s = s.replace(/javascript:\s*/gi, "");
  s = s.replace(/<!--([\s\S]*?)-->/g, "");
  s = s.replace(/<\/(iframe|object|embed)>/gi, "").replace(/<(iframe|object|embed)[^>]*>[\s\S]*?<\/(iframe|object|embed)>/gi, "");
  return (s + rest).trim();
}

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
      let nv;
      if (typeof v === "string" && LEGACY_CREDENTIAL_KEYS.has(k)) nv = legacyCredentialClean(v);
      else if (typeof v === "string" && TOKEN_KEYS.has(k)) nv = v.trim();
      else nv = sanitizeValue(v, depth + 1);
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
