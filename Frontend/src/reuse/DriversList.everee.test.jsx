import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../test/fakeShell";

vi.mock("../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// The Users page's drivers table with each driver's Everee onboarding status, chips with counts, filters and sorting. A fake server answers GET
// /admin/get-users the way the real one does (the server does the filtering and sorting; here we check what is asked and what is shown).
const row = (id, name, status, extra = {}) => ({ id, driver_code: 100 + id, name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone_number: "903-405-8843", job: "Test City", enabled: true, driver_type: "LOCAL", everee_status: status, everee_needs: [], ...extra });
const DRIVERS = [
  row(1, "Ann Done", "complete"),
  row(2, "Bob Midway", "in-progress"),
  row(3, "Cy Waiting", "not-started", { phone_number: null, everee_needs: ["no_phone", "agreement_not_signed"] }),
  row(4, "Di Check", "needs-review"),
  row(5, "Eli Desi", "not-required", { driver_type: "DESI" }),
  row(6, "Flo Untyped", "classification-required", { driver_type: null }),
];
const COUNTS = { all: 6, complete: 1, "in-progress": 1, "not-started": 1, "needs-review": 1, "not-required": 1, "classification-required": 1, "service-unavailable": 0 };

const startServer = async ({ everee = { available: true, configured: true, onboardingEnabled: true, enforced: true }, drivers = DRIVERS } = {}) => {
  const lists = [];
  await installServer(async (config) => {
    if (config.url === "/admin/get-users") {
      const p = config.params ?? {};
      lists.push(p);
      const shown = drivers.filter((d) => !p.status || d.everee_status === p.status);
      return { status: 200, data: { drivers: shown, page: p.page ?? 1, totalPages: 1, total: shown.length, counts: COUNTS, everee } };
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

describe("Users page: Everee onboarding status", () => {
  it("shows each driver's status in words, and what a driver who is not onboarded still needs", async () => {
    await startServer();
    await mount();
    for (const [name, label] of [["Ann Done", "Onboarded"], ["Bob Midway", "In progress"], ["Cy Waiting", "Not started"], ["Di Check", "Needs review"], ["Eli Desi", "Not needed"], ["Flo Untyped", "Type not set"]]) {
      expect(within(rowOf(name)).getByText(label), name).toBeTruthy();
    }
    const waiting = within(screen.getByTestId("everee-3"));
    expect(waiting.getByText("Add a valid 10-digit phone number")).toBeTruthy();
    expect(waiting.getByText("Agreement not signed")).toBeTruthy();
    expect(within(screen.getByTestId("everee-1")).queryByRole("list")).toBeNull();
    expect(within(rowOf("Ann Done")).getByText("Onboarded").getAttribute("title")).toMatch(/active for work and pay/);
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
    expect(chips.getByRole("button", { name: "All (6)" }).getAttribute("aria-pressed")).toBe("true");
    for (const name of ["Onboarded (1)", "In progress (1)", "Not started (1)", "Needs review (1)", "Not needed (Desi) (1)", "Type not set (1)"]) expect(chips.getByRole("button", { name })).toBeTruthy();
    expect(chips.queryByRole("button", { name: /Everee not set up/ }), "hidden while nobody has it").toBeNull();
    fireEvent.click(chips.getByRole("button", { name: "Not started (1)" }));
    await waitFor(() => expect(last(lists).status).toBe("not-started"));
    expect(last(lists).page).toBe(1);
    await waitFor(() => expect(screen.queryByText("Ann Done")).toBeNull());
    expect(screen.getByText("Cy Waiting")).toBeTruthy();
    expect(chips.getByRole("button", { name: "Not started (1)" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Everee: Not started")).toBeTruthy();
    fireEvent.click(chips.getByRole("button", { name: "Not started (1)" }));
    await waitFor(() => expect(last(lists).status).toBeUndefined());
    await waitFor(() => expect(screen.getByText("Ann Done")).toBeTruthy());
  });

  it("changing a filter clears the selection, so a driver you can no longer see is never changed by accident", async () => {
    await startServer();
    await mount();
    fireEvent.click(within(rowOf("Ann Done")).getByRole("checkbox", { name: "Select Ann Done" }));
    expect(screen.getByRole("button", { name: "Change (1)" })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("status-chips")).getByRole("button", { name: "Onboarded (1)" }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Everee/ }));
    await waitFor(() => expect(last(lists).sort).toBe("status"));
    expect(last(lists).dir).toBeUndefined();
    expect(th("Everee").getAttribute("aria-sort")).toBe("ascending");
    expect(th("Name").getAttribute("aria-sort")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Everee/ }));
    await waitFor(() => expect(last(lists).dir).toBe("desc"));
    expect(th("Everee").getAttribute("aria-sort")).toBe("descending");
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
    expect(screen.getByTestId("driver-total").textContent).toBe("6 drivers");
  });
});
