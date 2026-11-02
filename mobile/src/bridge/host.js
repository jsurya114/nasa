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

const BASE_CAPABILITIES = ["session", "openExternal"];

// info: { shellVersion, platform }
// session: from createSession. openExternal: async (https url) => void. webOrigin: the one page allowed to talk.
// nonce: the secret injected into the main frame for this page load (see protocol.js).
// push: from createPush, or left out when this build has no push support (the "push" capability is then not offered).
const createBridgeHost = ({ info, session, openExternal, webOrigin, nonce, push }) => {
  const tracker = new IdTracker();
  const capabilities = push ? [...BASE_CAPABILITIES, "push"] : BASE_CAPABILITIES;
  const requirePush = () => {
    if (!push) throw Object.assign(new Error("unsupported_action"), { code: "unsupported_action" });
    return push;
  };

  const run = async ({ action, payload }) => {
    switch (action) {
      case "app.hello":
        return { shellVersion: info.shellVersion, platform: info.platform, bridgeVersions: [BRIDGE_VERSION], capabilities };
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
      case "push.status":
        return await requirePush().status();
      case "push.requestPermission":
        return await requirePush().requestPermission();
      case "push.getToken":
        return await requirePush().getToken();
      case "push.openSettings":
        await requirePush().openSettings();
        return {};
      case "push.takePendingTap":
        return requirePush().takePendingTap();
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

module.exports = { BASE_CAPABILITIES, createBridgeHost };
