import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";
import Claims from "./Claims.jsx";

vi.mock("../../reuse/Header", () => ({ default: () => null }));
vi.mock("../../reuse/Nav", () => ({ default: () => null }));

// The Claims page: read only, one list for claims not matched to a driver yet and one for matched claims, for the admin's cities. A fake server answers
// GET /admin/claims the way the real one does (the server does the scoping, filtering and paging; here we check what is asked and what is shown).
const claim = (id, over = {}) => ({ id, courier: "gofo", waybill: `GF000${id}`, claimType: "Lost parcel", claimDate: "2026-11-03", amount: "25.00", city: "Test City", status: "unresolved",
  reason: "no delivery history for this waybill yet", courierName: "Cy Courier", driverName: null, driverCode: null, deduction: { state: "none", applied: "0.00", paid: "0.00", left: null, payout: null }, ...over });
const UNMATCHED = [claim(1), claim(2, { status: "ambiguous", reason: "the waybill is linked to more than one driver", courierName: null })];
const MATCHED = [claim(3, { status: "chargeable", driverName: "Ann Driver", driverCode: 4455, reason: "matched by waybill", courierName: null, deduction: { state: "full", applied: "25.00", paid: "0.00", left: "0.00", payout: "finalized" } }), claim(4, { status: "exempt", driverName: "Bob Driver", driverCode: 4456, claimType: "Tracking interruption" }),
  claim(5, { status: "chargeable", driverName: "Cy Driver", driverCode: 4457, amount: "50.00", deduction: { state: "partial", applied: "35.00", paid: "15.00", left: "15.00", payout: "partly_paid" } }),
  claim(6, { status: "chargeable", driverName: "Di Driver", driverCode: 4458, deduction: { state: "full", applied: "25.00", paid: "25.00", left: "0.00", payout: "paid" } })];

const startServer = async ({ unmatched = UNMATCHED, matched = MATCHED, totalPages = 1, fail = false } = {}) => {
  const asked = [];
  await installServer(async (config) => {
    if (config.url === "/admin/get-admin-cities") return { status: 200, data: { cities: [{ id: 7, job: "Test City" }, { id: 8, job: "Other City" }] } };
    if (config.url === "/admin/claims") {
      const p = config.params ?? {};
      asked.push(p);
      if (fail) return { status: 500, data: { message: "Claims could not be loaded. Try again." } };
      const rows = p.tab === "matched" ? matched : unmatched;
      return { status: 200, data: { claims: rows, total: rows.length, page: Number(p.page ?? 1), pageSize: 20, totalPages, counts: { matched: matched.length, unmatched: unmatched.length } } };
    }
    return { status: 200, data: {} };
  });
  return asked;
};
const mount = () => render(<MemoryRouter><Claims /></MemoryRouter>);
const last = (asked) => asked.at(-1);

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

it("opens on the claims not matched to a driver yet, with the waybill, why, and the counts of both lists", async () => {
  const asked = await startServer();
  mount();
  expect(await screen.findByText("GF0001")).toBeTruthy();
  expect(last(asked)).toMatchObject({ tab: "unmatched", page: 1 });
  const row = within(screen.getByTestId("claim-1"));
  expect(row.getByText("Waiting for delivery history")).toBeTruthy();
  expect(row.getByText("no delivery history for this waybill yet")).toBeTruthy();
  expect(row.getByText("Cy Courier")).toBeTruthy();
  expect(row.getByText("$25.00")).toBeTruthy();
  expect(within(screen.getByTestId("claim-2")).getByText("Not clear which driver")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not matched yet (2)" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Matched to a driver (4)" })).toBeTruthy();
  expect(screen.getByTestId("claims-total").textContent).toBe("2 claims");
});

