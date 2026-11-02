import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, installShell, removeShell, resetBrowser } from "../test/fakeShell";

// The real push module, prompt and tap router, with a fake shell and a fake server.
const TOKEN = "ExponentPushToken[abc12345]";
const PUSH_SHELL = {
  "app.hello": { bridgeVersions: [1], shellVersion: "0.1.0", platform: "ios", capabilities: ["session", "openExternal", "push"] },
  "session.get": { accessToken: "good" },
  "push.status": { available: true, permission: "granted", canAskAgain: true },
  "push.getToken": { token: TOKEN, platform: "ios" },
  "push.requestPermission": { available: true, permission: "granted", canAskAgain: true },
  "push.takePendingTap": { screen: null },
};
const okServer = () => async () => ({ status: 200, data: { success: true } });

const mountSetup = async (area = "driver") => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const languageReducer = (await import("../redux/slice/languageSlice.js")).default;
  const { default: PushSetup } = await import("./PushSetup.jsx");
  const store = configureStore({ reducer: { language: languageReducer } });
  const view = render(
    <Provider store={store}>
      <PushSetup area={area} />
    </Provider>
  );
  return { ...view, store };
};

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  removeShell();
  await resetBrowser();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  removeShell();
});

const posts = (net, suffix) => net.calls.filter((c) => c.method === "post" && c.url.endsWith(suffix));

