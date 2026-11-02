// The shell's side of the bridge: checks each message and runs the action. No React Native imports; the phone
// features are passed in, so the rules are tested with fakes.

const {
  BRIDGE_VERSION,
  IdTracker,
  errorReply,
  isTrustedOrigin,
  okReply,
  parseMessage,
} = require("./protocol");

const CAPABILITIES = ["session", "openExternal"];

// info: { shellVersion, platform }
// session: from createSession. openExternal: async (https url) => void. webOrigin: the one page allowed to talk.
// nonce: the secret injected into the main frame for this page load (see protocol.js).
const createBridgeHost = ({ info, session, openExternal, webOrigin, nonce }) => {
  const tracker = new IdTracker();

  const run = async ({ action, payload }) => {
    switch (action) {
      case "app.hello":
        return { shellVersion: info.shellVersion, platform: info.platform, bridgeVersions: [BRIDGE_VERSION], capabilities: CAPABILITIES };
      case "session.get":
        return { accessToken: await session.get(payload.area) };
      case "session.set":
        await session.set(payload.area, payload);
        return {};
      case "session.refresh":
        return { accessToken: await session.refresh(payload.area) };
      case "session.clear":
        await session.clear(payload.area);
        return {};
      case "link.openExternal":
        await openExternal(payload.url);
        return {};
      default:
        throw Object.assign(new Error("unsupported_action"), { code: "unsupported_action" });
    }
  };

  // raw: the string from the WebView. pageUrl: the address of the page that sent it.
  // Returns the reply to send, or null when the message cannot even be answered (no usable id).
  return async (raw, pageUrl) => {
    // A page that is not the NASA web app gets no answer at all, not even an error
    if (!isTrustedOrigin(pageUrl, webOrigin)) return null;

    const parsed = parseMessage(raw, tracker, nonce);
    if (!parsed.ok) return parsed.id ? errorReply(parsed.id, parsed.error) : null;

    try {
      return okReply(parsed.message.id, await run(parsed.message));
    } catch (error) {
      // Only short codes go back to the page, never messages that could hold tokens or URLs
      const code = typeof error?.code === "string" && /^[a-z_]{1,32}$/.test(error.code) ? error.code : "native_error";
      return errorReply(parsed.message.id, code);
    }
  };
};

module.exports = { CAPABILITIES, createBridgeHost };
