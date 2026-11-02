// A stand-in for the NASA mobile shell, for tests. It records every action and answers from a table of replies.
import { vi } from "vitest";

// replies: { "session.get": { accessToken: "a" } | { error: "no_session" } | "silent" | fn(message) => reply }
export const installShell = (replies = {}) => {
  const received = [];
  const respond = (id, body) => {
    window.dispatchEvent(
      new CustomEvent("nasa-native-reply", { detail: JSON.stringify({ v: 1, id, ...body }) })
    );
  };

  window.ReactNativeWebView = {
    postMessage: (raw) => {
      const message = JSON.parse(raw);
      received.push(message);
      let reply = replies[message.action];
      if (typeof reply === "function") reply = reply(message);
      if (reply === "silent") return;
      if (reply === undefined) reply = { data: {} };
      queueMicrotask(() => {
        if (reply.error) respond(message.id, { ok: false, error: reply.error });
        else respond(message.id, { ok: true, data: reply.data ?? reply });
      });
    },
  };

  return {
    received,
    count: (action) => received.filter((m) => m.action === action).length,
    set: (action, reply) => {
      replies[action] = reply;
    },
  };
};

export const removeShell = () => {
  delete window.ReactNativeWebView;
};

// Replaces the network for the global axios used by the app. handler(config) returns { status, data } or throws.
export const installServer = async (handler) => {
  const axios = (await import("axios")).default;
  const calls = [];
  axios.defaults.adapter = async (config) => {
    calls.push({ url: config.url, method: config.method, authorization: config.headers?.Authorization });
    const out = await handler(config);
    if (out.status >= 200 && out.status < 300) return { ...out, headers: {}, config, statusText: "OK" };
    throw new axios.AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, { ...out, headers: {}, config });
  };
  return { calls, axios, networkError: (config) => new axios.AxiosError("Network Error", "ERR_NETWORK", config) };
};

// Fresh page state for a test. axios is shared between tests (it is not reloaded), so the interceptors an earlier
// test's copy of the app added are removed too.
export const resetBrowser = async () => {
  localStorage.clear();
  sessionStorage.clear();
  const axios = (await import("axios")).default;
  axios.interceptors.request.clear();
  axios.interceptors.response.clear();
  vi.resetModules();
};
