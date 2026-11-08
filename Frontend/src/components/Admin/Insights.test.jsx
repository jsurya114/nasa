import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";
import { daysInRange, rangeForPreset } from "./insights/insightsDates.js";

// Recharts draws nothing in a window with no layout, so every chart gets a fixed size here.
vi.mock("recharts", async (original) => {
  const React = await import("react");
  const real = await original();
  return { ...real, ResponsiveContainer: ({ children }) => React.cloneElement(children, { width: 700, height: 240 }) };
});
vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Insights page with made-up figures from a fake server. Every request is recorded, so the tests can say exactly what was asked.
const CITIES = [{ cityId: 3, name: "Alpha City", code: "ALP", type: "DAILY", enabled: true, firstDeliveryDate: "2026-01-01", lastDeliveryDate: "2026-11-05", records: 100 },
  { cityId: 4, name: "Beta City", code: "BET", type: "WEEKLY", enabled: true, firstDeliveryDate: "2026-01-01", lastDeliveryDate: "2026-11-05", records: 50 }];
const DEFINITIONS = [{ id: "delivery_margin", label: "Delivery margin", unit: "USD", definition: "Delivery revenue minus driver earnings.", caveats: ["It is not net profit."] }];
const meta = (extra = {}) => ({ generatedAt: "2026-11-06T02:00:00.000Z", definitionsVersion: "x", units: {}, scope: { description: "s" }, coverage: [{ firstDate: "2026-01-01", lastDate: "2026-11-05", recordsInPeriod: 30, daysWithRecords: 20, daysInPeriod: 30 }], warnings: ["2 records are still open."], ...extra });
const comparison = { status: "complete", change: { deliveries: { absolute: "15", percent: "10.00" }, earnedDeliveryRevenue: { absolute: "-120.50", percent: "-2.00" }, grossMarginBeforeOverheads: { absolute: "5.00", percent: "1.00" } }, note: "Compared with the immediately preceding period of the same length." };
const overview = (data = {}, extra = {}) => ({ meta: meta(extra), data: {
  deliveries: 1650, earnedDeliveryRevenue: "6000.00", grossDriverEarnings: "5100.00", grossMarginBeforeOverheads: "900.00", marginPercentage: "15.00",
  activeDrivers: 12, activeDriverDays: 60, deliveriesPerActiveDriverDay: "27.50", revenuePerDelivery: "3.64", marginPerDelivery: "0.55",
  records: { total: 30, withStoredAmounts: 28, open: 1, partialAmounts: 1, daily: 10, weekly: 20 }, comparison, ...data } });
const ranking = (rows) => ({ meta: meta(), data: { rankedBy: "revenue", ranking: rows } });
const ROWS = [
  { rank: 1, cityId: 3, name: "Alpha City", code: "ALP", deliveries: 1000, earnedDeliveryRevenue: "4000.00", grossMarginBeforeOverheads: "600.00", marginPercentage: "15.00", shareOfTotalPercent: "66.67", records: 20, recordsWithoutStoredAmounts: 0 },
  { rank: 2, cityId: 4, name: "Beta City", code: "BET", deliveries: 650, earnedDeliveryRevenue: "2000.00", grossMarginBeforeOverheads: "300.00", marginPercentage: "15.00", shareOfTotalPercent: "33.33", records: 10, recordsWithoutStoredAmounts: 2 },
];


