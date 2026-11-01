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

// Tags whose whole content is removed.
const BLOCK_TAGS = new Set(["script", "style", "iframe", "object", "embed"]);
const TAG_NAME = /<\/?([a-z][a-z0-9]*)/y;
// Inside a tag: event handler attributes (after a space, "/", or a closing quote, like a browser reads
// them) and javascript: URLs (browsers ignore tabs and line breaks inside the word).
const EVENT_HANDLERS = /(?<=[\s/"'`])on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const JAVASCRIPT_URL = /j[\t\n\r ]*a[\t\n\r ]*v[\t\n\r ]*a[\t\n\r ]*s[\t\n\r ]*c[\t\n\r ]*r[\t\n\r ]*i[\t\n\r ]*p[\t\n\r ]*t[\t\n\r ]*:[\t\n\r ]*/gi;

// Where the tag starting at `start` ends: just after the first ">" outside quotes, just before the next
// "<" outside quotes, or the end of the text. Whatever follows is scanned as its own tag, so no part of
// the text is skipped.
function tagEnd(s, start) {
  let quote = "";
  for (let j = start + 1; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === ">") {
      return j + 1;
    } else if (c === "<") {
      return j; // a new "<" starts the next tag, which is then looked at on its own
    }
  }
  return s.length;
}

// Walks the text once and, at each tag ("<" followed by a letter, "/", "!" or "?"):
//  - drops comments, and script/style/iframe/object/embed tags with everything up to their closing tag
//    (to the end of the text when it is never closed);
//  - removes event handlers and javascript: URLs from every other tag.
// Each character is looked at a bounded number of times, so hostile input cannot make it slow.
function cleanTags(s) {
  const lower = s.replace(/[A-Z]/g, (c) => c.toLowerCase()); // same length as s
  let out = "";
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf("<", i);
    if (start === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, start);
    if (!/[a-zA-Z/!?]/.test(s[start + 1] ?? "")) {
      out += "<";
      i = start + 1;
      continue;
    }
    if (lower.startsWith("<!--", start)) {
      const close = lower.indexOf("-->", start + 4);
      i = close === -1 ? s.length : close + 3;
      continue;
    }
    TAG_NAME.lastIndex = start;
    const name = TAG_NAME.exec(lower)?.[1];
    const end = tagEnd(s, start);
    if (name && BLOCK_TAGS.has(name)) {
      if (s[start + 1] === "/") {
        i = end;
      } else {
        const close = lower.indexOf(`</${name}`, end);
        i = close === -1 ? s.length : tagEnd(s, close);
      }
      continue;
    }
    out += s.slice(start, end).replace(EVENT_HANDLERS, "").replace(JAVASCRIPT_URL, "");
    i = end;
  }
  return out;
}

// Removes active HTML from a string and leaves ordinary text alone. Plain text that merely
// contains "on...=" or the word "javascript:" (such as "online=yes") is not touched; those
// patterns are removed only inside an HTML tag, or when the whole value starts like a URL.
// This is a safety net, not the main protection: the screens must still escape what they show,
// and queries use parameters.
function sanitizeString(str) {
  let s = String(str);
  // Repeat until nothing changes, so "<scr<script></script>ipt>" cannot rebuild a tag.
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = cleanTags(s);
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
