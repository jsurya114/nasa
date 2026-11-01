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

// PASSWORDS KEEP THEIR OLD CLEANING, EXACTLY. Before this file changed, every password was cleaned by
// the rules below before it was hashed or compared, so some stored hashes stand for the cleaned text
// (for example a password that contained "onclick=x" was stored without it, and one with an HTML comment
// in it was stored without the comment, however long the comment). Cleaning passwords differently now
// would lock those people out. These four fields therefore give the same result as the old rules for
// every possible input, of any length. The old rules were regular expressions that a crafted input could
// make very slow (seconds for a few hundred KB, before login), so they are re-implemented below as
// passes that read the text once; a differential test against the original expressions checks that the
// two agree. Do not "improve" this without a migration (verify the old way, then re-hash).
const LEGACY_CREDENTIAL_KEYS = new Set(["password", "oldPassword", "newPassword", "confirmPassword"]);
// Tokens are never shown as HTML and cannot contain the old rules' patterns; they are only trimmed.
const TOKEN_KEYS = new Set(["refreshToken", "previousRefreshToken"]);

const isWordChar = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_";
const isSpace = (c) => /\s/.test(c);
// Same length as the input, so positions line up; the old expressions were case-insensitive in ASCII only.
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// Finds the next position >= pos of any of the needles. Positions only move forward, so a found position
// stays valid until pos passes it, and each needle is searched for across the text only once overall.
function makeFinder(lower, needles) {
  const cached = needles.map(() => -2); // -2 = not searched yet, -1 = no more occurrences
  return (pos) => {
    let best = null;
    needles.forEach((needle, k) => {
      if (cached[k] === -1) return;
      if (cached[k] < pos) cached[k] = lower.indexOf(needle, pos);
      if (cached[k] === -1) return;
      if (best === null || cached[k] < best.index) best = { index: cached[k], needle };
    });
    return best;
  };
}

// Old: s.replace(/<(a|b|..)[^>]*>[\s\S]*?<\/(a|b|..)>/gi, "")
// An opener "<name", then up to the first ">", then everything up to the first closer "</name>" of any
// listed name. If an opener has no ">" or no closer after it, no later opener has one either.
function removeBlocks(s, names) {
  const lower = asciiLower(s);
  const nextOpener = makeFinder(lower, names.map((n) => `<${n}`));
  const nextCloser = makeFinder(lower, names.map((n) => `</${n}>`));
  let out = "";
  let i = 0;
  while (i < s.length) {
    const opener = nextOpener(i);
    if (!opener) break;
    const gt = s.indexOf(">", opener.index + opener.needle.length);
    if (gt === -1) break;
    const closer = nextCloser(gt + 1);
    if (!closer) break;
    out += s.slice(i, opener.index);
    i = closer.index + closer.needle.length;
  }
  return out + s.slice(i);
}

// Old: s.replace(/on\w+\s*=\s*"[^"]*"/gi, ""), the same with '...', and with [^\s>]+ (variant "bare").
// "on" (any case) then at least one more word character, spaces, "=", spaces, then the value. Inside one
// run of word characters every "on" leads to the same end of the word, so a run is decided once and the
// leftmost "on" in it is the one that matches.
function removeHandlers(s, variant) {
  const quote = variant === "dq" ? '"' : "'";
  const lastQuote = variant === "bare" ? -1 : s.lastIndexOf(quote);
  const n = s.length;
  let out = "";
  let copied = 0;
  let p = 0;
  while (p < n) {
    if (!isWordChar(s[p])) {
      p++;
      continue;
    }
    let runEnd = p;
    while (runEnd < n && isWordChar(s[runEnd])) runEnd++;
    let at = -1;
    for (let i = p; i + 2 < runEnd; i++) {
      if ((s[i] === "o" || s[i] === "O") && (s[i + 1] === "n" || s[i + 1] === "N")) {
        at = i;
        break;
      }
    }
    if (at !== -1) {
      let j = runEnd;
      while (j < n && isSpace(s[j])) j++;
      if (s[j] === "=") {
        j++;
        while (j < n && isSpace(s[j])) j++;
        let end = -1;
        if (variant === "bare") {
          let k = j;
          while (k < n && !isSpace(s[k]) && s[k] !== ">") k++;
          if (k > j) end = k;
        } else if (s[j] === quote && lastQuote > j) {
          end = s.indexOf(quote, j + 1) + 1;
        }
        if (end !== -1) {
          out += s.slice(copied, at);
          copied = end;
          p = end;
          continue;
        }
      }
    }
    p = runEnd;
  }
  return out + s.slice(copied);
}

// Old: s.replace(/<!--([\s\S]*?)-->/g, "")
function removeComments(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf("<!--", i);
    if (start === -1) break;
    const end = s.indexOf("-->", start + 4);
    if (end === -1) break;
    out += s.slice(i, start);
    i = end + 3;
  }
  return out + s.slice(i);
}

function legacyCredentialClean(str) {
  let s = String(str);
  s = removeBlocks(s.replace(/<\/(script|style)>/gi, ""), ["script", "style"]);
  s = removeHandlers(s, "dq");
  s = removeHandlers(s, "sq");
  s = removeHandlers(s, "bare");
  s = s.replace(/javascript:\s*/gi, "");
  s = removeComments(s);
  s = removeBlocks(s.replace(/<\/(iframe|object|embed)>/gi, ""), ["iframe", "object", "embed"]);
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
