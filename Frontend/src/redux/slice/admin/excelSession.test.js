import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installServer, resetBrowser } from "../../../test/fakeShell";

// The weekly upload answer is role- and city-scoped, so it must not outlive or cross the session that received it.
// The real slices and thunks, a fake server, made-up administrators.
const ANSWER = (marker) => ({ message: "ok", data: { claims: { found: true, stored: true, inFile: 1, notStored: 2, marker }, assignmentHistory: { saved: true } } });
const ADMIN = { id: 2, name: "Super", role: "superadmin" };
const OTHER = { id: 3, name: "City", role: "admin" };

let gates;
const startServer = async () => {
  gates = [];
  await installServer(async (config) => {
    if (config.url === "/admin/login") return { status: 200, data: { admin: JSON.parse(config.data).email === "city" ? OTHER : ADMIN } };
    if (config.url === "/admin/logout") return { status: 200, data: {} };
    if (config.url.includes("weekly-upload")) {
      // Each upload waits until the test opens its gate, so an answer can arrive late.
      const gate = {};
      const index = gates.length + 1; // which upload this answer belongs to
      gate.promise = new Promise((resolve) => { gate.open = resolve; });
      gates.push(gate);
      await gate.promise;
      return { status: 200, data: ANSWER(`answer-${index}`) };
    }
    return { status: 404, data: {} };
  });
};

const makeStore = async () => {
  const [{ configureStore }, admin, excel] = await Promise.all([
    import("@reduxjs/toolkit"), import("./adminSlice.js"), import("./excelSlice.js"),
  ]);
  const store = configureStore({ reducer: { admin: admin.default, excel: excel.default } });
  return { store, admin, excel };
};

const signIn = (store, admin, who = "super") => store.dispatch(admin.adminLogin({ email: who, password: "x" })).unwrap();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the weekly upload summary and the administrator session", () => {
  beforeEach(async () => { await resetBrowser(); await startServer(); });
  afterEach(() => { localStorage.clear(); });

  it("shows a finished result to the administrator who uploaded, and to no one else", async () => {
    const { store, admin, excel } = await makeStore();
    await signIn(store, admin);
    const upload = store.dispatch(excel.excelWeeklyFileUpload(new FormData()));
    await tick();
    gates[0].open();
    await upload;
    expect(excel.selectWeeklyResult(store.getState())?.claims.marker).toBe("answer-1");
    expect(store.getState().excel.weekly.ownerAdminId).toBe(ADMIN.id);

    // Another administrator in the same page (for example a session switched without a sign-out) sees nothing.
    store.dispatch({ type: "admin/access-admin/fulfilled", payload: { admin: OTHER }, meta: { requestId: "x", requestStatus: "fulfilled" } });
    expect(excel.selectWeeklyResult(store.getState())).toBeNull();
  });

  it("drops a finished result when the administrator signs out, by either sign-out path", async () => {
    for (const path of ["logout", "manual"]) {
      const { store, admin, excel } = await makeStore();
      await signIn(store, admin);
      const upload = store.dispatch(excel.excelWeeklyFileUpload(new FormData()));
      await tick();
      gates.at(-1).open();
      await upload;
      expect(excel.selectWeeklyResult(store.getState())).not.toBeNull();
      if (path === "logout") await store.dispatch(admin.adminLogout());
      else store.dispatch(admin.manualLogout());
      expect(store.getState().excel.weekly.result).toBeNull();
      expect(excel.selectWeeklyResult(store.getState())).toBeNull();
      // The next person to sign in does not inherit it.
      await signIn(store, admin, "city");
      expect(excel.selectWeeklyResult(store.getState())).toBeNull();
      expect(store.getState().excel.weekly.result).toBeNull();
    }
  });

  it("drops a finished result when the server ends the session", async () => {
    const { store, admin, excel } = await makeStore();
    await signIn(store, admin);
    const upload = store.dispatch(excel.excelWeeklyFileUpload(new FormData()));
    await tick();
    gates[0].open();
    await upload;
    store.dispatch({ type: "admin/access-admin/rejected", payload: "UNAUTHORIZED", meta: { requestId: "y", requestStatus: "rejected" } });
    expect(store.getState().excel.weekly.result).toBeNull();
  });

  it("keeps a finished result through a lost connection that only delays the access check", async () => {
    const { store, admin, excel } = await makeStore();
    await signIn(store, admin);
    const upload = store.dispatch(excel.excelWeeklyFileUpload(new FormData()));
    await tick();
    gates[0].open();
    await upload;
    store.dispatch({ type: "admin/access-admin/rejected", payload: { transient: true }, meta: { requestId: "z", requestStatus: "rejected" } });
    expect(excel.selectWeeklyResult(store.getState())).not.toBeNull();
  });

  it("ignores an upload answer that arrives after the administrator signed out, and after the next one signed in", async () => {
    const { store, admin, excel } = await makeStore();
    await signIn(store, admin);
    const upload = store.dispatch(excel.excelWeeklyFileUpload(new FormData()));
    await tick();
    await store.dispatch(admin.adminLogout());
    await signIn(store, admin, "city");
    gates[0].open(); // the first administrator's answer arrives now
    await upload;
    expect(store.getState().excel.weekly.result).toBeNull();
    expect(store.getState().excel.weekly.loading).toBe(false);
    expect(excel.selectWeeklyResult(store.getState())).toBeNull();
  });

  it("ignores a late answer to an older upload of the same session", async () => {
    const { store, admin, excel } = await makeStore();
    await signIn(store, admin);
    const first = store.dispatch(excel.excelWeeklyFileUpload(new FormData()));
    await tick();
    const second = store.dispatch(excel.excelWeeklyFileUpload(new FormData()));
    await tick();
    gates[1].open();
    await second;
    gates[0].open(); // the older upload answers last
    await first;
    expect(excel.selectWeeklyResult(store.getState())?.claims.marker).toBe("answer-2");
  });
});
