import React from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import usePersistentState from "./usePersistentState.js";
import { clearViewState, readView } from "../utils/viewState.js";

const makeStore = (adminId = 5, driverId = 9) => configureStore({
  reducer: { admin: (s = { admin: adminId ? { id: adminId } : null }) => s, driver: (s = { driver: driverId ? { id: driverId } : null }) => s },
});
const wrapperFor = (store) => ({ children }) => <Provider store={store}>{children}</Provider>;
const setup = (area = "admin", initial = { job: "All" }, store = makeStore()) =>
  renderHook(() => usePersistentState(area, "dashboard", "filters", initial), { wrapper: wrapperFor(store) });

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("usePersistentState", () => {
  it("behaves like useState, including the updater form", () => {
    const { result } = setup("admin", 1);
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(2);
  });

  it("gives the value back after the page is left and opened again", () => {
    const first = setup();
    act(() => first.result.current[1]({ job: "Dallas" }));
    first.unmount();
    const again = setup();
    expect(again.result.current[0]).toEqual({ job: "Dallas" });
  });

  it("stores nothing while the value is the starting value", () => {
    const first = setup();
    act(() => first.result.current[1]({ job: "Dallas" }));
    act(() => first.result.current[1]({ job: "All" }));
    expect(readView("admin", 5, "dashboard", "filters")).toBeUndefined();
  });

  it("keeps each person's and each area's values apart", () => {
    const mine = setup("admin", { job: "All" }, makeStore(5));
    act(() => mine.result.current[1]({ job: "Dallas" }));
    expect(setup("admin", { job: "All" }, makeStore(6)).result.current[0]).toEqual({ job: "All" });
    expect(setup("driver", { job: "All" }, makeStore(5, 9)).result.current[0]).toEqual({ job: "All" });
  });

  it("is forgotten at sign-out", () => {
    const first = setup();
    act(() => first.result.current[1]({ job: "Dallas" }));
    clearViewState("admin");
    first.unmount();
    expect(setup().result.current[0]).toEqual({ job: "All" });
  });

  it("does not store anything before the person is known, and restores once they are", () => {
    const store = configureStore({ reducer: { admin: (s = { admin: null }, a) => (a.type === "signed-in" ? { admin: { id: 5 } } : s), driver: (s = {}) => s } });
    window.sessionStorage.setItem("nasa.view.admin.5.dashboard.filters", JSON.stringify({ job: "Dallas" }));
    const { result } = setup("admin", { job: "All" }, store);
    expect(result.current[0]).toEqual({ job: "All" });
    act(() => { store.dispatch({ type: "signed-in" }); });
    expect(result.current[0]).toEqual({ job: "Dallas" });
    expect(readView("admin", 5, "dashboard", "filters")).toEqual({ job: "Dallas" });
  });

  it("works when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try {
      const { result } = setup();
      act(() => result.current[1]({ job: "Dallas" }));
      expect(result.current[0]).toEqual({ job: "Dallas" });
    } finally {
      Object.defineProperty(window, "sessionStorage", original);
    }
  });

  it("renders in a component", () => {
    const store = makeStore();
    const Probe = () => <p>{usePersistentState("admin", "p", "n", "x")[0]}</p>;
    const { container } = render(<Provider store={store}><Probe /></Provider>);
    expect(container.textContent).toBe("x");
  });
});