// Made-up trends like the server's: one bucket per day, week (Monday start) or month of the requested period; every third day has no records.
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const trends = ({ start_date: start, end_date: end, interval }) => {
  const days = [];
  for (let ms = msOf(start), i = 0; ms <= msOf(end); ms += 86400000, i += 1) days.push({ date: isoOf(ms), i, has: i % 3 !== 2, deliveries: 10 + i });
  const startOf = (iso) => (interval === "day" ? iso : interval === "week" ? isoOf(msOf(iso) - ((new Date(msOf(iso)).getUTCDay() + 6) % 7) * 86400000) : `${iso.slice(0, 7)}-01`);
  const groups = new Map();
  days.forEach((d) => { const k = startOf(d.date); groups.set(k, [...(groups.get(k) ?? []), d]); });
  const series = [...groups].map(([k, ds]) => {
    const got = ds.filter((d) => d.has);
    const n = got.reduce((a, d) => a + d.deliveries, 0);
    const end2 = interval === "day" ? k : interval === "week" ? isoOf(msOf(k) + 6 * 86400000) : isoOf(msOf(`${k.slice(0, 7)}-28`) + 10 * 86400000).slice(0, 7) + "-01";
    return got.length === 0
      ? { bucketStart: k, bucketEnd: end2, partialBucket: false, daysInBucketWithinPeriod: ds.length, hasRecords: false, deliveries: null, earnedDeliveryRevenue: null, grossDriverEarnings: null, grossMarginBeforeOverheads: null, activeDrivers: null, daysWithRecords: 0, recordsWithoutStoredAmounts: 0 }
      : { bucketStart: k, bucketEnd: end2, partialBucket: false, daysInBucketWithinPeriod: ds.length, hasRecords: true, deliveries: n, earnedDeliveryRevenue: (n * 4).toFixed(2), grossDriverEarnings: (n * 3.4).toFixed(2), grossMarginBeforeOverheads: (n * 0.6).toFixed(2), activeDrivers: 3, daysWithRecords: got.length, recordsWithoutStoredAmounts: 0 };
  });
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((weekday, i) => (i === 6
    ? { weekday, totalDeliveries: 0, daysWithRecords: 0, averageDeliveriesPerDayWithRecords: null, rank: null }
    : { weekday, totalDeliveries: 100 + i * 10, daysWithRecords: 2, averageDeliveriesPerDayWithRecords: String(50 + i * 5), rank: 6 - i }));
  return { meta: meta({ warnings: ["3 days in the period have no delivery records; they are gaps in the charts, not zero-delivery days."] }), data: { period: { startDate: start, endDate: end, days: days.length }, interval, cities: "all", series, weekdays, busiestWeekday: "Saturday", peakDates: [] } };
};

const startServer = async (handlers = {}) => {
  const calls = [];
  await installServer(async (config) => {
    const path = config.url.replace("/admin/insights/", "");
    calls.push({ path, params: config.params ?? {} });
    if (handlers[path]) return handlers[path](config.params ?? {}, calls);
    if (path === "cities") return { status: 200, data: { meta: meta(), data: { cities: CITIES } } };
    if (path === "definitions") return { status: 200, data: { meta: meta(), data: { definitions: DEFINITIONS } } };
    if (path === "overview") return { status: 200, data: overview() };
    if (path === "trends") return { status: 200, data: trends(config.params) };
    if (path === "rankings/cities") {
      // like the real API: only the chosen cities are ranked
      const chosen = config.params?.city_ids ? config.params.city_ids.split(",").map(Number) : null;
      return { status: 200, data: ranking(ROWS.filter((r) => !chosen || chosen.includes(r.cityId))) };
    }
    return { status: 404, data: {} };
  });
  return { calls, of: (path) => calls.filter((c) => c.path === path) };
};

const mount = async (url = "/admin/insights") => {
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Insights } = await import("./Insights.jsx");
  const store = configureStore({ reducer: { admin: adminReducer, language: languageReducer }, preloadedState: { admin: { ...adminReducer(undefined, { type: "init" }), isSuperAdmin: true } } });
  let location;
  const Where = () => { const { useLocation } = require_router; location = useLocation(); return null; };
  const require_router = await import("react-router-dom");
  render(<Provider store={store}><MemoryRouter initialEntries={[url]}><Where /><Routes><Route path="/admin/insights" element={<Insights />} /></Routes></MemoryRouter></Provider>);
  return { search: () => location.search };
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Insights: the GOFO import history link", () => {
  it("has a small link to the import history (the page itself is for the owner only), which now holds the source figures", async () => {
    await startServer();
    await mount();
    const link = await screen.findByTestId("gofo-import-history-link");
    expect(link.getAttribute("href")).toBe("/admin/carrier-statements");
    expect(link.textContent).toBe("GOFO import history");
    expect(screen.getByText(/source figures, versions, unmatched charges, corrections and voids/)).toBeTruthy();
  });
});