describe("registering this phone", () => {
  it("does nothing in a normal browser", async () => {
    const net = await installServer(okServer());
    await mountSetup();
    await new Promise((r) => setTimeout(r, 50));
    expect(net.calls).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does nothing in an app build without push support", async () => {
    const shell = installShell({ ...PUSH_SHELL, "app.hello": { bridgeVersions: [1], shellVersion: "0.1.0", platform: "ios", capabilities: ["session"] } });
    const net = await installServer(okServer());
    await mountSetup();
    await waitFor(() => expect(shell.count("app.hello")).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(shell.received.some((m) => m.action.startsWith("push."))).toBe(false);
    expect(net.calls).toEqual([]);
  });

  it("does nothing on a phone that cannot get a token (simulator, or no Expo project yet)", async () => {
    const shell = installShell({ ...PUSH_SHELL, "push.status": { available: false, permission: "undetermined", canAskAgain: true } });
    const net = await installServer(okServer());
    await mountSetup();
    await waitFor(() => expect(shell.count("push.status")).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.count("push.getToken")).toBe(0);
    expect(net.calls).toEqual([]);
  });

  it("registers quietly when notifications are already allowed, for the right area, with the person's own token", async () => {
    installShell({ ...PUSH_SHELL });
    const net = await installServer(okServer());
    await mountSetup("driver");
    await waitFor(() => expect(posts(net, "/driver/push-token")).toHaveLength(1));
    expect(net.calls[0].authorization).toBe("Bearer good");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends the token, platform and app version, and uses the admin route for an admin", async () => {
    installShell({ ...PUSH_SHELL });
    const seen = [];
    const net = await installServer(async (config) => {
      seen.push(JSON.parse(config.data));
      return { status: 200, data: { success: true } };
    });
    await mountSetup("admin");
    await waitFor(() => expect(posts(net, "/admin/push-token")).toHaveLength(1));
    expect(seen[0]).toEqual({ token: TOKEN, platform: "ios", appVersion: "0.1.0" });
    expect(posts(net, "/driver/push-token")).toHaveLength(0);
  });

  it("a registration that fails changes nothing the person sees", async () => {
    installShell({ ...PUSH_SHELL });
    const net = await installServer(async () => ({ status: 500, data: {} }));
    await mountSetup();
    await waitFor(() => expect(posts(net, "/driver/push-token")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an expired session never triggers a refresh or sign-out from a push request", async () => {
    const shell = installShell({ ...PUSH_SHELL });
    const net = await installServer(async () => ({ status: 401, data: {} }));
    await mountSetup();
    await waitFor(() => expect(posts(net, "/driver/push-token")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(shell.count("session.refresh")).toBe(0);
    expect(shell.count("session.clear")).toBe(0);
  });

  it("registers nothing when there is no signed-in session", async () => {
    installShell({ ...PUSH_SHELL, "session.get": { error: "no_session" } });
    const net = await installServer(okServer());
    await mountSetup();
    await new Promise((r) => setTimeout(r, 80));
    expect(net.calls).toEqual([]);
  });
});

describe("asking for permission", () => {
  const undecided = { ...PUSH_SHELL, "push.status": { available: true, permission: "undetermined", canAskAgain: true } };

  it("explains first, and the system prompt appears only after the person agrees", async () => {
    const shell = installShell({ ...undecided });
    const net = await installServer(okServer());
    await mountSetup();
    expect(await screen.findByRole("dialog", { name: "Turn on notifications?" })).toBeTruthy();
    expect(shell.count("push.requestPermission")).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(posts(net, "/driver/push-token")).toHaveLength(1));
    expect(shell.count("push.requestPermission")).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Not now sends nothing, and the question does not come back for a week", async () => {
    const shell = installShell({ ...undecided });
    const net = await installServer(okServer());
    const first = await mountSetup();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.count("push.requestPermission")).toBe(0);
    expect(net.calls).toEqual([]);

    first.unmount();
    const before = shell.count("push.status");
    await mountSetup();
    await waitFor(() => expect(shell.count("push.status")).toBe(before + 1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();

    const { shouldAskAgain, PROMPT_COOLDOWN_MS } = await import("./push.js");
    expect(shouldAskAgain("driver", Date.now() + PROMPT_COOLDOWN_MS + 1000)).toBe(true);
    expect(shouldAskAgain("driver", Date.now() + 1000)).toBe(false);
    expect(shouldAskAgain("admin")).toBe(true);
  });

  it("if the person refuses in the system prompt, nothing is registered and nothing breaks", async () => {
    installShell({ ...undecided, "push.requestPermission": { available: true, permission: "denied", canAskAgain: false } });
    const net = await installServer(okServer());
    await mountSetup();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await new Promise((r) => setTimeout(r, 80));
    expect(net.calls).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask when the person already said no in the phone's settings", async () => {
    const shell = installShell({ ...PUSH_SHELL, "push.status": { available: true, permission: "denied", canAskAgain: false } });
    const net = await installServer(okServer());
    await mountSetup();
    await waitFor(() => expect(shell.count("push.status")).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(net.calls).toEqual([]);
  });
});

describe("signing out", () => {
  it("removes this phone using the token the page held, without delaying the sign-out", async () => {
    const shell = installShell({ ...PUSH_SHELL });
    const net = await installServer(okServer());
    await mountSetup("driver");
    await waitFor(() => expect(posts(net, "/driver/push-token")).toHaveLength(1));
    const { getAccessToken, clearSession } = await import("./sessionStore.js");
    expect(await getAccessToken("driver")).toBe("good");

    await clearSession("driver");
    await waitFor(() => expect(posts(net, "/driver/push-token/remove")).toHaveLength(1));
    const removal = posts(net, "/driver/push-token/remove")[0];
    expect(removal.authorization).toBe("Bearer good");
    expect(shell.count("session.clear")).toBe(1);
  });

  it("an admin's sign-out removes the phone from the admin route, with the admin's token", async () => {
    installShell({ ...PUSH_SHELL, "session.get": { accessToken: "admin-token" } });
    const net = await installServer(okServer());
    await mountSetup("admin");
    await waitFor(() => expect(posts(net, "/admin/push-token")).toHaveLength(1));
    const { getAccessToken, clearSession } = await import("./sessionStore.js");
    await getAccessToken("admin");
    await clearSession("admin");
    await waitFor(() => expect(posts(net, "/admin/push-token/remove")).toHaveLength(1));
    expect(posts(net, "/admin/push-token/remove")[0].authorization).toBe("Bearer admin-token");
    expect(posts(net, "/driver/push-token/remove")).toHaveLength(0);
  });

  it("signs out even when the removal cannot be sent", async () => {
    const shell = installShell({ ...PUSH_SHELL });
    let removeCalls = 0;
    await installServer(async (config) => {
      if (config.url.endsWith("/remove")) {
        removeCalls += 1;
        return new Promise(() => {}); // never answers
      }
      return { status: 200, data: { success: true } };
    });
    await mountSetup("driver");
    const { getAccessToken, clearSession } = await import("./sessionStore.js");
    await getAccessToken("driver");
    await waitFor(() => expect(shell.count("push.getToken")).toBe(1));

    await expect(clearSession("driver")).resolves.toBeUndefined();
    expect(shell.count("session.clear")).toBe(1);
    await waitFor(() => expect(removeCalls).toBe(1));
  });

  it("a sign-out of the other area does not remove this person's phone", async () => {
    installShell({ ...PUSH_SHELL });
    const net = await installServer(okServer());
    await mountSetup("driver");
    await waitFor(() => expect(posts(net, "/driver/push-token")).toHaveLength(1));
    const { getAccessToken, clearSession } = await import("./sessionStore.js");
    await getAccessToken("admin");
    await clearSession("admin");
    await new Promise((r) => setTimeout(r, 80));
    expect(posts(net, "/driver/push-token/remove")).toHaveLength(0);
    expect(posts(net, "/admin/push-token/remove")).toHaveLength(0);
  });

  it("a sign-out in a normal browser sends nothing", async () => {
    const net = await installServer(okServer());
    localStorage.setItem("driverToken", "t");
    const { clearSession } = await import("./sessionStore.js");
    await clearSession("driver");
    expect(localStorage.getItem("driverToken")).toBeNull();
    expect(net.calls).toEqual([]);
  });
});
