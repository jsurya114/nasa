// Push notifications, web side (docs/MOBILE_APP_DESIGN.md, section 10). Everything here does nothing in a normal
// browser, and nothing when the app build has no push support.
//
// Who may receive what is decided by the server. This page only tells the server which phone belongs to the person
// signed in right now (the server takes the person from the sign-in token), and removes it again at sign-out.

import axios from "axios";
import { API_BASE_URL } from "../config";
import { callNative, getCapabilities, hasCapability } from "./bridge";
import { getAccessToken, sessionGeneration } from "./sessionStore";

// A tapped notification names a screen; each area maps the names it may open to its own routes. A name that is not
// listed for the signed-in area is ignored, and the route guards still decide what is shown.
export const SCREEN_ROUTES = Object.freeze({
  driver: { availability: "/driver/availability", deliveries: "/driver/delivery", agreement: "/driver/agreement" },
  admin: { "access-codes": "/admin/manage-access-codes" },
});

export const routeForScreen = (area, screen) => SCREEN_ROUTES[area]?.[screen] ?? null;

// The notification question is repeated at most this often after "Not now".
export const PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const promptKey = (area) => `nasa.pushPrompt.${area}`;
const REQUEST_TIMEOUT_MS = 5000;

// A plain client with no interceptors, so a failed push request can never trigger a refresh or a sign-out.
const client = axios.create({ baseURL: API_BASE_URL, timeout: REQUEST_TIMEOUT_MS });

const authed = (accessToken) => ({ headers: { Authorization: `Bearer ${accessToken}` } });

// { available, permission, canAskAgain } or null when this app build has no push.
export const getPushStatus = async () => {
  if (!(await hasCapability("push"))) return null;
  try {
    const status = await callNative("push.status");
    return { available: status.available === true, permission: status.permission, canAskAgain: status.canAskAgain !== false };
  } catch {
    return null;
  }
};

export const requestPushPermission = async () => {
  try {
    const answer = await callNative("push.requestPermission");
    return answer.permission;
  } catch {
    return "denied";
  }
};

const lastToken = {};

// Registering and removing a phone for one area are sent one at a time, in the order they were started. A removal
// started by a sign-out therefore always lands after a registration that was already on its way, instead of passing
// it and being undone when it arrives. Neither holds up the sign-out itself: the page is signed out at once and the
// removal follows in the background.
const sending = {};
const inOrder = (area, task) => {
  const run = (sending[area] ?? Promise.resolve()).then(task);
  sending[area] = run.catch(() => {});
  return run;
};

// Tells the server about this phone for the person signed in to `area`. Quiet on failure: a person without
// notifications loses nothing, and the next start tries again.
//
// The sign-in it belongs to is noted when it starts. If that person signs out (or someone else signs in) while it is
// still waiting on the phone or on earlier requests, it is dropped before it is sent, so it can neither put the phone
// back on a signed-out account nor take it from the next person.
export const registerThisPhone = async (area) => {
  const signedInAs = sessionGeneration(area);
  try {
    const [{ token, platform }, info, accessToken] = await Promise.all([
      callNative("push.getToken"),
      getCapabilities(),
      getAccessToken(area),
    ]);
    if (!accessToken) return false;
    return await inOrder(area, async () => {
      if (sessionGeneration(area) !== signedInAs) return false;
      await client.post(`/${area}/push-token`, { token, platform, appVersion: info?.shellVersion }, authed(accessToken));
      lastToken[area] = token;
      return true;
    });
  } catch {
    return false;
  }
};

// Removes this phone from the person who is signing out. `accessToken` is the one the page held before it signed out.
export const removeThisPhone = ({ area, accessToken }) => {
  if (!accessToken) return Promise.resolve(false);
  return inOrder(area, async () => {
    try {
      const token = lastToken[area] ?? (await callNative("push.getToken")).token;
      await client.post(`/${area}/push-token/remove`, { token }, authed(accessToken));
      delete lastToken[area];
      return true;
    } catch {
      return false;
    }
  });
};

const readAsked = (area) => {
  try {
    return Number(localStorage.getItem(promptKey(area))) || 0;
  } catch {
    return 0;
  }
};

// Whether to show our own explanation now. Not again for a week after "Not now".
export const shouldAskAgain = (area, now = Date.now()) => now - readAsked(area) >= PROMPT_COOLDOWN_MS;

export const rememberNotNow = (area, now = Date.now()) => {
  try {
    localStorage.setItem(promptKey(area), String(now));
  } catch {
    // Without storage the question simply comes back at the next start
  }
};

// The screen name from a tapped notification, collected once from the shell, or null.
export const takePendingTap = async () => {
  if (!(await hasCapability("push"))) return null;
  try {
    const { screen } = await callNative("push.takePendingTap");
    return typeof screen === "string" ? screen : null;
  } catch {
    return null;
  }
};

export const openPhoneSettings = () => callNative("push.openSettings").catch(() => {});