describe("Insights: the headline figures", () => {
  it("opens on Last 30 days and All cities, asks for exactly that, and shows the figures with the comparison", async () => {
    const server = await startServer();
    await mount();
    expect(await screen.findByTestId("kpi-revenue")).toBeTruthy();
    const first = server.of("overview")[0].params;
    const expected = rangeForPreset("last30");
    expect([first.start_date, first.end_date]).toEqual([expected.start, expected.end]);
    expect(daysInRange(expected)).toBe(30);
    expect(first.city_ids).toBeUndefined();
    expect(first.source).toBeUndefined();
    expect(within(screen.getByTestId("kpi-revenue")).getByText("$6,000.00")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-deliveries")).getByText("1,650")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-margin")).getByText("$900.00")).toBeTruthy();
    expect(screen.getByTestId("margin-percent").textContent).toBe("Margin 15.00% of revenue");
    // the comparison with the previous equal-length period: sign, amount and percent, and what it is compared with
    expect(within(screen.getByTestId("kpi-deliveries")).getByText("+15 (+10.00%)")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-revenue")).getByText("−$120.50 (−2.00%)")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-revenue")).getByText(/vs previous 30 days \(/)).toBeTruthy();
    expect(within(screen.getByTestId("kpi-per-delivery")).getByText("$3.64 · $0.55")).toBeTruthy();
    // the margin is named honestly
    expect(within(screen.getByTestId("kpi-margin")).getByText("Delivery margin")).toBeTruthy();
    expect(screen.getByText(/no overheads or operating costs are recorded, so it is not net profit/)).toBeTruthy();
  });

  it("says when the data was made and how far it goes, and lists the server's notes", async () => {
    await startServer();
    await mount();
    await screen.findByTestId("kpi-revenue");
    expect(screen.getByTestId("data-as-of").textContent).toMatch(/Data as of .*2026/);
    expect(screen.getByTestId("data-as-of").textContent).toContain("Jan 1, 2026 to Nov 5, 2026");
    expect(screen.getByTestId("data-as-of").textContent).toContain("30 records in this period, 2 without stored amounts yet");
    fireEvent.click(screen.getByText("1 note about this data"));
    expect(screen.getByText("2 records are still open.")).toBeTruthy();
  });

  it("says Insufficient data instead of a made-up change, and passes on the note when the previous period is only partly covered", async () => {
    await startServer({ overview: () => ({ status: 200, data: overview({ comparison: { status: "insufficient_data", change: null, note: "There is no delivery data in the previous equal-length period, so no change is shown." } }) }) });
    await mount();
    await screen.findByTestId("kpi-revenue");
    expect(within(screen.getByTestId("kpi-revenue")).getByText("Insufficient data")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-revenue")).getByText(/no delivery data in the previous equal-length period/)).toBeTruthy();
    cleanup();
    await startServer({ overview: () => ({ status: 200, data: overview({ comparison: { ...comparison, status: "incomplete", note: "Delivery data starts on 2026-10-20, so the previous period is only partly covered." } }) }) });
    await mount();
    await screen.findByTestId("kpi-deliveries");
    expect(within(screen.getByTestId("kpi-deliveries")).getByText(/only partly covered/)).toBeTruthy();
  });

  it("shows N/A for a missing amount, never zero", async () => {
    await startServer({ overview: () => ({ status: 200, data: overview({ earnedDeliveryRevenue: null, grossMarginBeforeOverheads: null, marginPercentage: null, revenuePerDelivery: null, marginPerDelivery: null, comparison: undefined }) }) });
    await mount();
    await screen.findByTestId("kpi-revenue");
    expect(within(screen.getByTestId("kpi-revenue")).getByText("N/A")).toBeTruthy();
    expect(screen.getByTestId("margin-percent").textContent).toBe("Margin N/A of revenue");
    expect(within(screen.getByTestId("kpi-per-delivery")).getByText("N/A · N/A")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(within(screen.getByTestId("kpi-revenue")).getByText("Comparison off")).toBeTruthy();
  });

  it("has an honest empty state when there are no records, with no figures at all", async () => {
    await startServer({ overview: () => ({ status: 200, data: overview({ deliveries: 0, earnedDeliveryRevenue: null, records: { total: 0, withStoredAmounts: 0, open: 0, partialAmounts: 0, daily: 0, weekly: 0 } }) }), "rankings/cities": () => ({ status: 200, data: ranking([]) }) });
    await mount();
    expect(await screen.findByTestId("insights-empty")).toBeTruthy();
    expect(screen.getByText("No delivery records in this period")).toBeTruthy();
    expect(screen.queryByTestId("kpi-revenue")).toBeNull();
    expect(await screen.findByTestId("ranking-empty")).toBeTruthy();
  });

  it("shows a recoverable error and no figures when the server fails, and loads again on Try again", async () => {
    let failing = true;
    const server = await startServer({ overview: () => (failing ? { status: 500, data: { message: "internal detail that must not be shown" } } : { status: 200, data: overview() }) });
    await mount();
    const alert = await screen.findByText("The figures could not be loaded");
    expect(alert).toBeTruthy();
    expect(screen.getByText(/Insights could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/internal detail/)).toBeNull();
    expect(screen.queryByTestId("kpi-revenue")).toBeNull();
    failing = false;
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    expect(await screen.findByTestId("kpi-revenue")).toBeTruthy();
    expect(server.of("overview").length).toBe(2);
  });

  it("shows the server's own message when it refuses the question (400)", async () => {
    await startServer({ overview: () => ({ status: 400, data: { message: "The period is 1200 days; the most one question can cover is 1096 days." } }) });
    await mount();
    expect(await screen.findByText(/the most one question can cover is 1096 days/)).toBeTruthy();
  });
});

