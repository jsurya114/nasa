// Where sign-in tokens live (see docs/MOBILE_APP_DESIGN.md, section 3).
//
// In a normal browser nothing changes: tokens are in localStorage under adminToken, adminRefreshToken,
// driverToken and driverRefreshToken, exactly as before.
//
// Inside the NASA mobile app the shell owns the refresh token in the phone's secure storage. This page
// keeps only the short-lived access token, in memory, and never writes either token to localStorage.

import { callNative, isNativeShell } from "./bridge";

const AREAS = ["admin", "driver"];
const SESSION_GET_TIMEOUT_MS = 5000;

const memory = { admin: null, driver: null };
const refreshing = new Map();
let hydration = null;

// Asks the shell once for the access tokens it already holds (after an app restart).
const hydrate = () => {
  if (!hydration) {
    hydration = Promise.all(
      AREAS.map(async (area) => {
        try {
          const data = await callNative("session.get", { area }, { timeoutMs: SESSION_GET_TIMEOUT_MS });
          memory[area] = typeof data?.accessToken === "string" ? data.accessToken : null;
        } catch {
          memory[area] = null;
        }
      })
    );
  }
  return hydration;
};

export const getAccessToken = async (area) => {
  if (!isNativeShell()) return localStorage.getItem(`${area}Token`);
  await hydrate();
  return memory[area];
};

// Browser only. In the app the refresh token is never visible to this page.
export const getRefreshToken = (area) => (isNativeShell() ? null : localStorage.getItem(`${area}RefreshToken`));

// After sign-in. In the app this fails (and the sign-in must fail) if the shell could not store the session.
export const saveSession = async (area, { accessToken, refreshToken }) => {
  if (!isNativeShell()) {
    if (accessToken) localStorage.setItem(`${area}Token`, accessToken);
    if (refreshToken) localStorage.setItem(`${area}RefreshToken`, refreshToken);
    return;
  }
  await hydrate();
  await callNative("session.set", { area, accessToken, refreshToken });
  memory[area] = accessToken;
};

// Browser: used after the page's own refresh call. The app never calls this.
export const saveRotatedTokens = (area, { accessToken, refreshToken }) => {
  localStorage.setItem(`${area}Token`, accessToken);
  localStorage.setItem(`${area}RefreshToken`, refreshToken);
};

// App only: the shell refreshes with the refresh token it holds and returns just the new access token.
// Several requests failing at once share one refresh.
export const refreshInApp = (area) => {
  if (!refreshing.has(area)) {
    const attempt = callNative("session.refresh", { area })
      .then((data) => {
        if (typeof data?.accessToken !== "string") throw new Error("refresh_failed");
        memory[area] = data.accessToken;
        return data.accessToken;
      })
      .finally(() => refreshing.delete(area));
    refreshing.set(area, attempt);
  }
  return refreshing.get(area);
};

// Sign out of one area. In the app the shell also revokes the refresh token on the server and wipes its copy.
export const clearSession = async (area) => {
  if (!isNativeShell()) {
    localStorage.removeItem(`${area}Token`);
    localStorage.removeItem(`${area}RefreshToken`);
    return;
  }
  memory[area] = null;
  try {
    await callNative("session.clear", { area });
  } catch {
    // The page is signed out either way; the shell removes its copy on its next start if it was unreachable.
  }
};

// Browser only, for places that used to remove the tokens after any failed check. In the app a failed check
// (for example no connection) must not sign anyone out, so this does nothing there.
export const clearBrowserTokens = (area) => {
  if (isNativeShell()) return;
  localStorage.removeItem(`${area}Token`);
  localStorage.removeItem(`${area}RefreshToken`);
};
