// Holds the sign-in session for the app (docs/MOBILE_APP_DESIGN.md, section 3).
//
// The refresh token lives only in the phone's secure storage (Keychain / Keystore). The web page never sees it.
// The access token is short-lived and kept in memory. The storage and the network are passed in, so this file
// has no React Native imports and is tested with fakes.

const { AREAS } = require("./bridge/protocol");

const REFRESH_TIMEOUT_MS = 15000;
const keyFor = (area) => `nasa.refreshToken.${area}`;

class SessionError extends Error {
  constructor(code) {
    super(code);
    this.name = "SessionError";
    this.code = code;
  }
}

// storage: { getItem(key), setItem(key, value), deleteItem(key) } (async)
// request: async (path, { token, body }) => { status, data }; rejects on network failure or timeout
const createSession = ({ storage, request }) => {
  const accessTokens = { admin: null, driver: null };
  const refreshing = new Map();
  // Goes up on every sign-in and sign-out, so a slow answer from before the change is dropped.
  const generation = { admin: 0, driver: 0 };

  const assertArea = (area) => {
    if (!AREAS.includes(area)) throw new SessionError("bad_request");
  };

  const refresh = (area) => {
    assertArea(area);
    if (refreshing.has(area)) return refreshing.get(area);

    const started = generation[area];
    const attempt = (async () => {
      const refreshToken = await storage.getItem(keyFor(area));
      if (!refreshToken) throw new SessionError("no_session");

      let reply;
      try {
        reply = await request(`/${area}/refresh-token`, { body: { refreshToken } });
      } catch {
        // No connection or a timeout: keep the session, the person is not signed out
        throw new SessionError("network_error");
      }

      if (generation[area] !== started) throw new SessionError("signed_out");

      if (reply.status === 200 && reply.data?.accessToken && reply.data?.refreshToken) {
        await storage.setItem(keyFor(area), reply.data.refreshToken);
        accessTokens[area] = reply.data.accessToken;
        return reply.data.accessToken;
      }

      // The server refused this refresh token (expired, revoked, wrong role): the session is over
      if (reply.status === 400 || reply.status === 401 || reply.status === 403) {
        await storage.deleteItem(keyFor(area));
        accessTokens[area] = null;
        throw new SessionError("refresh_failed");
      }

      throw new SessionError("server_error");
    })().finally(() => {
      if (refreshing.get(area) === attempt) refreshing.delete(area);
    });

    refreshing.set(area, attempt);
    return attempt;
  };

  return {
    // After sign-in on the web page.
    async set(area, { accessToken, refreshToken }) {
      assertArea(area);
      generation[area] += 1;
      refreshing.delete(area);
      await storage.setItem(keyFor(area), refreshToken);
      accessTokens[area] = accessToken;
    },

    // At web app start. Returns an access token, or null when this area has no session. A lost connection
    // answers null too; the page then shows its sign-in screen and the stored session is kept.
    async get(area) {
      assertArea(area);
      if (accessTokens[area]) return accessTokens[area];
      try {
        return await refresh(area);
      } catch {
        return null;
      }
    },

    refresh,

    // Sign out. The stored refresh token is wiped FIRST, so the session can never come back at the next start,
    // even if the server cannot be reached. This answers as soon as that is done. Revoking the token on the
    // server continues in the background (`revocation` never rejects), so a slow network does not hold the page up.
    async clear(area) {
      assertArea(area);
      generation[area] += 1;
      refreshing.delete(area);
      accessTokens[area] = null;

      const refreshToken = await storage.getItem(keyFor(area));
      await storage.deleteItem(keyFor(area));

      const revoke = async () => {
        if (!refreshToken) return false;
        try {
          const fresh = await request(`/${area}/refresh-token`, { body: { refreshToken } });
          if (fresh.status !== 200 || !fresh.data?.accessToken) return false;
          const out = await request(`/${area}/logout`, {
            token: fresh.data.accessToken,
            body: { refreshToken: fresh.data.refreshToken },
          });
          return out.status === 200;
        } catch {
          return false;
        }
      };

      return { revocation: revoke() };
    },
  };
};

module.exports = { REFRESH_TIMEOUT_MS, SessionError, createSession, keyFor };
