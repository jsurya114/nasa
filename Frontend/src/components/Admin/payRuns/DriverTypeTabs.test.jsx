import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, removeShell, resetBrowser } from "../../../test/fakeShell";

// "Pay to drivers" with Local and Desi tabs, made-up answers, nothing leaves this machine. Desi drivers: Cash in Hand only. Local drivers: Cash in Hand
// or Everee. A driver with no type cannot be paid. One payment is for one tab, so the types are never mixed.
const RUN = { id: 17, city: "Test City", period_start: "2026-11-01", period_end: "2026-11-07", status: "finalized" };
const driver = (id, name, net, driverType, extra = {}) => ({ statementId: id, driverId: id, driverName: name, driverType, payoutStatus: "not_submitted", eligible: driverType !== null, amounts: { net }, blockers: driverType ? [] : [{ code: "driver_type_not_set", severity: "blocking", message: "set this driver as Local or Desi in the Drivers page before paying" }], payment: null, providerPayment: null, ...extra });
const DRIVERS = [
  driver(1, "Lou Local", "100.00", "LOCAL"),
  driver(2, "Lena Local", "50.00", "LOCAL"),
  driver(3, "Dev Desi", "70.00", "DESI"),
  driver(4, "Dina Desi", "30.00", "DESI"),
  driver(5, "Nia None", "20.00", null),
];

