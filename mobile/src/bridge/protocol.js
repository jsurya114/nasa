// Rules for messages between the NASA web app and this shell (docs/MOBILE_APP_DESIGN.md, section 4).
// Pure functions only, so they run (and are tested) without a phone.

const BRIDGE_VERSION = 1;
const REPLY_EVENT = "nasa-native-reply";
const EVENT_EVENT = "nasa-native-event";
const AREAS = ["admin", "driver"];

const MAX_MESSAGE_LENGTH = 20000;
const MAX_TOKEN_LENGTH = 4096;
const MAX_URL_LENGTH = 2048;
const MAX_REMEMBERED_IDS = 500;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isToken = (value) => typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH;
const hasOnly = (payload, keys) => Object.keys(payload).every((key) => keys.includes(key));

// The part of a URL before the path, for example "https://app.example.com". Null if it is not http(s).
// Written by hand because React Native's URL class does not implement `origin`.
const originOf = (url) => {
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return null;
  const match = /^(https?:\/\/)([^/?#\s]+)/i.exec(url);
  if (!match || match[2].includes("@")) return null;
  return `${match[1]}${match[2]}`.toLowerCase();
};

const isHttpsUrl = (url) => originOf(url)?.startsWith("https://") === true;

const EVEREE_HOST = /^(?:[a-z0-9-]+\.)*everee\.com$/i;
const isEvereeHost = (url) => {
  const origin = originOf(url);
  if (!origin || !origin.startsWith("https://")) return false;
  return EVEREE_HOST.test(origin.slice("https://".length).replace(/:\d+$/, ""));
};

// True only when the page's address is exactly the configured web origin.
const isTrustedOrigin = (url, webOrigin) => {
  const origin = originOf(url);
  return origin !== null && origin === String(webOrigin).toLowerCase();
};

// Each action the shell implements, and what its payload may contain. An action not listed here is refused,
// including those the contract names but this shell version does not support yet.
const PAYLOAD_RULES = {
  "app.hello": (p) => hasOnly(p, ["bridgeVersions"]) && (p.bridgeVersions === undefined || (Array.isArray(p.bridgeVersions) && p.bridgeVersions.every(Number.isInteger))),
  "session.get": (p) => hasOnly(p, ["area"]) && AREAS.includes(p.area),
  "session.set": (p) => hasOnly(p, ["area", "accessToken", "refreshToken"]) && AREAS.includes(p.area) && isToken(p.accessToken) && isToken(p.refreshToken),
  "session.refresh": (p) => hasOnly(p, ["area"]) && AREAS.includes(p.area),
  "session.clear": (p) => hasOnly(p, ["area"]) && AREAS.includes(p.area),
  "link.openExternal": (p) => hasOnly(p, ["url"]) && isHttpsUrl(p.url),
  // Opens Everee's own screens in a separate window (see src/everee). Only an https address on everee.com is accepted.
  "everee.open": (p) => hasOnly(p, ["url"]) && isEvereeHost(p.url),
  "push.status": (p) => hasOnly(p, []),
  "push.requestPermission": (p) => hasOnly(p, []),
  "push.getToken": (p) => hasOnly(p, []),
  "push.openSettings": (p) => hasOnly(p, []),
  "push.takePendingTap": (p) => hasOnly(p, []),
};

const SUPPORTED_ACTIONS = Object.keys(PAYLOAD_RULES);

// Remembers recent request ids so the same id cannot be used twice.
class IdTracker {
  constructor(limit = MAX_REMEMBERED_IDS) {
    this.limit = limit;
    this.ids = new Set();
  }

  // Returns false if the id was already used.
  remember(id) {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.limit) this.ids.delete(this.ids.values().next().value);
    return true;
  }
}

// Turns the raw string from the WebView into a checked message, or says why it was refused.
// `nonce` is the secret the shell put into the main frame for this page load. A message without it comes from
// somewhere else (for example a frame from another site on Android) and gets no answer at all. With no nonce
// to check against, every message is refused.
// Returns { ok: true, message } or { ok: false, error, id? }.
const parseMessage = (raw, tracker, nonce) => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_MESSAGE_LENGTH) return { ok: false, error: "bad_request" };

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return { ok: false, error: "bad_request" };
  }
  if (!isPlainObject(message)) return { ok: false, error: "bad_request" };

  const { v, id, action, payload } = message;
  if (typeof nonce !== "string" || nonce.length < 16 || message.nonce !== nonce) return { ok: false, error: "untrusted_frame" };
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return { ok: false, error: "bad_request" };
  if (v !== BRIDGE_VERSION) return { ok: false, error: "unsupported_version", id };
  if (typeof action !== "string" || !SUPPORTED_ACTIONS.includes(action)) return { ok: false, error: "unsupported_action", id };
  if (!isPlainObject(payload) || !PAYLOAD_RULES[action](payload)) return { ok: false, error: "bad_request", id };
  if (!tracker.remember(id)) return { ok: false, error: "replayed_id", id };

  return { ok: true, message: { v, id, action, payload } };
};

const okReply = (id, data = {}) => ({ v: BRIDGE_VERSION, id, ok: true, data });
const errorReply = (id, error) => ({ v: BRIDGE_VERSION, id, ok: false, error });

// The script the shell injects to answer the page. The reply is encoded twice so nothing in it can end the string.
const replyScript = (reply) =>
  `window.dispatchEvent(new CustomEvent(${JSON.stringify(REPLY_EVENT)}, { detail: ${JSON.stringify(JSON.stringify(reply))} })); true;`;

// A nudge from the shell to the page that something happened in the app, for example a tapped notification. It carries
// no data: the page asks for details with a normal bridge action, which the nonce and origin checks protect.
const eventScript = (type) =>
  `window.dispatchEvent(new CustomEvent(${JSON.stringify(EVENT_EVENT)}, { detail: ${JSON.stringify(JSON.stringify({ v: BRIDGE_VERSION, type }))} })); true;`;

module.exports = {
  AREAS,
  BRIDGE_VERSION,
  IdTracker,
  SUPPORTED_ACTIONS,
  errorReply,
  eventScript,
  isHttpsUrl,
  isTrustedOrigin,
  okReply,
  originOf,
  parseMessage,
  replyScript,
};