describe("Insights: the filters", () => {
  it("a preset asks for that period, shows loading rather than the old figures, and keeps the address in step", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const server = await startServer({ overview: async (params, calls) => {
      if (calls.filter((c) => c.path === "overview").length === 2) await gate;
      return { status: 200, data: overview({ deliveries: calls.filter((c) => c.path === "overview").length === 2 ? 77 : 1650 }) };
    } });
    const page = await mount();
    await screen.findByTestId("kpi-revenue");
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() => expect(server.of("overview").length).toBe(2));
    const week = rangeForPreset("last7");
    expect([server.of("overview")[1].params.start_date, server.of("overview")[1].params.end_date]).toEqual([week.start, week.end]);
    expect(daysInRange(week)).toBe(7);
    // while the new answer is pending the old figures are gone
    expect(screen.queryByTestId("kpi-deliveries")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading figures" })).toBeTruthy();
    release();
    expect(await within(await screen.findByTestId("kpi-deliveries")).findByText("77")).toBeTruthy();
    expect(page.search()).toBe("?preset=last7");
    expect(screen.getByRole("button", { name: "Last 7 days" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Custom asks for the dates chosen, allows a long period, and refuses a bad one without asking the server", async () => {
    const server = await startServer();
    await mount();
    await screen.findByTestId("kpi-revenue");
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const from = await screen.findByLabelText("From");
    const to = screen.getByLabelText("To");
    const before = server.of("overview").length;
    fireEvent.change(from, { target: { value: "2024-01-01" } });
    fireEvent.change(to, { target: { value: "2026-10-31" } });
    await waitFor(() => expect(server.of("overview").at(-1).params).toMatchObject({ start_date: "2024-01-01", end_date: "2026-10-31" }));
    // 1,034 days: more than a pay run's 31, still allowed
    fireEvent.change(from, { target: { value: "2020-01-01" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/at most 1096 days/);
    const asked = server.of("overview").length;
    expect(screen.getByTestId("invalid-range")).toBeTruthy();
    expect(screen.queryByTestId("kpi-revenue")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(server.of("overview").length).toBe(asked);
    expect(asked).toBeGreaterThan(before);
  });

  it("the city and the source go into every request, and Reset puts everything back", async () => {
    const server = await startServer();
    const page = await mount();
    await screen.findByTestId("kpi-revenue");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "4" } });
    await waitFor(() => expect(server.of("overview").at(-1).params.city_ids).toBe("4"));
    expect(server.of("rankings/cities").at(-1).params.city_ids).toBe("4");
    fireEvent.change(screen.getByLabelText("Record source"), { target: { value: "weekly" } });
    await waitFor(() => expect(server.of("overview").at(-1).params).toMatchObject({ city_ids: "4", source: "weekly" }));
    expect(server.of("rankings/cities").at(-1).params).toMatchObject({ city_ids: "4", source: "weekly" });
    expect(screen.getByTestId("active-filters").textContent).toContain("Showing Beta City, weekly records only.");
    expect(page.search()).toBe("?cities=4&source=weekly");
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(server.of("overview").at(-1).params.city_ids).toBeUndefined());
    expect(server.of("overview").at(-1).params.source).toBeUndefined();
    expect(page.search()).toBe("");
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
  });

  it("ignores anything invalid in the address and shows the defaults", async () => {
    const server = await startServer();
    await mount("/admin/insights?preset=forever&cities=abc,-1,3x&source=monthly");
    await screen.findByTestId("kpi-revenue");
    const params = server.of("overview")[0].params;
    expect([params.start_date, params.end_date]).toEqual([rangeForPreset("last30").start, rangeForPreset("last30").end]);
    expect(params.city_ids).toBeUndefined();
    expect(params.source).toBeUndefined();
  });

  it("a shared link opens on the same view", async () => {
    const server = await startServer();
    await mount("/admin/insights?preset=lastMonth&cities=3,4&source=daily");
    await screen.findByTestId("kpi-revenue");
    const month = rangeForPreset("lastMonth");
    expect(server.of("overview")[0].params).toEqual({ start_date: month.start, end_date: month.end, city_ids: "3,4", source: "daily" });
    expect(screen.getByLabelText("City").value).toBe("many");
  });

  it("an answer that arrives late for an earlier question is never shown", async () => {
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });
    const server = await startServer({ overview: async (params, calls) => {
      const n = calls.filter((c) => c.path === "overview").length;
      if (n === 1) { await first; return { status: 200, data: overview({ deliveries: 111 }) }; }
      return { status: 200, data: overview({ deliveries: 222 }) };
    } });
    await mount();
    await waitFor(() => expect(server.of("overview").length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(await within(await screen.findByTestId("kpi-deliveries")).findByText("222")).toBeTruthy();
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(within(screen.getByTestId("kpi-deliveries")).getByText("222")).toBeTruthy();
    expect(screen.queryByText("111")).toBeNull();
  });
});

describe("Insights: top cities", () => {
  it("shows each city with its exact value, share and a bar, switches the ranking metric, and offers a table", async () => {
    const server = await startServer();
    await mount();
    const list = await screen.findByRole("list", { name: "Cities ranked by delivery revenue" });
    expect(within(list).getByText("$4,000.00")).toBeTruthy();
    expect(within(list).getByText("66.67% of all cities")).toBeTruthy();
    expect(within(list).getByText(/2 record\(s\) without stored amounts/)).toBeTruthy();
    expect(server.of("rankings/cities")[0].params).toMatchObject({ rank_by: "revenue", limit: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Deliveries" }));
    expect(await screen.findByRole("list", { name: "Cities ranked by deliveries" })).toBeTruthy();
    await waitFor(() => expect(server.of("rankings/cities").at(-1).params.rank_by).toBe("deliveries"));
    expect(within(screen.getByRole("list", { name: "Cities ranked by deliveries" })).getByText("1,000")).toBeTruthy();
    // the same data as a table, with every figure and the headings a screen reader needs
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["#", "City", "Deliveries", "Delivery revenue", "Delivery margin", "Margin %", "Share"]);
    expect(within(table).getByRole("row", { name: /Beta City/ }).textContent).toContain("$2,000.00");
    fireEvent.click(screen.getByRole("button", { name: "Show bars" }));
    expect(screen.getByRole("list", { name: "Cities ranked by deliveries" })).toBeTruthy();
  });

  it("choosing a city filters the whole page to it, and choosing it again is the way back", async () => {
    const server = await startServer();
    const page = await mount();
    const list = await screen.findByRole("list", { name: "Cities ranked by delivery revenue" });
    fireEvent.click(within(list).getByRole("button", { name: /Beta City/ }));
    await waitFor(() => expect(server.of("overview").at(-1).params.city_ids).toBe("4"));
    expect(server.of("rankings/cities").at(-1).params.city_ids).toBe("4");
    expect(screen.getByLabelText("City").value).toBe("4");
    expect(page.search()).toBe("?cities=4");
    // with a city chosen the share is among the selected cities, not "all cities"
    expect(await screen.findByText(/33\.33% of the selected cities/)).toBeTruthy();
    expect(screen.queryByText(/of all cities/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show everything" })).toBeTruthy();
    const again = await screen.findByRole("list", { name: "Cities ranked by delivery revenue" });
    expect(within(again).getAllByRole("button", { name: /City/ })[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(again).getAllByRole("button", { name: /City/ })[0]);
    await waitFor(() => expect(server.of("overview").at(-1).params.city_ids).toBeUndefined());
    expect(page.search()).toBe("");
  });

  it("shows an error for the ranking on its own, without hiding the headline figures", async () => {
    await startServer({ "rankings/cities": () => ({ status: 500, data: {} }) });
    await mount();
    expect(await screen.findByTestId("kpi-revenue")).toBeTruthy();
    expect(await screen.findByText(/Insights could not be loaded/)).toBeTruthy();
    expect(screen.getByTestId("kpi-revenue")).toBeTruthy();
  });

  it("a card explains itself with the shared definition", async () => {
    await startServer();
    await mount();
    await screen.findByTestId("kpi-margin");
    fireEvent.click(within(screen.getByTestId("kpi-margin")).getByRole("button", { name: "About Delivery margin" }));
    expect(await screen.findByText(/Delivery revenue minus driver earnings\. It is not net profit\./)).toBeTruthy();
  });
});

describe("Insights: trends, weekdays and calendar", () => {
  const CUSTOM = "/admin/insights?preset=custom&start=2026-10-19&end=2026-11-01";

  it("draws the line charts, the weekday bars and the calendar for the period, by day for a short period", async () => {
    const server = await startServer();
    await mount(CUSTOM);
    expect(await screen.findByTestId("trend-deliveries")).toBeTruthy();
    expect(screen.getByTestId("trend-revenue")).toBeTruthy();
    expect(server.of("trends")[0].params).toMatchObject({ start_date: "2026-10-19", end_date: "2026-11-01", interval: "day" });
    expect(screen.getByRole("img", { name: /^Deliveries from Oct 19 to Nov 1: 10 of 14 periods have records/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Delivery revenue and delivery margin/ })).toBeTruthy();
    expect(document.querySelectorAll("[data-testid='trend-revenue'] .recharts-line").length).toBe(2);
    expect(screen.getByRole("list", { name: "Legend" }).textContent).toContain("Delivery margin");
    expect(await screen.findByTestId("weekday-busiest")).toHaveProperty("textContent", "Busiest weekday: Saturday");
    expect(document.querySelectorAll("[data-testid='weekday-title'], .recharts-bar-rectangle").length).toBeGreaterThan(0);
    // a short period asked for the daily trend once, and the calendar reuses it
    expect(server.of("trends")).toHaveLength(1);
    const grid = await screen.findByTestId("calendar-grid");
    expect(grid.querySelectorAll("[data-status='records']").length).toBe(10);
    expect(grid.querySelectorAll("[data-status='empty']").length).toBe(4);
    expect(screen.getByTestId("trends-notes").textContent).toContain("gaps in the charts, not zero");
  });

  it("the weekday and calendar cards can shrink inside their grid, so a long calendar scrolls inside its own card and never widens the phone page", async () => {
    // jsdom has no layout, so this guards the cause: a grid item keeps `min-width: auto` (as wide as its content, a year of weeks) unless it
    // has min-w-0. Checked in a real browser at 390 px for 2025-11-01 to 2026-10-31: the page was 977 px wide before, 390 px after.
    const server = await startServer();
    await mount(CUSTOM);
    await screen.findByTestId("calendar-grid");
    const calendar = screen.getByRole("region", { name: "Calendar" });
    const weekdays = screen.getByRole("region", { name: "Busiest weekdays" });
    for (const card of [calendar, weekdays]) expect(card.classList.contains("min-w-0")).toBe(true);
    expect(calendar.parentElement).toBe(weekdays.parentElement); // they are the two items of the same grid
    expect(calendar.querySelector("[data-testid='calendar-grid']").parentElement.classList.contains("overflow-x-auto")).toBe(true);
    expect(server.of("trends").length).toBeGreaterThan(0);
  });

  it("a day with no records is a dashed square, not the lightest shade, and pointing at a day reads out its deliveries", async () => {
    await startServer();
    await mount(CUSTOM);
    const grid = await screen.findByTestId("calendar-grid");
    const empty = grid.querySelector("[data-status='empty']");
    expect(empty.getAttribute("data-level")).toBeNull();
    expect(empty.className).toContain("border-dashed");
    fireEvent.mouseEnter(empty);
    expect(screen.getByTestId("calendar-readout").textContent).toMatch(/no delivery records/);
    const busy = grid.querySelector("[data-status='records']");
    fireEvent.mouseEnter(busy);
    expect(screen.getByTestId("calendar-readout").textContent).toMatch(/Oct 19, 2026: 10 deliveries/);
    expect(screen.getByTestId("calendar-legend").textContent).toContain("No records");
  });

  it("every chart has a table with the exact figures, and a gap shows N/A rather than 0", async () => {
    await startServer();
    await mount(CUSTOM);
    await screen.findByTestId("trend-deliveries");
    fireEvent.click(screen.getByRole("button", { name: "Show as table, trends" }));
    const table = await screen.findByTestId("trends-table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(14);
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["10", "$40.00", "$6.00", "3"]);
    const gap = rows.find((r) => within(r).getByRole("rowheader").textContent.startsWith("Oct 21, 2026"));
    expect(within(gap).getAllByRole("cell").map((c) => c.textContent)).toEqual(["N/A", "N/A", "N/A", "N/A"]);
    cleanup();
  });

  it("the weekday table shows N/A for a weekday with no records", async () => {
    await startServer();
    await mount(CUSTOM);
    await screen.findByTestId("weekday-busiest");
    fireEvent.click(screen.getByRole("button", { name: "Show as table, weekdays" }));
    const rows = within(await screen.findByTestId("weekday-table")).getAllByRole("row").slice(1);
    expect(within(rows[6]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["N/A", "0", "N/A"]);
    expect(within(rows[5]).getAllByRole("cell")[0].textContent).toBe("75.00");
  });

  it("a longer period is grouped by week, the calendar asks for its own daily answer, and the choice of bucket size is honoured", async () => {
    const server = await startServer();
    await mount("/admin/insights?preset=custom&start=2026-08-01&end=2026-11-01");
    await screen.findByTestId("trend-deliveries");
    expect(server.of("trends").map((c) => c.params.interval).sort()).toEqual(["day", "week"]);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(server.of("trends").at(-1).params.interval).toBe("month"));
    expect(screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("over a year there is no daily trend and no calendar, only a plain explanation", async () => {
    const server = await startServer();
    await mount("/admin/insights?preset=custom&start=2025-06-01&end=2026-11-01");
    expect(await screen.findByTestId("calendar-too-long")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Day" }).disabled).toBe(true);
    await screen.findByTestId("trend-deliveries");
    expect(server.of("trends").every((c) => c.params.interval !== "day")).toBe(true);
  });

  it("with no records the charts say so instead of drawing empty axes, and a failed trend shows its own error", async () => {
    await startServer({ trends: (params) => ({ status: 200, data: { ...trends(params), data: { ...trends(params).data, series: trends(params).data.series.map((p) => ({ ...p, hasRecords: false, deliveries: null, earnedDeliveryRevenue: null, grossMarginBeforeOverheads: null })), weekdays: [], busiestWeekday: null } } }) });
    await mount(CUSTOM);
    expect(await screen.findByTestId("trends-empty")).toBeTruthy();
    expect(await screen.findByTestId("weekday-empty")).toBeTruthy();
    expect(await screen.findByTestId("calendar-empty")).toBeTruthy();
    expect(screen.queryByTestId("trend-deliveries")).toBeNull();
    cleanup();
    await startServer({ trends: () => ({ status: 500, data: {} }) });
    await mount(CUSTOM);
    expect((await screen.findAllByText(/Insights could not be loaded/)).length).toBeGreaterThanOrEqual(3);
    expect(await screen.findByTestId("kpi-revenue")).toBeTruthy();
  });

  it("changing the city asks for new trends and never shows the old ones in between", async () => {
    const server = await startServer();
    await mount(CUSTOM);
    await screen.findByTestId("trend-deliveries");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "4" } });
    expect(await screen.findByRole("status", { name: "Loading trends" })).toBeTruthy();
    await screen.findByTestId("trend-deliveries");
    expect(server.of("trends").at(-1).params.city_ids).toBe("4");
  });
});

describe("Insights: revenue from the carrier statement (#252)", () => {
  const carrier = (extra = {}) => overview({
    deliveryRevenue: "6000.00", driverEarnings: "5100.00", deliveryMargin: "900.00", driverEarningsAfterInsurance: "5000.08", unallocatedRevenue: null,
    revenueBasis: "statement", revenueIsEstimated: false, recordsByBasis: { statement: 20, recorded: 10, estimated: 0, unallocatedGroups: 0 },
    settlement: { statements: 2, deliveryRevenue: "5990.00", carrierClaims: "-100.00", ledgerAdjustments: "-50.00", payable: "5840.00", basis: "By billing week" }, ...extra,
  });

  it("shows delivery revenue, driver earnings, delivery margin and the GOFO settlement payable as separate figures", async () => {
    await startServer({ overview: () => ({ status: 200, data: carrier() }) });
    await mount();
    expect(within(await screen.findByTestId("kpi-revenue")).getByText("$6,000.00")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-revenue")).getByText("Delivery revenue")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-revenue")).getByTestId("revenue-basis").textContent).toMatch(/what the carrier billed/i);
    expect(screen.queryByTestId("estimated-badge")).toBeNull();
    expect(within(screen.getByTestId("kpi-driver-earnings")).getByText("$5,100.00")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-driver-earnings")).getByTestId("driver-earnings-net").textContent).toBe("$5,000.08 after insurance withholding.");
    expect(within(screen.getByTestId("kpi-margin")).getByText("$900.00")).toBeTruthy();
    const settlement = screen.getByTestId("kpi-settlement");
    expect(within(settlement).getByText("GOFO settlement payable")).toBeTruthy();
    expect(within(settlement).getByText("$5,840.00")).toBeTruthy();
    expect(within(within(settlement).getByTestId("settlement-lines")).getAllByText(/\$/).map((n) => n.textContent)).toEqual(["$5,990.00", "-$100.00", "-$50.00"]);
    expect(within(settlement).getByText(/By billing week, 2 statements/)).toBeTruthy();
  });

  it("marks revenue and margin Estimated, in words, when weekly records have no verified statement", async () => {
    await startServer({ overview: () => ({ status: 200, data: carrier({ revenueBasis: "mixed", revenueIsEstimated: true, recordsByBasis: { statement: 5, recorded: 0, estimated: 3, unallocatedGroups: 0 }, settlement: null }) }) });
    await mount();
    await screen.findByTestId("kpi-revenue");
    expect(within(screen.getByTestId("kpi-revenue")).getByTestId("estimated-badge").textContent).toBe("Estimated");
    expect(within(screen.getByTestId("kpi-margin")).getByTestId("estimated-badge").textContent).toBe("Estimated");
    expect(within(screen.getByTestId("kpi-revenue")).getByTestId("revenue-basis").textContent).toMatch(/Includes 3 weekly records with no verified carrier statement/);
    expect(screen.queryByTestId("kpi-settlement")).toBeNull();
  });

  it("shows unallocated carrier revenue apart, inside the revenue card", async () => {
    await startServer({ overview: () => ({ status: 200, data: carrier({ unallocatedRevenue: "230.00" }) }) });
    await mount();
    expect((await screen.findByTestId("unallocated-revenue")).textContent).toBe("Includes $230.00 of carrier revenue that matched no driver (unallocated).");
  });

  it("still shows an older server's figures under the new names", async () => {
    await startServer();
    await mount();
    expect(within(await screen.findByTestId("kpi-revenue")).getByText("$6,000.00")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-driver-earnings")).getByText("$5,100.00")).toBeTruthy();
    expect(screen.queryByTestId("estimated-badge")).toBeNull();
    expect(screen.queryByTestId("kpi-settlement")).toBeNull();
  });

  it("says in the ranking and the trend table which cities and periods are estimates", async () => {
    await startServer({
      "rankings/cities": () => ({ status: 200, data: ranking([{ ...ROWS[0], revenueIsEstimated: true }, { ...ROWS[1], unallocatedRevenue: "12.00" }]) }),
    });
    await mount();
    expect((await screen.findByText(/Estimated: some weekly records have no verified carrier statement/))).toBeTruthy();
    expect(screen.getByText(/includes \$12\.00 unallocated carrier revenue/)).toBeTruthy();
  });
});