const start = async ({ drivers = DRIVERS, record } = {}) => {
  const state = { records: [], previews: [], everee: [] };
  await installServer(async (config) => {
    if (config.url === "/admin/payroll/everee/status") return { status: 200, data: { configured: true, environment: "sandbox" } };
    if (config.url.endsWith("/everee-preview")) {
      state.previews.push(config.params);
      const ids = String(config.params.statementIds).split(",").map(Number);
      return { status: 200, data: { run: RUN, environment: "sandbox", drivers: [], summary: { drivers: ids.length, eligible: ids.length, blocked: 0, total: "150.00" }, batchBlockers: [], canSubmit: true, previewHash: "a".repeat(64) } };
    }
    if (config.url.endsWith("/everee-batches") && config.method === "get") return { status: 200, data: { batches: [] } };
    if (config.url.endsWith("/everee-batches") && config.method === "post") { state.everee.push(JSON.parse(config.data)); return { status: 200, data: {} }; }
    if (config.url.endsWith("/record") && config.method === "post") {
      const body = JSON.parse(config.data);
      state.records.push(body);
      if (record) return record(body);
      return { status: 200, data: { receipt: { drivers: body.statementIds.length, total: "170.00", paid_on: body.paidOn, method: body.method, reference: body.reference, recorded_by_name: "Sam Super" } } };
    }
    if (config.url === "/admin/payroll/payments/runs/17") return { status: 200, data: { run: RUN, drivers, summary: { pendingClaims: { total: 0 } } } };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async () => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const { default: RecordPaymentDialog } = await import("./RecordPaymentDialog.jsx");
  const store = configureStore({ reducer: { admin: (s = { isSuperAdmin: true }) => s } });
  render(<Provider store={store}><MemoryRouter><RecordPaymentDialog runId={17} cityName="Test City" onClose={() => {}} onRecorded={() => {}} /></MemoryRouter></Provider>);
  await screen.findByRole("tablist", { name: "Driver type" });
};
const tab = (name) => screen.getByRole("tab", { name: new RegExp(name) });
const names = () => [...document.querySelectorAll("ul li label span.block.font-semibold")].map((n) => n.textContent);
const total = () => document.querySelector("p.text-2xl").textContent;
const box = (name) => screen.getByRole("checkbox", { name: new RegExp(name) });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue with payment" }));
const methods = () => within(screen.getByLabelText("Payment method")).getAllByRole("option").map((o) => o.textContent);

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("Pay to drivers by driver type", () => {
  it("has a Local tab, a Desi tab and a Not set tab, each with its own unpaid count; each lists only its own drivers", async () => {
    await start();
    await mount();
    expect(tab("Local drivers").textContent).toBe("Local drivers (2)");
    expect(tab("Desi drivers").textContent).toBe("Desi drivers (2)");
    expect(tab("Not set").textContent).toBe("Not set (1)");
    expect(names()).toEqual(["Lou Local", "Lena Local"]);
    fireEvent.click(tab("Desi drivers"));
    expect(names()).toEqual(["Dev Desi", "Dina Desi"]);
    fireEvent.click(tab("Not set"));
    expect(names()).toEqual(["Nia None"]);
  });

  it("the Not set tab only appears when some driver has no type", async () => {
    await start({ drivers: DRIVERS.filter((d) => d.driverType) });
    await mount();
    expect(screen.queryByRole("tab", { name: /Not set/ })).toBeNull();
  });

  it("a driver with no type cannot be selected or paid: no checkbox, nothing selected, Continue is off", async () => {
    await start();
    await mount();
    fireEvent.click(tab("Not set"));
    expect(screen.queryByRole("checkbox", { name: /Nia/ })).toBeNull();
    expect(screen.getByText("Needs a driver type")).toBeTruthy();
    expect(screen.getByText(/Set Local or Desi for them on the Drivers page/)).toBeTruthy();
    expect(screen.getByText(/Selected: 0 of/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with payment" }).disabled).toBe(true);
  });

  it("opens on the first tab with drivers to pay and selects its drivers; selecting is per tab, with a count and a total", async () => {
    await start();
    await mount();
    expect(tab("Local drivers").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Selected: 2 of 2 unpaid Local drivers/)).toBeTruthy();
    expect(total()).toBe("$150.00");
    fireEvent.click(box("Lena"));
    expect(screen.getByText(/Selected: 1 of 2 unpaid Local drivers/)).toBeTruthy();
    expect(total()).toBe("$100.00");
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(total()).toBe("$0.00");
    fireEvent.click(screen.getByRole("button", { name: "Select all unpaid" }));
    expect(screen.getByText(/Selected: 2 of 2/)).toBeTruthy();
  });

  it("switching tab starts a fresh selection of that tab only: the two types are never in one payment", async () => {
    const server = await start();
    await mount();
    fireEvent.click(tab("Desi drivers"));
    expect(screen.getByText(/Selected: 2 of 2 unpaid Desi drivers/)).toBeTruthy();
    expect(total()).toBe("$100.00");
    next();
    await screen.findByLabelText("Drivers in this payment");
    expect(within(screen.getByLabelText("Drivers in this payment")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Dev Desi$70.00", "Dina Desi$30.00"]);
    expect(server.records).toEqual([]);
  });

  it("Desi drivers: the method is Check and cannot be changed; Everee is not offered and never called", async () => {
    const server = await start();
    await mount();
    fireEvent.click(tab("Desi drivers"));
    next();
    await screen.findByText(/Desi drivers are paid by check only\)/);
    expect(screen.queryByLabelText("Payment method")).toBeNull(); // no dropdown, so nothing to choose
    expect(screen.queryByText(/Everee/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over" } });
    fireEvent.click(screen.getByLabelText(/I confirm the selected drivers have received/));
    expect((await screen.findByRole("status", { name: "Payment summary" })).textContent).toBe("Check · 2 drivers · $100.00");
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Payment recorded")).toBeTruthy();
    expect(server.records).toHaveLength(1);
    expect(server.records[0]).toMatchObject({ method: "cash", statementIds: [3, 4], reference: "Cash handed over", confirmed: true });
    expect(server.previews).toEqual([]);
    expect(server.everee).toEqual([]);
  });

  it("Local drivers: Cash in Hand or Bank transfer (Everee), and nothing else; a cash payment sends only the chosen Local drivers", async () => {
    const server = await start();
    await mount();
    fireEvent.click(box("Lena")); // leave Lou only
    next();
    await screen.findByLabelText("Payment method");
    expect(methods()).toEqual(["Choose a method", "Bank transfer (Everee)", "Cash in Hand"]);
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "cash" } });
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over" } });
    fireEvent.click(screen.getByLabelText(/I confirm the selected drivers have received/));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Payment recorded")).toBeTruthy();
    expect(server.records[0].statementIds).toEqual([1]); // never "everyone left": the run also holds Desi and untyped drivers
    expect(server.records[0].method).toBe("cash");
  });

  it("Local drivers through Everee: only the chosen Local drivers are previewed and sent", async () => {
    const server = await start();
    await mount();
    next();
    await screen.findByLabelText("Payment method");
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "everee" } });
    await waitFor(() => expect(server.previews).toEqual([{ statementIds: "1,2" }]));
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay.disabled).toBe(false));
    fireEvent.click(pay);
    await waitFor(() => expect(server.everee).toHaveLength(1));
    expect(server.everee[0].statementIds).toEqual([1, 2]);
    expect(server.records).toEqual([]);
  });

  it("a failed cash payment keeps the dialog and the chosen drivers, and says why; the same request ID is used for the retry", async () => {
    let fail = true;
    const server = await start({ record: () => (fail ? { status: 409, data: { message: "Some selected drivers have no driver type." } } : { status: 200, data: { receipt: { drivers: 2, total: "100.00", paid_on: "2026-11-06", method: "cash", reference: "Cash handed over", recorded_by_name: "Sam Super" } } }) });
    await mount();
    fireEvent.click(tab("Desi drivers"));
    next();
    await screen.findByLabelText("Payment note");
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over" } });
    fireEvent.click(screen.getByLabelText(/I confirm the selected drivers have received/));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Some selected drivers have no driver type.")).toBeTruthy();
    expect(screen.getByLabelText("Payment note").value).toBe("Cash handed over");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Payment recorded")).toBeTruthy();
    expect(server.records).toHaveLength(2);
    expect(server.records[1].requestId).toBe(server.records[0].requestId);
  });

  it("a processing or paid driver is not selectable in either tab", async () => {
    await start({ drivers: [driver(1, "Lou Local", "100.00", "LOCAL", { payoutStatus: "submitted" }), driver(2, "Lena Local", "50.00", "LOCAL"), driver(3, "Dev Desi", "70.00", "DESI", { payoutStatus: "paid" }), driver(4, "Dina Desi", "30.00", "DESI")] });
    await mount();
    expect(screen.queryByRole("checkbox", { name: /Lou/ })).toBeNull();
    expect(screen.getByText("Payment processing")).toBeTruthy();
    expect(tab("Local drivers").textContent).toBe("Local drivers (1)");
    fireEvent.click(tab("Desi drivers"));
    expect(screen.queryByRole("checkbox", { name: /Dev/ })).toBeNull();
    expect(tab("Desi drivers").textContent).toBe("Desi drivers (1)");
  });
});
