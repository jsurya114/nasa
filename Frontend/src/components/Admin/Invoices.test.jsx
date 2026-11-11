import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";
import { chicagoToday } from "./invoice/invoiceRules.js";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
// The PDF itself is covered in buildInvoicePdf.test.js; here only that the saved invoice is what is handed to it.
const pdf = vi.hoisted(() => ({ downloadInvoice: vi.fn(), previewInvoice: vi.fn() }));
vi.mock("./invoice/buildInvoicePdf.js", () => pdf);

// The real Invoices page against a small in-memory server that behaves like the real one (numbers once, versions, payment once).
const GOFO = { id: 1, billingName: "GOFO INC.", addressLine1: "36-47 MAIN STREET,", addressLine2: "FLUSHING, NY, 11354, USA", contactName: "", contactEmail: "", billingType: "hourly" };
const ACME = { id: 2, billingName: "Acme Freight", addressLine1: "500 Commerce St", addressLine2: "Dallas, TX", contactName: "Pat", contactEmail: "pat@acme.test", billingType: "item" };

const cents = (v) => Math.round(Number(String(v).replace(/,/g, "")) * 100);
const money = (c) => (c / 100).toFixed(2);

const startServer = () => {
  const db = { vendors: [{ ...GOFO }, { ...ACME }], invoices: [], requests: new Map(), nextId: 10 };
  const calls = [];
  const view = (inv) => ({ ...inv, vendorName: db.vendors.find((v) => v.id === inv.vendorId).billingName });
  const save = (body, existing) => {
    const lines = body.type === "hourly"
      ? body.lines.map((l, i) => ({ position: i + 1, kind: "hourly", ...l, overtime: l.overtime || "0", totalCost: money(cents(l.totalCost)) }))
      : body.lines.filter((l) => l.item || l.rate || l.quantity).map((l, i) => ({ position: i + 1, kind: "item", date: l.date, item: l.item, rate: money(cents(l.rate)), quantity: String(Number(l.quantity)), total: money(Math.round((cents(l.rate) * cents(l.quantity)) / 100)) }));
    const total = money(lines.reduce((s, l) => s + cents(l.totalCost ?? l.total), 0));
    return { ...existing, invoiceNumber: body.invoiceNumber, type: body.type, vendorId: body.vendorId, periodStart: body.periodStart, periodEnd: body.periodEnd, billTo: body.billTo, includeSignature: body.includeSignature, lines, total };
  };
  const handle = (config) => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    const url = config.url;
    calls.push({ method: config.method, url, params: config.params ?? {}, body });
    if (url === "/admin/invoices/vendors" && config.method === "get") return { status: 200, data: { vendors: db.vendors } };
    if (url === "/admin/invoices/vendors" && config.method === "post") {
      const vendor = { id: db.nextId++, ...body };
      db.vendors.push(vendor);
      return { status: 201, data: { vendor } };
    }
    if (url === "/admin/invoices/next-number") return { status: 200, data: { invoiceNumber: "0031" } };
    if (url === "/admin/invoices" && config.method === "get") {
      let rows = db.invoices.map(view);
      if (config.params?.status) rows = rows.filter((r) => r.status === config.params.status);
      return { status: 200, data: { invoices: rows, total: rows.length, page: 1, pageSize: 20, totalPages: rows.length ? 1 : 0 } };
    }
    if (url === "/admin/invoices" && config.method === "post") {
      if (db.requests.has(body.requestId)) return { status: 200, data: { invoice: view(db.requests.get(body.requestId)), replay: true } };
      if (db.invoices.some((i) => i.invoiceNumber.toUpperCase() === body.invoiceNumber.toUpperCase())) {
        return { status: 409, data: { message: `Invoice number ${body.invoiceNumber} is already used.`, errors: { invoiceNumber: "This invoice number is already used." } } };
      }
      const invoice = save(body, { id: db.nextId++, invoiceDate: "2026-11-11", status: "pending", version: 1, issuer: null, terms: "" });
      db.invoices.push(invoice);
      db.requests.set(body.requestId, invoice);
      return { status: 201, data: { invoice: view(invoice), replay: false } };
    }
    const one = url.match(/^\/admin\/invoices\/(\d+)(\/payment)?$/);
    if (one) {
      const inv = db.invoices.find((i) => i.id === Number(one[1]));
      if (!inv) return { status: 404, data: { message: "Invoice not found." } };
      if (one[2]) {
        if (inv.status === "paid") return { status: 200, data: { invoice: view(inv), replay: true } };
        Object.assign(inv, { status: "paid", paymentReceivedOn: body.receivedOn, paymentReference: body.reference || null });
        return { status: 200, data: { invoice: view(inv), replay: false } };
      }
      if (config.method === "get") return { status: 200, data: { invoice: view(inv) } };
      if (inv.status === "paid") return { status: 409, data: { message: "This invoice is paid and can no longer be changed.", code: "invoice_paid" } };
      if (body.version !== inv.version) return { status: 409, data: { message: "This invoice was changed after you opened it.", code: "stale" } };
      Object.assign(inv, save(body, inv), { version: inv.version + 1 });
      return { status: 200, data: { invoice: view(inv) } };
    }
    return { status: 404, data: {} };
  };
  return { db, calls, ready: installServer(async (config) => handle(config)), of: (method, url) => calls.filter((c) => c.method === method && c.url === url) };
};

