import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installShell, removeShell, resetBrowser } from "../test/fakeShell";

const load = async () => import("./sessionStore");

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(() => {
  removeShell();
  vi.useRealTimers();
});

describe("in a normal browser", () => {
  it("keeps tokens in localStorage exactly as before", async () => {
    const store = await load();
    await store.saveSession("driver", { accessToken: "a1", refreshToken: "r1" });
    expect(localStorage.getItem("driverToken")).toBe("a1");
    expect(localStorage.getItem("driverRefreshToken")).toBe("r1");
    expect(await store.getAccessToken("driver")).toBe("a1");
    expect(store.getRefreshToken("driver")).toBe("r1");
    await store.clearSession("driver");
    expect(localStorage.getItem("driverToken")).toBeNull();
    expect(localStorage.getItem("driverRefreshToken")).toBeNull();
  });

  it("never reports a pending sign-out", async () => {
    const store = await load();
    expect(store.isSignOutPending("driver")).toBe(false);
  });
});

describe("inside the mobile app", () => {
  it("hands the tokens to the shell and writes nothing to localStorage", async () => {
    const shell = installShell();
    const store = await load();
    await store.saveSession("driver", { accessToken: "a1", refreshToken: "r1" });
    expect(shell.received.find((m) => m.action === "session.set").payload).toEqual({ area: "driver", accessToken: "a1", refreshToken: "r1" });
    expect(Object.keys(localStorage).filter((k) => /token/i.test(k))).toEqual([]);
    expect(await store.getAccessToken("driver")).toBe("a1");
    expect(store.getRefreshToken("driver")).toBeNull();
  });

  it("fails the sign-in when the shell cannot store the session", async () => {
    installShell({ "session.set": { error: "native_error" } });
    const store = await load();
    await expect(store.saveSession("driver", { accessToken: "a", refreshToken: "r" })).rejects.toMatchObject({ name: "BridgeError" });
    expect(await store.getAccessToken("driver")).toBeNull();
  });

  it("shares one refresh between simultaneous requests", async () => {
    const shell = installShell({ "session.refresh": { accessToken: "a2" } });
    const store = await load();
    const results = await Promise.all([store.refreshInApp("driver"), store.refreshInApp("driver"), store.refreshInApp("driver")]);
    expect(results).toEqual(["a2", "a2", "a2"]);
    expect(shell.count("session.refresh")).toBe(1);
  });

  it("drops a refresh that finishes after sign-out", async () => {
    let finish;
    const shell = installShell({ "session.refresh": () => "silent" });
    const store = await load();
    const pending = store.refreshInApp("driver");
    const settled = pending.then(() => "resolved", (e) => e.code);
    await store.clearSession("driver");
    finish = shell.received.find((m) => m.action === "session.refresh").id;
    window.dispatchEvent(new CustomEvent("nasa-native-reply", { detail: JSON.stringify({ v: 1, id: finish, ok: true, data: { accessToken: "late" } }) }));
    expect(await settled).toBe("signed_out");
    expect(await store.getAccessToken("driver")).toBeNull();
  });

  it("stays signed out and says so when the shell cannot confirm the sign-out", async () => {
    const shell = installShell({ "session.clear": { error: "native_error" }, "session.get": { accessToken: "stored" } });
    const store = await load();
    await expect(store.clearSession("driver")).rejects.toMatchObject({ code: "native_error" });
    expect(shell.count("session.clear")).toBe(2);
    expect(store.isSignOutPending("driver")).toBe(true);
    // the flag survives a page reload (it is not a credential)
    expect(localStorage.getItem("nasa.signOutPending.driver")).toBe("1");
    // the old session is never restored while it is pending, even though the shell still offers one
    expect(await store.getAccessToken("driver")).toBeNull();
    await expect(store.refreshInApp("driver")).rejects.toMatchObject({ code: "signed_out" });
    expect(shell.count("session.refresh")).toBe(0);
  });

  it("finishes a pending sign-out by itself after a reload, and never restores the session first", async () => {
    localStorage.setItem("nasa.signOutPending.driver", "1");
    const shell = installShell({ "session.get": { accessToken: "stored" } });
    const store = await load();
    expect(await store.getAccessToken("driver")).toBeNull();
    await vi.waitFor(() => expect(shell.count("session.clear")).toBeGreaterThan(0));
    await vi.waitFor(() => expect(store.isSignOutPending("driver")).toBe(false));
    // an unrelated area is not affected
    expect(await store.getAccessToken("admin")).toBe("stored");
  });

  it("clears the pending flag when the retry succeeds, and when a new sign-in replaces the old session", async () => {
    const shell = installShell({ "session.clear": { error: "native_error" } });
    const store = await load();
    await store.clearSession("driver").catch(() => {});
    expect(store.isSignOutPending("driver")).toBe(true);
    shell.set("session.clear", {});
    await store.clearSession("driver");
    expect(store.isSignOutPending("driver")).toBe(false);

    shell.set("session.clear", { error: "native_error" });
    await store.clearSession("admin").catch(() => {});
    expect(store.isSignOutPending("admin")).toBe(true);
    await store.saveSession("admin", { accessToken: "new", refreshToken: "newr" });
    expect(store.isSignOutPending("admin")).toBe(false);
  });
});
