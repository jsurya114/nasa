// Web side of the bridge to the NASA mobile app shell (see docs/MOBILE_APP_DESIGN.md, section 4).
//
// In a normal browser nothing here does anything: isNativeShell() is false and callNative() rejects.
// Inside the app, the web page sends one JSON message per request and waits for the reply with the same id.

export const BRIDGE_VERSION = 1;

// Actions the shell may support. Anything else is refused here, before it is sent.
export const ACTIONS = Object.freeze([
  "app.hello",
  "session.get",
  "session.set",
  "session.refresh",
  "session.clear",
  "media.pickImages",
  "file.pickDocument",
  "file.share",
  "link.openExternal",
  "push.status",
  "push.requestPermission",
  "push.getToken",
  "push.openSettings",
  "push.takePendingTap",
]);

const REPLY_EVENT = "nasa-native-reply";
const DEFAULT_TIMEOUT_MS = 10000;

export class BridgeError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "BridgeError";
    this.code = code;
  }
}

const pending = new Map();
let listening = false;
let helloPromise = null;

const getHost = () => (typeof window === "undefined" ? undefined : window.ReactNativeWebView);

// True only inside the NASA app's WebView.
export const isNativeShell = () => typeof getHost()?.postMessage === "function";

const newId = () => {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// The shell answers with window.dispatchEvent(new CustomEvent("nasa-native-reply", { detail: "<json>" })).
// A reply is used only if its id matches a request this page made and is still waiting.
const handleReply = (event) => {
  let message;
  try {
    message = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
  } catch {
    return;
  }
  if (!message || message.v !== BRIDGE_VERSION || typeof message.id !== "string") return;

  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);

  if (message.ok === true) {
    request.resolve(message.data);
  } else {
    request.reject(new BridgeError(typeof message.error === "string" ? message.error : "native_error"));
  }
};

const startListening = () => {
  if (listening) return;
  window.addEventListener(REPLY_EVENT, handleReply);
  listening = true;
};

// Sends one action to the shell and resolves with its reply data.
// Rejects with BridgeError: "not_in_app", "unsupported_action", "timeout", or the shell's own error code.
export const callNative = (action, payload = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  if (!isNativeShell()) return Promise.reject(new BridgeError("not_in_app"));
  if (!ACTIONS.includes(action)) return Promise.reject(new BridgeError("unsupported_action"));

  startListening();
  const id = newId();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new BridgeError("timeout"));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });

    try {
      // The shell puts a secret for this page load into the main frame only. Frames from other sites cannot read
      // it, so the shell can refuse their messages.
      const nonce = typeof window.__NASA_BRIDGE_NONCE__ === "string" ? window.__NASA_BRIDGE_NONCE__ : undefined;
      getHost().postMessage(JSON.stringify({ v: BRIDGE_VERSION, id, nonce, action, payload }));
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      reject(new BridgeError("send_failed"));
    }
  });
};

// Asks the shell what it can do. Cached for the life of the page. Resolves to null outside the app,
// or if the shell does not answer, so callers can simply fall back to the browser behaviour.
export const getCapabilities = () => {
  if (!isNativeShell()) return Promise.resolve(null);
  if (!helloPromise) {
    helloPromise = callNative("app.hello", { bridgeVersions: [BRIDGE_VERSION] })
      .then((data) => {
        const versions = Array.isArray(data?.bridgeVersions) ? data.bridgeVersions : [];
        if (!versions.includes(BRIDGE_VERSION)) return null;
        return {
          shellVersion: typeof data.shellVersion === "string" ? data.shellVersion : "unknown",
          platform: typeof data.platform === "string" ? data.platform : "unknown",
          capabilities: Array.isArray(data.capabilities) ? data.capabilities.filter((c) => typeof c === "string") : [],
        };
      })
      .catch(() => null);
  }
  return helloPromise;
};

// True only if the shell is present and lists this capability.
export const hasCapability = async (name) => {
  const info = await getCapabilities();
  return Boolean(info?.capabilities.includes(name));
};
