import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

// The real journey form, slices and sign-out, with a fake server that can drop the connection.
const ROUTES = [{ id: 3, route: "Route Three", enabled: true }];
const TODAY = [{ id: 1, journey_date: "2026-11-02", route_name: "Route Three", start_seq: 10, end_seq: 20 }];

// postMode: ok | dropAfterSaving (saved, but the answer never arrives) | dropBeforeSaving | reject
// getMode: ok | drop (the journey lookup cannot reach the server)
const startServer = async () => {
  const state = { posts: 0, saved: false, postMode: "ok", getMode: "ok", bodies: [], driverId: 7 };
  let net;
  net = await installServer(async (config) => {
    if (config.url.includes("/driver/access-driver")) return { status: 200, data: { driver: { id: state.driverId, name: "Dee", agreement_signed: true } } };
    if (config.url.includes("/driver/routes-list")) return { status: 200, data: { routes: ROUTES } };
    if (config.url.includes("/driver/journey/") && config.method === "get") {
      if (state.getMode === "drop") throw net.networkError(config);
      return { status: 200, data: { data: state.saved ? TODAY : [] } };
    }
    if (config.url.endsWith("/driver/journey") && config.method === "post") {
      state.posts += 1;
      state.bodies.push(JSON.parse(config.data));
      if (state.postMode === "dropAfterSaving") {
        state.saved = true;
        throw net.networkError(config);
      }
      if (state.postMode === "dropBeforeSaving") throw net.networkError(config);
      if (state.postMode === "reject") return { status: 400, data: { success: false, message: "Journey for today is already saved" } };
      state.saved = true;
      return { status: 201, data: { data: TODAY[0] } };
    }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async (driverId = 7) => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"),
    import("react-redux"),
    import("react-router-dom"),
  ]);
  const driverSlice = await import("../../redux/slice/driver/driverSlice.js");
  const journeyReducer = (await import("../../redux/slice/driver/journeySlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Journey } = await import("./Journey.jsx");
  const store = configureStore({ reducer: { driver: driverSlice.default, journey: journeyReducer, language: languageReducer } });
  store.dispatch(driverSlice.setDriver({ id: driverId, name: "Dee", agreement_signed: true }));
  const view = render(
    <Provider store={store}>
      <MemoryRouter>
        <Journey />
      </MemoryRouter>
    </Provider>
  );
  return { ...view, store };
};

const field = (container, id) => container.querySelector(`#${id}`);
const fill = async (container, { start = "10", end = "20", route = "3" } = {}) => {
  await screen.findByRole("option", { name: "Route Three" });
  fireEvent.change(field(container, "start_sequence"), { target: { name: "start_sequence", value: start } });
  fireEvent.change(field(container, "end_sequence"), { target: { name: "end_sequence", value: end } });
  fireEvent.change(field(container, "route"), { target: { name: "route", value: route } });
};
const submitButton = () => screen.getByRole("button", { name: /Save Route|Route Already Saved|Saving/ });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
const typed = (container) => ({ start: field(container, "start_sequence").value, end: field(container, "end_sequence").value, route: field(container, "route").value });

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  removeShell();
  await resetBrowser();
  localStorage.setItem("driverToken", "good");
});
afterEach(() => cleanup());

