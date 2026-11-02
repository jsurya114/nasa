import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { installShell, removeShell, resetBrowser } from "../test/fakeShell";

// The real tap router with a fake shell. Sign-in state is a stand-in for the Redux slices' isAuthenticated flag.
const HELLO = { bridgeVersions: [1], shellVersion: "0.1.0", platform: "ios", capabilities: ["session", "push"] };

const mountRouter = async () => {
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route, useLocation }] = await Promise.all([
    import("@reduxjs/toolkit"),
    import("react-redux"),
    import("react-router-dom"),
  ]);
  const { default: PushTapRouter } = await import("./PushTapRouter.jsx");
  const flag = (type) => (state = { isAuthenticated: null }, action) => (action.type === type ? { isAuthenticated: action.value } : state);
  const store = configureStore({ reducer: { driver: flag("test/driver"), admin: flag("test/admin") } });
  const where = { path: "/" };
  const Here = () => {
    where.path = useLocation().pathname;
    return null;
  };
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <PushTapRouter />
        <Routes>
          <Route path="*" element={<Here />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  const signIn = (area, value = true) => act(() => store.dispatch({ type: `test/${area}`, value }));
  return { where, signIn };
};

const nudge = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent("nasa-native-event", { detail: JSON.stringify({ v: 1, type: "notification.tap" }) }));
  });
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

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

describe("opening a screen from a tapped notification", () => {
  it("does nothing in a normal browser", async () => {
    const { where, signIn } = await mountRouter();
    await signIn("driver");
    await nudge();
    await settle();
    expect(where.path).toBe("/");
  });

  it("a tap that opened the app from closed goes to that screen once the driver is signed in", async () => {
    const shell = installShell({ "app.hello": HELLO, "push.takePendingTap": { screen: "availability" } });
    const { where, signIn } = await mountRouter();
    await waitFor(() => expect(shell.count("push.takePendingTap")).toBe(1));
    await settle();
    expect(where.path).toBe("/");
    await signIn("driver");
    await waitFor(() => expect(where.path).toBe("/driver/availability"));
  });

  it("each driver screen name maps to its own route", async () => {
    for (const [screen, path] of [["availability", "/driver/availability"], ["deliveries", "/driver/delivery"], ["agreement", "/driver/agreement"]]) {
      cleanup();
      const shell = installShell({ "app.hello": HELLO, "push.takePendingTap": { screen: null } });
      const { where, signIn } = await mountRouter();
      await signIn("driver");
      shell.set("push.takePendingTap", { screen });
      await nudge();
      await waitFor(() => expect(where.path).toBe(path));
    }
  });

  it("an admin's access-code notification opens the admin's access code screen while the page is open", async () => {
    const shell = installShell({ "app.hello": HELLO, "push.takePendingTap": { screen: null } });
    const { where, signIn } = await mountRouter();
    await signIn("admin");
    shell.set("push.takePendingTap", { screen: "access-codes" });
    await nudge();
    await waitFor(() => expect(where.path).toBe("/admin/manage-access-codes"));
  });

  it("a screen the signed-in person's area cannot open is dropped, and does not follow a later sign-in", async () => {
    const shell = installShell({ "app.hello": HELLO, "push.takePendingTap": { screen: null } });
    const { where, signIn } = await mountRouter();
    await signIn("admin");
    shell.set("push.takePendingTap", { screen: "availability" });
    await nudge();
    await settle();
    expect(where.path).toBe("/");
    await signIn("driver");
    await settle();
    expect(where.path).toBe("/");
  });

  it("a name that is not on the list, or a link, is never opened", async () => {
    const shell = installShell({ "app.hello": HELLO, "push.takePendingTap": { screen: null } });
    const { where, signIn } = await mountRouter();
    await signIn("driver");
    await signIn("admin");
    for (const bad of ["https://evil.example.com", "/admin/dashboard", "../x", "constructor", "__proto__", "Availability", 7, {}]) {
      shell.set("push.takePendingTap", { screen: bad });
      await nudge();
      await settle();
      expect(where.path).toBe("/");
    }
  });

  it("a tap made while nobody is signed in is forgotten after ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const shell = installShell({ "app.hello": HELLO, "push.takePendingTap": { screen: null } });
    const { where, signIn } = await mountRouter();
    shell.set("push.takePendingTap", { screen: "deliveries" });
    await nudge();
    await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60 * 1000); });
    await signIn("driver");
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(where.path).toBe("/");
  });

  it("ignores events that are not a notification tap", async () => {
    const shell = installShell({ "app.hello": HELLO, "push.takePendingTap": { screen: "deliveries" } });
    const { where, signIn } = await mountRouter();
    await waitFor(() => expect(shell.count("push.takePendingTap")).toBe(1));
    shell.set("push.takePendingTap", { screen: "availability" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("nasa-native-event", { detail: JSON.stringify({ v: 1, type: "something.else" }) }));
      window.dispatchEvent(new CustomEvent("nasa-native-event", { detail: "not json" }));
      window.dispatchEvent(new CustomEvent("nasa-native-event", { detail: JSON.stringify({ v: 2, type: "notification.tap" }) }));
    });
    await settle();
    expect(shell.count("push.takePendingTap")).toBe(1);
    await signIn("driver");
    await waitFor(() => expect(where.path).toBe("/driver/delivery"));
  });

  it("an app without push support never asks the shell for a tap", async () => {
    const shell = installShell({ "app.hello": { ...HELLO, capabilities: ["session"] } });
    const { where, signIn } = await mountRouter();
    await signIn("driver");
    await nudge();
    await settle();
    expect(shell.count("push.takePendingTap")).toBe(0);
    expect(where.path).toBe("/");
  });
});
