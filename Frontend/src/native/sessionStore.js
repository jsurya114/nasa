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

// A sign-out the shell could not confirm. It is remembered (not a credential) so that a reload or restart of the
// page cannot quietly bring the old session back while the phone may still hold it.
const pendingKey = (area) => `nasa.signOutPending.${area}`;
const signOutListeners = new Set();

// "1" while the shell is still clearing, "2" once it failed to confirm. Both block any restore of the old session.
// Only "2" is shown to the person.
const readState = (area) => {
  try {
    return localStorage.getItem(pendingKey(area));
  } catch {
    return null;
  }
};
const readPending = (area) => readState(area) !== null;

const writePending = (area, state) => {
  try {
    if (state) localStorage.setItem(pendingKey(area), state);
    else localStorage.removeItem(pendingKey(area));
  } catch {
    // Without storage the flag only lives for this page load
  }
  signOutListeners.forEach((listener) => listener());
};

// True only inside the app, for an area whose last sign-out has not been confirmed by the phone yet.
export const isSignOutPending = (area) => isNativeShell() && readPending(area);
// True only once the phone failed to confirm it. This is what the sign-in screen tells the person about.
export const isSignOutFailed = (area) => isNativeShell() && readState(area) === "2";
// Finishes a sign-out that was interrupted (the page was closed or reloaded while it ran) or that failed earlier.
// At most once per page load and area, and never restores the old session. If the shell still cannot confirm,
// the state becomes "failed" and the sign-in screen shows the notice with Try again.
export const recoverPendingSignOut = (area) => {
  if (!isSignOutPending(area) || retriedPending.has(area)) return;
  retriedPending.add(area);
  clearSession(area).catch(() => {});
};
export const subscribeSignOut = (listener) => {
  signOutListeners.add(listener);
  return () => signOutListeners.delete(listener);
};
export const signOutSnapshot = () => AREAS.map((area) => (isSignOutFailed(area) ? area : "")).join("|");
const refreshing = new Map();
const clearing = new Map();
const signOutHooks = new Set();
const retriedPending = new Set();
let hydration = null;

// Goes up every time an area signs in or out. A slow reply that started before that is ignored, so a refresh
// that was still running when someone signed out can never put a token back.
const generation = { admin: 0, driver: 0 };

// Asks the shell once for the access tokens it already holds (after an app restart).
const hydrate = () => {
  if (!hydration) {
    hydration = Promise.all(
      AREAS.map(async (area) => {
        // An unconfirmed sign-out is never restored (getAccessToken tries to finish it)
        if (readPending(area)) return;
        const started = generation[area];
        let token = null;
        try {
          const data = await callNative("session.get", { area }, { timeoutMs: SESSION_GET_TIMEOUT_MS });
          token = typeof data?.accessToken === "string" ? data.accessToken : null;
        } catch {
          token = null;
        }
        if (generation[area] === started) memory[area] = token;
      })
    );
  }
  return hydration;
};

// Changes every time this area signs in or out. Something that started under one value and finds another when it is
// about to act belongs to a person who is no longer signed in, and must not go on (for example a push registration
// that was still waiting on the phone when the person signed out).
export const sessionGeneration = (area) => generation[area];

export const getAccessToken = async (area) => {
  if (!isNativeShell()) return localStorage.getItem(`${area}Token`);
  if (readPending(area)) {
    // Never restore it. Try to finish the sign-out, once per page load.
    recoverPendingSignOut(area);
    return null;
  }
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
  generation[area] += 1;
  refreshing.delete(area);
  await callNative("session.set", { area, accessToken, refreshToken });
  memory[area] = accessToken;
  // A new sign-in replaces whatever the shell was still holding
  writePending(area, null);
};

// Browser: used after the page's own refresh call. The app never calls this.
export const saveRotatedTokens = (area, { accessToken, refreshToken }) => {
  localStorage.setItem(`${area}Token`, accessToken);
  localStorage.setItem(`${area}RefreshToken`, refreshToken);
};

// App only: the shell refreshes with the refresh token it holds and returns just the new access token.
// Several requests failing at once share one refresh.
export const refreshInApp = (area) => {
  if (readPending(area)) return Promise.reject(Object.assign(new Error("signed_out"), { code: "signed_out" }));
  if (!refreshing.has(area)) {
    const started = generation[area];
    const attempt = callNative("session.refresh", { area })
      .then((data) => {
        if (typeof data?.accessToken !== "string") throw Object.assign(new Error("refresh_failed"), { code: "refresh_failed" });
        if (generation[area] !== started) throw Object.assign(new Error("signed_out"), { code: "signed_out" });
        memory[area] = data.accessToken;
        return data.accessToken;
      })
      .finally(() => {
        if (refreshing.get(area) === attempt) refreshing.delete(area);
      });
    refreshing.set(area, attempt);
  }
  return refreshing.get(area);
};

// App only. `hook({ area, accessToken })` runs at the start of an in-app sign-out with the access token this page still
// holds, so one last authenticated request can be sent (for example removing this phone's push registration). It is
// not waited for and its failure is ignored: signing out is never delayed or blocked by it.
export const onSignOut = (hook) => {
  signOutHooks.add(hook);
  return () => signOutHooks.delete(hook);
};

const runSignOutHooks = (area, accessToken) => {
  signOutHooks.forEach((hook) => {
    Promise.resolve()
      .then(() => hook({ area, accessToken }))
      .catch(() => {});
  });
};

// Sign out of one area. In the app the shell also wipes its copy and revokes the refresh token on the server.
// This page is signed out immediately. If the shell cannot be reached (after one retry) this rejects, so the
// caller can tell the person that the phone may still hold a session.
export const clearSession = (area) => {
  if (!isNativeShell()) {
    localStorage.removeItem(`${area}Token`);
    localStorage.removeItem(`${area}RefreshToken`);
    return Promise.resolve();
  }
  // One sign-out at a time per area: a second caller (for example the route check right after the header's
  // sign-out) waits for the one already running instead of sending another.
  if (clearing.has(area)) return clearing.get(area);

  runSignOutHooks(area, memory[area]);
  generation[area] += 1;
  memory[area] = null;
  refreshing.delete(area);
  // Pending until the shell confirms. If it never does, the flag stays and blocks any restore.
  writePending(area, "1");
  const run = (async () => {
    try {
      try {
        await callNative("session.clear", { area });
      } catch {
        await callNative("session.clear", { area });
      }
    } catch (error) {
      writePending(area, "2");
      throw error;
    }
    writePending(area, null);
  })().finally(() => {
    if (clearing.get(area) === run) clearing.delete(area);
  });
  clearing.set(area, run);
  return run;
};

// Browser only, for places that used to remove the tokens after any failed check. In the app a failed check
// (for example no connection) must not sign anyone out, so this does nothing there.
export const clearBrowserTokens = (area) => {
  if (isNativeShell()) return;
  localStorage.removeItem(`${area}Token`);
  localStorage.removeItem(`${area}RefreshToken`);
};
