import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

// The driver's own profile page (full name, email, phone) with the real store, a fake server and a made-up driver.

const PROFILE = { name: "Dee Test", email: "dee@example.com", phoneNumber: "903-405-8843" };

const startServer = async ({ onSave, loadFails = false, language = "en", hold = null } = {}) => { // hold: a promise the server waits for before answering the profile requests
  const state = { profile: { ...PROFILE }, puts: [], gets: 0 };
  await installServer(async (config) => {
    if (config.url === "/driver/access-driver") return { status: 200, data: { driver: { id: 1, name: state.profile.name, email: state.profile.email, agreement_signed: true } } };
    if (config.url.startsWith("/driver/language/")) return { status: 200, data: { preferredLanguage: language } };
    if (config.url === "/driver/profile" && config.method === "get") {
      state.gets += 1;
      if (hold) await hold;
      return loadFails ? { status: 500, data: { message: "Server error" } } : { status: 200, data: { success: true, profile: state.profile } };
    }
    if (config.url === "/driver/profile" && config.method === "put") {
      const body = JSON.parse(config.data);
      state.puts.push(body);
      if (hold) await hold;
      if (onSave) return onSave(state, body);
      const { currentPassword, ...saved } = body; // eslint-disable-line no-unused-vars
      state.profile = saved;
      return { status: 200, data: { success: true, message: "Profile updated", profile: saved } };
    }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async (language = "en") => {
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const driverSlice = (await import("../../redux/slice/driver/driverSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const profileReducer = (await import("../../redux/slice/driver/profileSlice.js")).default;
  const { default: Profile } = await import("./Profile.jsx");
  const store = configureStore({
    reducer: { driver: driverSlice, language: languageReducer, driverProfile: profileReducer },
    preloadedState: { language: { ...languageReducer(undefined, { type: "init" }), currentLanguage: language } },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/driver/profile"]}>
        <Routes><Route path="/driver/profile" element={<Profile />} /></Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
};

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the profile page", () => {
  it("shows the three details, then edits them and shows what was saved", async () => {
    const server = await startServer();
    const store = await mount();
    expect(await screen.findByText("dee@example.com")).toBeTruthy();
    expect(screen.getByText("903-405-8843")).toBeTruthy();
    expect(screen.queryByLabelText(/Full name/)).toBeNull(); // read-only until Edit

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Dee  Better" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: "903-405-0000" } });
    // the email is the sign-in: changing it asks for the current password, and Save waits for it
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: "my-pass-1" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    fireEvent.click(save); // a double click saves once

    await screen.findByText("new@example.com");
    expect(server.puts).toEqual([{ name: "Dee  Better", email: "new@example.com", phoneNumber: "903-405-0000", currentPassword: "my-pass-1" }]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull(); // back to the read-only view
    // the name in the header is the new one without another request
    expect(store.getState().driver.driver).toMatchObject({ id: 1, name: "Dee  Better", email: "new@example.com" });
  });

  it("sends only the three fields and no password when the email stays the same: no id of any kind", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: "903-405-1111" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(Object.keys(server.puts[0]).sort()).toEqual(["email", "name", "phoneNumber"]);
    expect(screen.queryByLabelText(/Current password/)).toBeNull();
  });

  it("asks for the password only while the email is being changed, shows a wrong password next to its field and never keeps it", async () => {
    const server = await startServer({ onSave: () => ({ status: 403, data: { success: false, message: "Your current password is not correct.", errors: { currentPassword: "Your current password is not correct." } } }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    expect(screen.queryByLabelText(/Current password/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "new@example.com" } });
    const password = screen.getByLabelText(/Current password/);
    expect(password.type).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    fireEvent.change(password, { target: { value: "wrong-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Your current password is not correct.");
    expect(screen.getByLabelText(/Current password/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Current password/).value).toBe(""); // cleared as soon as the request was made
    expect(screen.getByLabelText(/Email/).value).toBe("new@example.com"); // what else was typed stays
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "dee@example.com" } }); // back to the stored email
    expect(screen.queryByLabelText(/Current password/)).toBeNull();
    expect(server.puts).toHaveLength(1);
  });

  it("tells the driver that an admin checks a new email or phone before payment setup continues", async () => {
    await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Dee Renamed" } });
    expect(screen.queryByText(/Your admin will check your new email or phone/)).toBeNull(); // a name change needs no check
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: "903-405-2222" } });
    expect(screen.getByText(/Your admin will check your new email or phone/)).toBeTruthy();
  });

  it("ignores a profile that arrives after the driver signed out", async () => {
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    await startServer({ hold });
    const store = await mount();
    const { driverLogout } = await import("../../redux/slice/driver/driverSlice.js");
    store.dispatch({ type: driverLogout.pending.type });
    store.dispatch({ type: driverLogout.fulfilled.type });
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getState().driverProfile.profile).toBeNull();
    expect(store.getState().driverProfile.loadStatus).toBe("idle");
  });

  it("ignores a save that finishes after the driver signed out: no profile and no header name come back", async () => {
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const server = await startServer();
    const store = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: "903-405-3333" } });
    // the server now holds its answer, as if the network were slow
    await installServer(async (config) => {
      if (config.url === "/driver/profile" && config.method === "put") { await hold; return { status: 200, data: { success: true, message: "Profile updated", profile: { ...PROFILE, name: "Late Name" } } }; }
      return { status: 200, data: {} };
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const { driverLogout } = await import("../../redux/slice/driver/driverSlice.js");
    await waitFor(() => expect(store.getState().driverProfile.saveStatus).toBe("saving"));
    store.dispatch({ type: driverLogout.pending.type });
    store.dispatch({ type: driverLogout.fulfilled.type });
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getState().driverProfile.profile).toBeNull();
    expect(store.getState().driverProfile.saveStatus).toBe("idle");
    expect(store.getState().driver.driver).toBeNull();
    expect(server.puts).toHaveLength(0); // the second server took the request
  });

  it("shows a refusal next to its field, keeps what the driver typed, and lets them cancel", async () => {
    const server = await startServer({ onSave: () => ({ status: 409, data: { success: false, message: "Another driver already uses this email", errors: { email: "Another driver already uses this email" } } }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "taken@example.com" } });
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: "my-pass-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Another driver already uses this email");
    const email = screen.getByLabelText(/Email/);
    expect(email.value).toBe("taken@example.com");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(email, { target: { value: "other@example.com" } });
    expect(screen.queryByRole("alert")).toBeNull(); // typing clears the message

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("dee@example.com")).toBeTruthy(); // the stored value, not the typed one
    expect(server.profile.email).toBe("dee@example.com");
  });

  it("warns that the name is how weekly reports find the driver", async () => {
    await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    expect(screen.getByText(/tell your admin/)).toBeTruthy();
  });

  it("offers Try again when the profile cannot be loaded", async () => {
    const server = await startServer({ loadFails: true });
    await mount();
    expect(await screen.findByText("Could not load your profile.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(server.gets).toBe(2));
  });

  it("speaks Spanish when the driver's language is Spanish", async () => {
    await startServer({ language: "es" });
    await mount("es");
    expect(await screen.findByText("Mi perfil")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Editar/ }));
    expect(screen.getByLabelText(/Nombre completo/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
  });
});