describe("saving a journey on a weak connection", () => {
  it("a normal save is shown as saved only after the server confirms", async () => {
    const s = await startServer();
    const { container } = await mount();
    await fill(container);
    submit();
    expect(await screen.findByRole("button", { name: "Route Already Saved" })).toBeTruthy();
    expect(s.posts).toBe(1);
    expect(s.bodies[0]).toMatchObject({ driver_id: 7, route_id: "3", start_seq: "10", end_seq: "20" });
    expect(screen.queryByText("We could not confirm this was saved")).toBeNull();
  });

  it("a failed list refresh after a confirmed save does not turn it into a failure", async () => {
    const s = await startServer();
    const { container } = await mount();
    await fill(container);
    s.getMode = "drop";
    submit();
    await waitFor(() => expect(s.posts).toBe(1));
    expect(await screen.findByRole("button", { name: "Route Already Saved" })).toBeTruthy();
    expect(screen.queryByText("We could not confirm this was saved")).toBeNull();
  });

  it("a connection that drops after the server saved: checks, shows saved, and never sends the journey twice", async () => {
    const s = await startServer();
    s.postMode = "dropAfterSaving";
    const { container } = await mount();
    await fill(container);
    submit();
    expect(await screen.findByRole("button", { name: "Route Already Saved" })).toBeTruthy();
    expect(s.posts).toBe(1);
  });

  it("a connection that drops before the server saved: says it was not saved, keeps the entries, and a second submit works", async () => {
    const s = await startServer();
    s.postMode = "dropBeforeSaving";
    const { container } = await mount();
    await fill(container);
    submit();
    expect(await screen.findByText(/It was not saved/)).toBeTruthy();
    expect(typed(container)).toEqual({ start: "10", end: "20", route: "3" });
    expect(screen.getByRole("button", { name: "Save Route" }).disabled).toBe(false);

    s.postMode = "ok";
    submit();
    expect(await screen.findByRole("button", { name: "Route Already Saved" })).toBeTruthy();
    expect(s.posts).toBe(2);
  });

  it("when the server cannot be reached to check, submit stays off until the check can run, then it settles by itself", async () => {
    const s = await startServer();
    s.postMode = "dropAfterSaving";
    s.getMode = "drop";
    const { container } = await mount();
    await fill(container);
    // the first lookups fail too: the form was loaded, then the connection was lost
    submit();
    // "Check again" appears only once the check itself failed (while it runs, the notice says "Checking")
    expect(await screen.findByRole("button", { name: "Check again" })).toBeTruthy();
    expect(screen.getByText("We could not confirm this was saved")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Save Route" });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(s.posts).toBe(1);
    expect(typed(container)).toEqual({ start: "10", end: "20", route: "3" });

    s.getMode = "ok";
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(await screen.findByRole("button", { name: "Route Already Saved" })).toBeTruthy();
    expect(s.posts).toBe(1);
  });

  it("Check again works by hand, and finds nothing saved when the first request never arrived", async () => {
    const s = await startServer();
    s.postMode = "dropBeforeSaving";
    s.getMode = "drop";
    const { container } = await mount();
    await fill(container);
    submit();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy());
    s.getMode = "ok";
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/It was not saved/)).toBeTruthy();
    expect(s.posts).toBe(1);
  });

  it("a real refusal from the server is not treated as uncertain", async () => {
    const s = await startServer();
    s.postMode = "reject";
    const { container } = await mount();
    await fill(container);
    submit();
    await waitFor(() => expect(s.posts).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("We could not confirm this was saved")).toBeNull();
    expect(screen.queryByText(/It was not saved/)).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });
});

describe("keeping what was typed", () => {
  it("restores the entries after the page is reloaded, and removes them once saved", async () => {
    const s = await startServer();
    const first = await mount();
    await fill(first.container, { start: "31", end: "40", route: "3" });
    first.unmount();

    const second = await mount();
    await screen.findByRole("option", { name: "Route Three" });
    await waitFor(() => expect(typed(second.container)).toEqual({ start: "31", end: "40", route: "3" }));

    submit();
    expect(await screen.findByRole("button", { name: "Route Already Saved" })).toBeTruthy();
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith("nasa.draft."))).toEqual([]);
    expect(s.posts).toBe(1);
  });

  it("another driver on the same phone starts with an empty form", async () => {
    const s = await startServer();
    const first = await mount(7);
    await fill(first.container, { start: "31", end: "40" });
    first.unmount();

    s.driverId = 8;
    const other = await mount(8);
    await screen.findByRole("option", { name: "Route Three" });
    expect(typed(other.container)).toEqual({ start: "", end: "", route: "" });
  });

  it("signing out removes the drafts", async () => {
    await startServer();
    const { container } = await mount();
    await fill(container, { start: "31", end: "40" });
    expect(Object.keys(sessionStorage).some((k) => k.startsWith("nasa.draft.driver.7."))).toBe(true);
    const { clearSession } = await import("../../native/sessionStore.js");
    await clearSession("driver");
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith("nasa.draft."))).toEqual([]);
  });
});