it("the matched list names the driver and says when a claim was already taken off pay", async () => {
  const asked = await startServer();
  mount();
  await screen.findByText("GF0001");
  fireEvent.click(screen.getByRole("button", { name: /^Matched to a driver/ }));
  await waitFor(() => expect(last(asked)).toMatchObject({ tab: "matched", page: 1 }));
  const row = within(await screen.findByTestId("claim-3"));
  expect(row.getByText("Ann Driver")).toBeTruthy();
  expect(row.getByText("#4455")).toBeTruthy();
  expect(row.getByText("Chargeable")).toBeTruthy();
  expect(row.getByText("Deducted")).toBeTruthy();
  // A finalized run is approval, not a payout: it says so until the statements are recorded as paid.
  expect(row.getByTestId("deduction-3").textContent).toBe("$25.00 · in a finalized run, not paid out yet");
  const exempt = within(screen.getByTestId("claim-4"));
  expect(exempt.getByText("Exempt")).toBeTruthy();
  expect(exempt.queryByText("Deducted")).toBeNull();
  expect(exempt.queryByTestId("deduction-4")).toBeNull();
  // An amended claim partly deducted is not shown as fully deducted: what was applied, the amount, what is left, and how much has been paid out.
  const partial = within(screen.getByTestId("claim-5"));
  expect(partial.getByText("Part deducted")).toBeTruthy();
  expect(partial.queryByText("Deducted")).toBeNull();
  expect(partial.getByTestId("deduction-5").textContent).toBe("$35.00 of $50.00 deducted, $15.00 left · partly paid out");
  expect(within(screen.getByTestId("claim-6")).getByTestId("deduction-6").textContent).toBe("$25.00 · paid out");
  expect(screen.getByRole("columnheader", { name: "Driver" })).toBeTruthy();
});

it("picking a city and searching ask the server, and each starts again from the first page", async () => {
  const asked = await startServer({ totalPages: 3 });
  mount();
  await screen.findByText("GF0001");
  fireEvent.click(await screen.findByRole("button", { name: "2" }));
  await waitFor(() => expect(last(asked).page).toBe(2));
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "8" } });
  await waitFor(() => expect(last(asked)).toMatchObject({ cityId: "8", page: 1 }));
  fireEvent.click(await screen.findByRole("button", { name: "3" }));
  await waitFor(() => expect(last(asked).page).toBe(3));
  fireEvent.change(screen.getByLabelText("Search claims"), { target: { value: "  GF0002  " } });
  await waitFor(() => expect(last(asked)).toMatchObject({ search: "GF0002", cityId: "8", page: 1 }));
});

it("says so when there is nothing to show, and when a search finds nothing", async () => {
  await startServer({ unmatched: [], matched: [] });
  mount();
  expect((await screen.findByTestId("claims-empty")).textContent).toMatch(/No unmatched claims/);
  fireEvent.change(screen.getByLabelText("Search claims"), { target: { value: "zzz" } });
  await waitFor(() => expect(screen.getByTestId("claims-empty").textContent).toMatch(/No claims match this search/));
});

it("a failed load shows the server's message and Try again asks again", async () => {
  const asked = await startServer({ fail: true });
  mount();
  expect((await screen.findByRole("alert")).textContent).toMatch(/Claims could not be loaded/);
  const before = asked.length;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(asked.length).toBeGreaterThan(before));
});

it("the route is open to every signed-in admin: it sits inside the sign-in check and outside the super admin and Invoices guards", () => {
  const app = readFileSync("src/App.jsx", "utf8") /* the tests run from the Frontend folder */;
  const page = app.indexOf('path="/admin/claims"');
  const guards = [app.indexOf("<Route element={<SuperAdminRoute />}>"), app.indexOf("<Route element={<InvoiceRoute />}>")];
  expect(app.match(/path="\/admin\/claims"/g)).toHaveLength(1);
  expect(page).toBeGreaterThan(app.indexOf("<Route element={<ProtectedRoutes />}>"));
  for (const guard of guards) expect(page < guard || page > app.indexOf("</Route>", guard)).toBe(true);
});