const mount = async (url = "/admin/invoices") => {
  const [{ configureStore }, { Provider }, router] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Invoices } = await import("./Invoices.jsx");
  const store = configureStore({ reducer: { admin: adminReducer, language: languageReducer }, preloadedState: { admin: { ...adminReducer(undefined, { type: "init" }), isSuperAdmin: true } } });
  let location;
  const Where = () => { location = router.useLocation(); return null; };
  render(<Provider store={store}><router.MemoryRouter initialEntries={[url]}><Where /><router.Routes><router.Route path="/admin/invoices" element={<Invoices />} /></router.Routes></router.MemoryRouter></Provider>);
  return { search: () => location.search };
};

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const chooseVendor = async (id) => {
  const select = await screen.findByLabelText("Vendor");
  await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
  fireEvent.change(select, { target: { value: String(id) } });
};

let server;
beforeEach(async () => {
  removeShell();
  await resetBrowser();
  pdf.downloadInvoice.mockReset().mockResolvedValue(undefined);
  server = startServer();
  await server.ready;
});
afterEach(cleanup);

describe("Invoices: creating", () => {
  it("fills Bill to from the vendor, shows its format, and takes the next number", async () => {
    await mount();
    await chooseVendor(1);
    expect(screen.getByTestId("invoice-format").textContent).toBe("Format: Hourly");
    expect(screen.getByLabelText("Billing name").value).toBe("GOFO INC.");
    expect(screen.getByLabelText("Address line 1").value).toBe("36-47 MAIN STREET,");
    await waitFor(() => expect(screen.getByLabelText("Invoice number").value).toBe("0031"));
    expect(screen.getByTestId("invoice-date").textContent).toContain("set when first saved");
    expect(screen.getByTestId("hourly-lines")).toBeTruthy();
  });

  it("item-based: one row per date From to To with its weekday, live totals to the cent, and a flag on a part-filled row", async () => {
    await mount();
    await chooseVendor(2);
    expect(screen.getByTestId("invoice-format").textContent).toBe("Format: Item-based");
    type("Billing period from", "2026-06-01");
    type("Billing period to", "2026-06-07");
    const rows = within(screen.getByTestId("item-lines")).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(screen.getByTestId("line-2026-06-06-day").textContent).toBe("Saturday");
    expect(screen.getByTestId("line-2026-06-07-day").textContent).toBe("Sunday");
    type("Item, Monday 06/01/2026", "Box truck");
    type("Rate, 06/01/2026", "200");
    type("Quantity, 06/01/2026", "4");
    expect(screen.getByTestId("line-2026-06-01-total").textContent).toBe("$800.00");
    type("Item, Wednesday 06/03/2026", "Box truck");
    type("Rate, 06/03/2026", "199.99");
    type("Quantity, 06/03/2026", "3.33");
    expect(screen.getByTestId("line-2026-06-03-total").textContent).toBe("$665.97");
    expect(screen.getByTestId("item-subtotal").textContent).toBe("$1,465.97");
    type("Item, Friday 06/05/2026", "Van");
    expect(screen.getByTestId("line-2026-06-05").dataset.partial).toBe("true");
    expect(screen.getByTestId("line-2026-06-05-problem").textContent).toMatch(/Fill in the item, rate and quantity/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("invoice-note")).toBeTruthy();
    expect(server.of("post", "/admin/invoices")).toHaveLength(0);
  });

  it("saves, then the PDF is made from what the server saved, under the same number when saved again", async () => {
    const view = await mount();
    await chooseVendor(2);
    type("Billing period from", "2026-06-01");
    type("Billing period to", "2026-06-03");
    type("Item, Monday 06/01/2026", "Box truck");
    type("Rate, 06/01/2026", "200");
    type("Quantity, 06/01/2026", "4");
    fireEvent.click(screen.getByRole("button", { name: /save and download pdf/i }));
    await waitFor(() => expect(pdf.downloadInvoice).toHaveBeenCalledTimes(1));
    const [posted] = server.of("post", "/admin/invoices");
    expect(posted.body).toMatchObject({ invoiceNumber: "0031", vendorId: 2, type: "item", periodStart: "2026-06-01", periodEnd: "2026-06-03" });
    expect(posted.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(posted.body.lines.map((l) => l.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(pdf.downloadInvoice.mock.calls[0][0]).toMatchObject({ invoiceNumber: "0031", total: "800.00", invoiceDate: "2026-11-11" });
    expect(await screen.findByText("Invoice 0031")).toBeTruthy();
    expect(view.search()).toMatch(/invoice=\d+/);
    // change and save again: an update of the same invoice, never a second one
    type("Quantity, 06/01/2026", "5");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(server.db.invoices[0].total).toBe("1000.00"));
    expect(server.db.invoices).toHaveLength(1);
    expect(server.of("put", `/admin/invoices/${server.db.invoices[0].id}`)[0].body.version).toBe(1);
  });

  it("asks before a vendor change throws away entered lines, and keeps them on Cancel", async () => {
    await mount();
    await chooseVendor(1);
    type("Job", "General worker");
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "2" } });
    const dialog = await screen.findByRole("dialog", { name: /switch to acme freight/i });
    expect(dialog.textContent).toMatch(/the 1 line you entered/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Job").value).toBe("General worker");
    expect(screen.getByTestId("invoice-format").textContent).toBe("Format: Hourly");
  });

  it("keeps entries for dates still in range when the dates move, and warns about the rest", async () => {
    await mount();
    await chooseVendor(2);
    type("Billing period from", "2026-06-01");
    type("Billing period to", "2026-06-07");
    type("Item, Tuesday 06/02/2026", "Van");
    type("Item, Saturday 06/06/2026", "Van");
    type("Billing period to", "2026-06-04");
    expect(screen.getByLabelText("Item, Tuesday 06/02/2026").value).toBe("Van");
    expect(screen.getByTestId("outside-warning").textContent).toMatch(/06\/06\/2026/);
    type("Billing period to", "2026-06-07");
    expect(screen.getByLabelText("Item, Saturday 06/06/2026").value).toBe("Van");
  });

  it("shows the server's answer on the field (an invoice number already used)", async () => {
    server.db.invoices.push({ id: 5, invoiceNumber: "0031", type: "hourly", vendorId: 1, invoiceDate: "2026-11-01", periodStart: "2026-10-01", periodEnd: "2026-10-07", status: "pending", version: 1, total: "1.00", billTo: { name: "GOFO INC." }, lines: [] });
    await mount();
    await chooseVendor(1);
    await waitFor(() => expect(screen.getByLabelText("Invoice number").value).toBe("0031"));
    type("Billing period from", "2026-10-26");
    type("Billing period to", "2026-11-01");
    type("Job", "General worker");
    type("Total RE hours", "360");
    type("Total cost ($)", "7543.37");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This invoice number is already used.")).toBeTruthy();
    expect(screen.getByLabelText("Invoice number").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("Invoices: a paid invoice", () => {
  it("opens locked: viewable and downloadable, no save", async () => {
    server.db.invoices.push({ id: 7, invoiceNumber: "0020", type: "hourly", vendorId: 1, invoiceDate: "2026-10-01", periodStart: "2026-09-01", periodEnd: "2026-09-07", status: "paid", paymentReceivedOn: "2026-10-15", paymentReference: "CHK 12", version: 2, total: "500.00", billTo: { name: "GOFO INC.", line1: "", line2: "" }, includeSignature: true,
      lines: [{ position: 1, kind: "hourly", job: "General worker", reHours: "20", overtime: "0", totalHours: "20", totalCost: "500.00" }] });
    await mount("/admin/invoices?invoice=7");
    expect((await screen.findByTestId("paid-banner")).textContent).toMatch(/\$500.00 received on 10\/15\/2026 \(reference CHK 12\)/);
    expect(screen.getByLabelText("Job").disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    await waitFor(() => expect(pdf.downloadInvoice).toHaveBeenCalledWith(expect.objectContaining({ id: 7, status: "paid" })));
  });
});

describe("Invoices: history and payment received", () => {
  const pending = () => ({ id: 8, invoiceNumber: "0030", type: "item", vendorId: 2, invoiceDate: "2026-11-10", periodStart: "2026-11-01", periodEnd: "2026-11-07", status: "pending", version: 3, total: "1465.97", billTo: { name: "Acme Freight" }, lines: [] });

  it("lists invoices with their details, filters on the server, and records a payment once, confirmed with vendor, number and amount", async () => {
    server.db.invoices.push(pending());
    await mount("/admin/invoices?tab=history");
    const row = await screen.findByTestId("history-row-0030");
    expect(row.textContent).toContain("Acme Freight");
    expect(row.textContent).toContain("Item-based");
    expect(row.textContent).toContain("11/10/2026");
    expect(row.textContent).toContain("11/01/2026 - 11/07/2026");
    expect(row.textContent).toContain("$1,465.97");
    expect(row.textContent).toContain("Pending");
    const first = server.of("get", "/admin/invoices")[0];
    expect(first.params).toEqual({ sort: "invoice_date", dir: "desc", page: 1 });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });
    await waitFor(() => expect(server.of("get", "/admin/invoices").at(-1).params.status).toBe("pending"));

    fireEvent.click(within(await screen.findByTestId("history-row-0030")).getByRole("button", { name: "Mark payment received" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark payment received" });
    const summary = within(dialog).getByTestId("payment-summary").textContent;
    expect(summary).toContain("Acme Freight");
    expect(summary).toContain("0030");
    expect(summary).toContain("$1,465.97");
    expect(within(dialog).getByLabelText("Payment received date").value).toBe(chicagoToday());
    fireEvent.change(within(dialog).getByLabelText("Payment reference (optional)"), { target: { value: "ACH 77" } });
    const submit = within(dialog).getByRole("button", { name: /record \$1,465.97 received/i });
    fireEvent.click(submit);
    fireEvent.click(submit); // a double click
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const posts = server.of("post", "/admin/invoices/8/payment");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ receivedOn: chicagoToday(), reference: "ACH 77", version: 3 });
    expect(server.db.invoices[0].status).toBe("paid");
  });

  it("refuses a future payment date", async () => {
    server.db.invoices.push(pending());
    await mount("/admin/invoices?tab=history");
    fireEvent.click(within(await screen.findByTestId("history-row-0030")).getByRole("button", { name: "Mark payment received" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark payment received" });
    fireEvent.change(within(dialog).getByLabelText("Payment received date"), { target: { value: "2999-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /record/i }));
    expect(await within(dialog).findByText("The payment received date cannot be in the future.")).toBeTruthy();
    expect(server.of("post", "/admin/invoices/8/payment")).toHaveLength(0);
  });
});

describe("Invoices: vendors", () => {
  it("adds a vendor only with a billing type chosen", async () => {
    await mount("/admin/invoices?tab=vendors");
    expect(await screen.findByTestId("vendor-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add vendor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add vendor" });
    fireEvent.change(within(dialog).getByLabelText("Billing name"), { target: { value: "New Co" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add vendor" }));
    expect(await within(dialog).findByText("Choose Hourly or Item-based.")).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText(/Item-based/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add vendor" }));
    await waitFor(() => expect(server.of("post", "/admin/invoices/vendors")).toHaveLength(1));
    expect(server.of("post", "/admin/invoices/vendors")[0].body).toMatchObject({ billingName: "New Co", billingType: "item" });
    expect(await screen.findByText("Added New Co.")).toBeTruthy();
  });
});

describe("Invoices: after saving", () => {
  it("says it was saved, even once the address carries the new invoice", async () => {
    await mount();
    await chooseVendor(1);
    type("Billing period from", "2026-10-26");
    type("Billing period to", "2026-11-01");
    type("Job", "General worker");
    type("Total RE hours", "360");
    type("Total cost ($)", "7543.37");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByTestId("invoice-note")).textContent.trim()).toBe("Saved invoice 0031 ($7,543.37).");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("invoice-note").textContent).toMatch(/Saved invoice 0031/);
  });
});
