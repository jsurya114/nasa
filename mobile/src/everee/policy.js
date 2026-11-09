// Rules for the separate Everee window (issue #242, PR C). Pure functions only, so they run (and are tested) without a phone.
//
// Everee's screens run in their OWN WebView, not in the NASA one: that WebView has no bridge, no nonce, no session token and no way to reach the NASA
// page. The NASA web page only asks the shell to open a link, and learns only that the window closed. Everything Everee shows can therefore not touch
// anything of NASA's.

const { originOf } = require("../bridge/protocol");

// The handler name Everee documents for a React Native WebView: the session is created with this name (the server does that for platform "native").
const EVENT_HANDLER_NAME = "ReactNativeWebView";
const EVEREE_HOST = /^(?:[a-z0-9-]+\.)*everee\.com$/i;
const MAX_EVENT_LENGTH = 4000;

// The only addresses the window may show: https on everee.com or one of its subdomains.
const isEvereeUrl = (url) => {
  const origin = originOf(url);
  if (!origin || !origin.startsWith("https://")) return false;
  const host = origin.slice("https://".length).replace(/:\d+$/, "");
  return EVEREE_HOST.test(host);
};

// A page inside the window asks to load `url`: allowed only for the Everee addresses. Everything else is refused, and nothing is handed to the phone.
const shouldLoad = (url) => isEvereeUrl(url);

const FINISHED = ["WORKER_ONBOARDING_COMPLETE", "DISMISS"];
const KNOWN = ["MESSAGE_PORT_REGISTERED", "WORKER_ONBOARDING_COMPLETE", "ONBOARDING_DOCUMENTS_COMPLETE", "CONTRACT_SIGNED", "DISMISS"];

// What a message from the Everee page means: "finished" (close the window), "error" (close and say so), or "ignore". The message is a JSON string with an
// eventType from Everee's list and this session's handler name; anything else is ignored. It never carries anything the shell acts on beyond closing.
const readEvent = (raw) => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_EVENT_LENGTH) return "ignore";
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return "ignore";
  }
  if (event === null || typeof event !== "object" || Array.isArray(event)) return "ignore";
  if (typeof event.eventType !== "string" || !KNOWN.includes(event.eventType)) return "ignore";
  if (event.eventHandlerName !== undefined && event.eventHandlerName !== EVENT_HANDLER_NAME) return "ignore";
  if (event.error === true) return "error";
  return FINISHED.includes(event.eventType) ? "finished" : "ignore";
};

module.exports = { EVENT_HANDLER_NAME, isEvereeUrl, readEvent, shouldLoad };
