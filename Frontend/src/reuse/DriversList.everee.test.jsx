import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../test/fakeShell";

vi.mock("../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// The Users page's drivers table with each driver's payment setup status (Everee for Local drivers, QuickBooks for Desi drivers), chips with counts, filters and sorting. A fake server answers GET
// /admin/get-users the way the real one does (the server does the filtering and sorting; here we check what is asked and what is shown).
const row = (id, name, status, extra = {}) => ({ id, driver_code: 100 + id, name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone_number: "903-405-8843", job: "Test City", enabled: true, driver_type: "LOCAL", everee_status: status, everee_needs: [], ...extra });
const DRIVERS = [
  row(1, "Ann Done", "complete"),
  row(2, "Bob Midway", "in-progress"),
  row(3, "Cy Waiting", "not-started", { phone_number: null, everee_needs: ["no_phone", "agreement_not_signed"] }),
  row(4, "Di Check", "needs-review"),
  row(5, "Eli Desi", "not-required", { driver_type: "DESI", quickbooks_status: "complete", quickbooks_needs: [] }),
  row(6, "Flo Untyped", "classification-required", { driver_type: null }),
  row(7, "Gus Desi", "not-required", { driver_type: "DESI", quickbooks_status: "not-started", quickbooks_needs: ["agreement_not_signed", "no_email"] }),
  row(8, "Hal Desi", "not-required", { driver_type: "DESI", quickbooks_status: "needs-review", quickbooks_needs: [] }),
];
const COUNTS = { all: 8, complete: 2, "in-progress": 1, "not-started": 2, "needs-review": 2, "company-not-connected": 0, "not-required": 0, "classification-required": 1, "service-unavailable": 0 };
const EVEREE = { available: true, configured: true, onboardingEnabled: true, enforced: true };
const QUICKBOOKS = { available: true, configured: true, companyConnected: true, onboardingEnabled: true, enforced: true };
const statusOf = (d) => (d.driver_type === "DESI" ? d.quickbooks_status : d.everee_status);

const startServer = async ({ everee = EVEREE, quickbooks = QUICKBOOKS, drivers = DRIVERS, counts = COUNTS } = {}) => {
  const lists = [];
  await installServer(async (config) => {
    if (config.url === "/admin/get-users") {
      const p = config.params ?? {};
      lists.push(p);
      const shown = drivers.filter((d) => !p.status || statusOf(d) === p.status);
      return { status: 200, data: { drivers: shown, page: p.page ?? 1, totalPages: 1, total: shown.length, counts, everee, quickbooks } };
    }
    return { status: 200, data: {} };
  });
  return lists;
};

const mount = async () => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const usersReducer = (await import("../redux/slice/admin/userLoadSlice.js")).default;
  const { default: DriversList } = await import("./DriversList.jsx");
  render(<Provider store={configureStore({ reducer: { users: usersReducer } })}><DriversList onEdit={() => {}} /></Provider>);
  await waitFor(() => expect(screen.getByText("Ann Done")).toBeTruthy());
};
const rowOf = (name) => screen.getByText(name).closest("tr");
const last = (lists) => lists.at(-1);

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("Users page: payment setup status", () => {
  it("shows each driver's status in words, and what a driver who is not onboarded still needs", async () => {
    await startServer();
    await mount();
    for (const [name, label] of [["Ann Done", "Onboarded"], ["Bob Midway", "In progress"], ["Cy Waiting", "Not started"], ["Di Check", "Needs review"], ["Flo Untyped", "Type not set"]]) {
      expect(within(rowOf(name)).getByText(label), name).toBeTruthy();
    }
    const waiting = within(screen.getByTestId("setup-3"));
    expect(waiting.getByText("Add a valid 10-digit phone number")).toBeTruthy();
    expect(waiting.getByText("Agreement not signed")).toBeTruthy();
    expect(within(screen.getByTestId("setup-1")).queryByRole("list")).toBeNull();
    expect(within(rowOf("Ann Done")).getByText("Onboarded").getAttribute("title")).toMatch(/active for work and pay/);
  });

  it("a Local driver shows Everee and a Desi driver shows the QuickBooks form status, with what a Desi driver still needs", async () => {
    await startServer();
    await mount();
    expect(within(screen.getByTestId("setup-1")).getByText("Everee")).toBeTruthy();
    for (const [name, label] of [["Eli Desi", "Onboarded"], ["Gus Desi", "Not started"], ["Hal Desi", "Needs review"]]) {
      const cell = within(rowOf(name));
      expect(cell.getByText("QuickBooks"), name).toBeTruthy();
      expect(cell.getByText(label), name).toBeTruthy();
    }
    // Onboarded means a vendor is linked (the driver may have filled the form, or an admin linked an existing vendor); it does not say the driver is paid through NASA.
    const linkedHint = within(rowOf("Eli Desi")).getByText("Onboarded").getAttribute("title");
    expect(linkedHint).toMatch(/QuickBooks vendor is linked/);
    expect(linkedHint).toMatch(/check, outside NASA/);
    expect(linkedHint).not.toMatch(/filled in|can be paid through/);
    expect(within(rowOf("Gus Desi")).getByText("Not started").getAttribute("title")).toMatch(/QuickBooks form/);
    const gus = within(screen.getByTestId("setup-7"));
    expect(gus.getByText("Agreement not signed")).toBeTruthy();
    expect(gus.getByText("Add a valid email address")).toBeTruthy();
    expect(within(screen.getByTestId("setup-5")).queryByRole("list")).toBeNull();
    expect(within(rowOf("Flo Untyped")).queryByText("Everee")).toBeNull();
    expect(within(rowOf("Flo Untyped")).queryByText("QuickBooks")).toBeNull();
  });

  it("with no QuickBooks company connected, Desi drivers say so and are not sent to a form they cannot complete", async () => {
    const desi = (id, name, over = {}) => row(id, name, "not-required", { driver_type: "DESI", quickbooks_status: "company-not-connected", quickbooks_needs: [], ...over });
    await startServer({ quickbooks: { ...QUICKBOOKS, companyConnected: false }, drivers: [DRIVERS[0], desi(5, "Eli Desi"), desi(7, "Gus Desi")] });
    await mount();
    expect(screen.getByTestId("quickbooks-no-company").textContent).toMatch(/No QuickBooks company is connected/);
    for (const name of ["Eli Desi", "Gus Desi"]) {
      const cell = within(rowOf(name));
      expect(cell.getByText("Company not connected").getAttribute("title"), name).toMatch(/Connect the company first/);
      expect(cell.queryByText(/Add a valid email|Agreement not signed/), name).toBeNull();
    }
    expect(within(rowOf("Eli Desi")).queryByText("Not started")).toBeNull();
    // The chip appears only when some driver is in this state.
    expect(within(screen.getByTestId("status-chips")).queryByRole("button", { name: /Company not connected/ })).toBeNull();
    cleanup();
    await startServer({ quickbooks: { ...QUICKBOOKS, companyConnected: false }, drivers: [DRIVERS[0], desi(5, "Eli Desi"), desi(7, "Gus Desi")], counts: { ...COUNTS, "company-not-connected": 2 } });
    await mount();
    expect(within(screen.getByTestId("status-chips")).getByRole("button", { name: "Company not connected (2)" })).toBeTruthy();
  });

  it("says when QuickBooks is not set up or switched off, and when Desi drivers who are not set up are on hold", async () => {
    await startServer({ quickbooks: { available: true, configured: false, onboardingEnabled: false, enforced: false } });
    await mount();
    expect(screen.getByTestId("quickbooks-unavailable").textContent).toMatch(/not set up on this server/);
    expect(screen.queryByTestId("quickbooks-off")).toBeNull();
    cleanup();
    await startServer({ quickbooks: { available: true, configured: true, onboardingEnabled: false, enforced: false } });
    await mount();
    expect(screen.getByTestId("quickbooks-off").textContent).toMatch(/switched off/);
    expect(screen.queryByTestId("quickbooks-enforced")).toBeNull();
    cleanup();
    await startServer();
    await mount();
    expect(screen.getByTestId("quickbooks-enforced").textContent).toMatch(/on hold/);
    expect(screen.queryByTestId("quickbooks-off")).toBeNull();
    expect(screen.queryByTestId("quickbooks-unavailable")).toBeNull();
  });

  it("says when Everee onboarding is off, and when not onboarded Local drivers are on hold", async () => {
    await startServer({ everee: { available: true, configured: true, onboardingEnabled: false, enforced: false } });
    await mount();
    expect(screen.getByTestId("everee-off").textContent).toMatch(/switched off/);
    expect(screen.queryByTestId("everee-enforced")).toBeNull();
    cleanup();
    await startServer();
    await mount();
    expect(screen.getByTestId("everee-enforced").textContent).toMatch(/on hold/);
    expect(screen.queryByTestId("everee-off")).toBeNull();
  });
});

