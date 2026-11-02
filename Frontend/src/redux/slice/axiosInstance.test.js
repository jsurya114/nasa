import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installServer, installShell, removeShell, resetBrowser } from "../../test/fakeShell";

// A server that accepts only the token "good"
const server = (extra = {}) => async (config) => {
  if (config.url.includes("/refresh-token")) return extra.refresh?.(config) ?? { status: 401, data: {} };
  return config.headers?.Authorization === "Bearer good" ? { status: 200, data: { ok: true } } : { status: 401, data: {} };
};

// Replaces window.location and returns the list of addresses the app tried to navigate to
const setPath = (pathname) => {
  const redirects = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname,
      origin: "http://localhost",
      protocol: "http:",
      host: "localhost",
      hostname: "localhost",
      get href() {
        return `http://localhost${pathname}`;
      },
      set href(value) {
        redirects.push(value);
      },
    },
  });
  return redirects;
};

let realLocation;
beforeEach(async () => {
  realLocation = window.location;
  removeShell();
  await resetBrowser();
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  removeShell();
  vi.useRealTimers();
});

const loadAxios = async () => (await import("./axiosInstance")).default;

describe("mobile app: a fresh start with nobody signed in", () => {
  it("lets the sign-in form show: no reload, no sign-out call", async () => {
    const redirects = setPath("/driver/login");
    const shell = installShell({ "session.get": { accessToken: null }, "session.refresh": { error: "no_session" } });
    const net = await installServer(server());
    const axios = await loadAxios();
    await expect(axios.get("/driver/access-driver")).rejects.toMatchObject({ response: { status: 401 } });
    expect(redirects).toEqual([]);
    expect(shell.count("session.clear")).toBe(0);
    expect(net.calls).toHaveLength(1);
  });
});

describe("mobile app: temporary refresh problems keep the session", () => {
  for (const code of ["network_error", "server_error", "native_error"]) {
    it(`${code} does not clear the session and marks the failure as temporary`, async () => {
      const redirects = setPath("/driver/dashboard");
      const shell = installShell({ "session.get": { accessToken: "stale" }, "session.refresh": { error: code } });
      await installServer(server());
      const axios = await loadAxios();
      const error = await axios.get("/driver/access-driver").catch((e) => e);
      expect(error.transient).toBe(true);
      expect(shell.count("session.clear")).toBe(0);
      expect(redirects).toEqual([]);
    });
  }

  it("a shell that never answers (timeout) does not clear the session either", async () => {
    const redirects = setPath("/admin/dashboard");
    const shell = installShell({ "session.get": { accessToken: "stale" }, "session.refresh": "silent" });
    await installServer(server());
    const axios = await loadAxios();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const result = axios.get("/admin/access-admin").catch((e) => e);
    await vi.advanceTimersByTimeAsync(11000);
    const error = await result;
    expect(error.transient).toBe(true);
    expect(shell.count("session.clear")).toBe(0);
    expect(redirects).toEqual([]);
  });
});

describe("mobile app: refresh outcomes", () => {
  it("retries the request with the new token", async () => {
    const redirects = setPath("/driver/dashboard");
    installShell({ "session.get": { accessToken: "stale" }, "session.refresh": { accessToken: "good" } });
    const net = await installServer(server());
    const axios = await loadAxios();
    const response = await axios.get("/driver/access-driver");
    expect(response.status).toBe(200);
    expect(net.calls.map((c) => c.authorization)).toEqual(["Bearer stale", "Bearer good"]);
    expect(redirects).toEqual([]);
  });

  it("signs out of that area only when the server refused the session", async () => {
    const redirects = setPath("/driver/dashboard");
    const shell = installShell({ "session.get": { accessToken: "stale" }, "session.refresh": { error: "refresh_failed" } });
    await installServer(server());
    const axios = await loadAxios();
    await expect(axios.get("/driver/access-driver")).rejects.toBeTruthy();
    expect(shell.received.filter((m) => m.action === "session.clear").map((m) => m.payload.area)).toEqual(["driver"]);
    expect(redirects).toEqual(["/driver/login"]);
  });

  it("does not reload the sign-in page when it is already showing", async () => {
    const redirects = setPath("/driver/login");
    installShell({ "session.get": { accessToken: "stale" }, "session.refresh": { error: "refresh_failed" } });
    await installServer(server());
    const axios = await loadAxios();
    await expect(axios.get("/driver/access-driver")).rejects.toBeTruthy();
    expect(redirects).toEqual([]);
  });
});

describe("normal browser: unchanged", () => {
  it("refreshes with the stored refresh token and retries", async () => {
    const redirects = setPath("/driver/dashboard");
    localStorage.setItem("driverToken", "stale");
    localStorage.setItem("driverRefreshToken", "r1");
    const net = await installServer(server({ refresh: () => ({ status: 200, data: { accessToken: "good", refreshToken: "r2" } }) }));
    const axios = await loadAxios();
    const response = await axios.get("/driver/access-driver");
    expect(response.status).toBe(200);
    expect(localStorage.getItem("driverToken")).toBe("good");
    expect(localStorage.getItem("driverRefreshToken")).toBe("r2");
    expect(net.calls.some((c) => c.url.includes("/refresh-token"))).toBe(true);
    expect(redirects).toEqual([]);
  });

  it("signs out and goes to the login page when the refresh token is refused", async () => {
    const redirects = setPath("/driver/dashboard");
    localStorage.setItem("driverToken", "stale");
    localStorage.setItem("driverRefreshToken", "revoked");
    await installServer(server({ refresh: () => ({ status: 401, data: {} }) }));
    const axios = await loadAxios();
    await expect(axios.get("/driver/access-driver")).rejects.toBeTruthy();
    expect(localStorage.getItem("driverToken")).toBeNull();
    expect(localStorage.getItem("driverRefreshToken")).toBeNull();
    expect(redirects).toEqual(["/driver/login"]);
  });
});
