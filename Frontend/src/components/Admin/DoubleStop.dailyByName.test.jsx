import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

// The upload page shows what the daily upload did with every row when the server sends it (the "find drivers by name" switch is on), and nothing
// extra when it does not. Made-up answers only.
const BY_NAME = {
  rows: { inFile: 3, placed: 2, unreadable: 0, name_not_matched: 1, driver_disabled: 0, route_not_in_app: 0, route_disabled: 0, route_without_city: 0, paid_day: 0, clash: 0, counted: 3 },
  days: { created: 1, extended: 0, rebuilt: 0 },
  unmatchedNames: { total: 1, list: [{ cityId: 3, city: "Test City", fileName: "Ana P.", parcels: 1, routes: ["TST 001-1"] }] },
  disabledDrivers: { total: 0, list: [] }, missingRoutes: { total: 0, list: [] }, atMainPrice: { total: 0, list: [] },
  movedToSub: { total: 0, list: [] }, clashes: { total: 0, list: [] }, paidDays: { total: 0, list: [] },
};

let uploads = 0;
const mount = async (answer) => {
  uploads = 0;
  await installServer(async (config) => {
    if (config.url?.includes("dailyFileUpload")) uploads += 1;
    if (config.url?.includes("dailyFileUpload")) return { status: 200, data: { success: true, message: "Excel processed successfully", rowsRead: 3, ...answer } };
    return { status: 200, data: { success: true, data: [], pagination: { totalItems: 0, totalPages: 0, currentPage: 1 } } };
  });
  const [{ store }, { Provider }, { default: DoubleStop }] = await Promise.all([import("../../redux/store.js"), import("react-redux"), import("./DoubleStop.jsx")]);
  render(<Provider store={store}><MemoryRouter><DoubleStop /></MemoryRouter></Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "Daily" }));
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(["x"], "day.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload Daily Data" }));
};

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("daily upload page", () => {
  it("shows the drivers-found-by-name result under the daily form", async () => {
    await mount({ byName: BY_NAME });
    expect(await screen.findByTestId("daily-by-name")).toBeTruthy();
    expect(screen.getByTestId("daily-reconciliation").textContent).toBe("3 rows in the file = 2 added to a driver + 1 name not matched");
  });

  it("shows no such result when the server sends none (the switch is off)", async () => {
    await mount({});
    await waitFor(() => expect(uploads).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload Daily Data" })).toBeTruthy()); // done, not "Processing..."
    expect(screen.queryByTestId("daily-by-name")).toBeNull();
  });
});