describe("Users page: status chips", () => {
  it("shows how many drivers are in each state, and choosing one asks the server for just those", async () => {
    const lists = await startServer();
    await mount();
    const chips = within(screen.getByTestId("status-chips"));
    expect(chips.getByRole("button", { name: "All (8)" }).getAttribute("aria-pressed")).toBe("true");
    for (const name of ["Onboarded (2)", "In progress (1)", "Not started (2)", "Needs review (2)", "Type not set (1)"]) expect(chips.getByRole("button", { name })).toBeTruthy();
    expect(chips.queryByRole("button", { name: /Not set up|Not needed/ }), "hidden while nobody has it").toBeNull();
    fireEvent.click(chips.getByRole("button", { name: "Not started (2)" }));
    await waitFor(() => expect(last(lists).status).toBe("not-started"));
    expect(last(lists).page).toBe(1);
    await waitFor(() => expect(screen.queryByText("Ann Done")).toBeNull());
    expect(screen.getByText("Cy Waiting")).toBeTruthy();
    expect(screen.getByText("Gus Desi"), "a Desi driver with the same status is listed too").toBeTruthy();
    expect(chips.getByRole("button", { name: "Not started (2)" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Setup: Not started")).toBeTruthy();
    fireEvent.click(chips.getByRole("button", { name: "Not started (2)" }));
    await waitFor(() => expect(last(lists).status).toBeUndefined());
    await waitFor(() => expect(screen.getByText("Ann Done")).toBeTruthy());
  });

  it("changing a filter clears the selection, so a driver you can no longer see is never changed by accident", async () => {
    await startServer();
    await mount();
    fireEvent.click(within(rowOf("Ann Done")).getByRole("checkbox", { name: "Select Ann Done" }));
    expect(screen.getByRole("button", { name: "Change (1)" })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("status-chips")).getByRole("button", { name: "Onboarded (2)" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Change \(/ })).toBeNull());
  });
});

describe("Users page: filters and sorting", () => {
  it("filters by driver type, account and what needs fixing, shows each as a removable tag, and Clear removes them all", async () => {
    const lists = await startServer();
    await mount();
    fireEvent.change(screen.getByLabelText("Driver type"), { target: { value: "LOCAL" } });
    await waitFor(() => expect(last(lists).type).toBe("LOCAL"));
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "disabled" } });
    await waitFor(() => expect(last(lists).enabled).toBe("disabled"));
    fireEvent.change(screen.getByLabelText("Needs fixing"), { target: { value: "no_phone" } });
    await waitFor(() => expect(last(lists)).toMatchObject({ type: "LOCAL", enabled: "disabled", issue: "no_phone", page: 1 }));
    expect(screen.getByText("Needs fixing: No valid phone number")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove the Account filter" }));
    await waitFor(() => expect(last(lists).enabled).toBeUndefined());
    expect(last(lists)).toMatchObject({ type: "LOCAL", issue: "no_phone" });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(last(lists).type).toBeUndefined());
    expect(last(lists).issue).toBeUndefined();
    expect(screen.getByLabelText("Driver type").value).toBe("");
  });

  it("sorts by pressing a column heading, reverses on a second press, and says which way in the heading", async () => {
    const lists = await startServer();
    await mount();
    const th = (name) => screen.getByRole("columnheader", { name: new RegExp(`^${name}`) });
    expect(th("Name").getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: /^Payment Setup/ }));
    await waitFor(() => expect(last(lists).sort).toBe("status"));
    expect(last(lists).dir).toBeUndefined();
    expect(th("Payment Setup").getAttribute("aria-sort")).toBe("ascending");
    expect(th("Name").getAttribute("aria-sort")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Payment Setup/ }));
    await waitFor(() => expect(last(lists).dir).toBe("desc"));
    expect(th("Payment Setup").getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: /^City/ }));
    await waitFor(() => expect(last(lists).sort).toBe("city"));
    expect(last(lists).dir).toBeUndefined();
  });

  it("the Sort by list and the Order button do the same, for phones where the table scrolls", async () => {
    const lists = await startServer();
    await mount();
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "status" } });
    await waitFor(() => expect(last(lists).sort).toBe("status"));
    fireEvent.click(screen.getByRole("button", { name: /^Order: ascending/ }));
    await waitFor(() => expect(last(lists).dir).toBe("desc"));
    expect(screen.getByRole("button", { name: /^Order: descending/ })).toBeTruthy();
  });

  it("shows how many drivers match", async () => {
    await startServer();
    await mount();
    expect(screen.getByTestId("driver-total").textContent).toBe("8 drivers");
  });
});
