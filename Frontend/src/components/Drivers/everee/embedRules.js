// Pure rules for the embedded Everee screen (no React): what a session link and an event from the port must look like.
export const KNOWN_EVENTS = Object.freeze(["MESSAGE_PORT_REGISTERED", "WORKER_ONBOARDING_COMPLETE", "ONBOARDING_DOCUMENTS_COMPLETE", "CONTRACT_SIGNED", "DISMISS"]);
export const REGISTER_TIMEOUT_MS = 10_000;
const EVEREE_HOST = /(^|\.)everee\.com$/i;

// The session as the server returned it, checked again here: https, an Everee host, and the origin that goes with the link.
export const checkSession = (session) => {
  try {
    const url = new URL(String(session?.url ?? ""));
    if (url.protocol !== "https:" || !EVEREE_HOST.test(url.hostname)) return null;
    if (session.origin && session.origin !== url.origin) return null;
    return { src: url.toString(), origin: url.origin };
  } catch {
    return null;
  }
};

// One event from the port: a plain object with a known type and this session's handler name, or null.
export const readEvent = (data, handlerName) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (typeof data.eventType !== "string" || !KNOWN_EVENTS.includes(data.eventType)) return null;
  if (data.eventHandlerName !== undefined && data.eventHandlerName !== handlerName) return null;
  return { type: data.eventType, error: data.error === true, errorCode: typeof data.errorCode === "string" ? data.errorCode.slice(0, 20) : null };
};

