// Global sanitization and basic validation middleware
// - Recursively sanitizes req.body and req.query; URL parameters through sanitizeRouterParams
// - Strips script tags and dangerous characters from strings
// - Removes prototype pollution keys
// - Ensures only plain JSON-compatible types pass through

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Tags whose whole content is removed, and attributes that are unsafe inside any tag.
const BLOCK_TAGS = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const STRAY_TAGS = /<\/?(script|style|iframe|object|embed)\b[^>]*>/gi;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;
const ANY_TAG = /<[^<>]*>/g;
const EVENT_HANDLERS = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URL = /javascript:\s*/gi;

// Removes active HTML from a string and leaves ordinary text alone. Plain text that merely
// contains "on...=" or the word "javascript:" (such as "online=yes") is not touched; those
// patterns are removed only inside an HTML tag, or when the whole value starts like a URL.
function sanitizeString(str) {
  let s = String(str);
  // Repeat until nothing changes, so "<scr<script></script>ipt>" cannot rebuild a tag.
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(BLOCK_TAGS, "").replace(STRAY_TAGS, "").replace(HTML_COMMENTS, "");
    s = s.replace(ANY_TAG, (tag) => tag.replace(EVENT_HANDLERS, "").replace(JAVASCRIPT_URL, ""));
    s = s.replace(/^\s*javascript:\s*/i, "");
    if (s === before) break;
  }
  return s.trim();
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
      const nv = sanitizeValue(v, depth + 1);
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
