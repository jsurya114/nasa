import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import InvoiceButton from "./InvoiceButton.jsx";

// The PDF itself is covered in buildInvoicePdf.test.js; here the form is checked: what it asks for, what it refuses and what it hands to the builder.
const download = vi.hoisted(() => vi.fn());
vi.mock("./buildInvoicePdf.js", () => ({ downloadInvoice: download }));

const open = async () => {
  render(<InvoiceButton />);
  fireEvent.click(screen.getByTestId("create-invoice"));
  return screen.findByRole("dialog", { name: /create invoice/i });
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fillGood = () => {
  type("Invoice no", "0028");
  type("Schedule from", "2026-10-26");
  type("Schedule to", "2026-11-01");
  type("Job", "General worker");
  type("Total RE hours", "360");
  type("Overtime", "71.05");
  type("Total cost ($)", "7543.37");
};

beforeEach(() => download.mockReset().mockResolvedValue(undefined));
afterEach(cleanup);

describe("Create invoice", () => {
  it("opens a form with the usual client filled in, and says nothing is saved", async () => {
    const dialog = await open();
    expect(screen.getByLabelText("Name").value).toBe("GOFO INC.");
    expect(screen.getByLabelText("Address line 1").value).toBe("36-47 MAIN STREET,");
    expect(within(dialog).getByText(/nothing is saved or sent anywhere/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /download pdf/i }).disabled).toBe(false);
  });

  it("closes with Close, leaving nothing behind", async () => {
    await open();
    type("Invoice no", "0099");
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("create-invoice"));
    expect((await screen.findByLabelText("Invoice no")).value).toBe("");
  });

  it("refuses an empty form, names each field and downloads nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    expect(await screen.findByText("Enter the invoice number.")).toBeTruthy();
    expect(screen.getByText("Choose the first day of the schedule.")).toBeTruthy();
    expect(screen.getByText("Enter the job.")).toBeTruthy();
    expect(screen.getByLabelText("Invoice no").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Invoice no"));
    expect(download).not.toHaveBeenCalled();
  });

  it("fills in total hours from RE hours + overtime until one is typed, and only hints when it differs", async () => {
    await open();
    type("Total RE hours", "360");
    type("Overtime", "71.05");
    expect(screen.getByLabelText("Total hours").value).toBe("431.05");
    type("Total hours", "430");
    type("Overtime", "80");
    expect(screen.getByLabelText("Total hours").value).toBe("430");
    expect(screen.getByText("Differs from RE hours + overtime.")).toBeTruthy();
    type("Total hours", "");
    expect(screen.getByLabelText("Total hours").value).toBe("440");
    expect(screen.queryByText("Differs from RE hours + overtime.")).toBeNull();
  });

  it("hands the builder the cleaned invoice, then says what was downloaded", async () => {
    await open();
    fillGood();
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download).toHaveBeenCalledWith({
      invoiceNo: "0028", schedule: "10/26/2026 - 11/01/2026", billTo: { name: "GOFO INC.", line1: "36-47 MAIN STREET,", line2: "FLUSHING, NY, 11354, USA" },
      rows: [{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431.05", totalCost: "$7543.37" }], includeSignature: true,
    });
    expect((await screen.findByRole("status")).textContent).toContain("Downloaded NASA FD INVOICE 0028.pdf.");
  });

  it("can leave the signature out", async () => {
    await open();
    fillGood();
    fireEvent.click(screen.getByLabelText("Include the signature"));
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    await waitFor(() => expect(download.mock.calls[0][0].includeSignature).toBe(false));
  });

  it("adds and removes jobs, up to seven, and keeps at least one", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /remove job/i })).toBeNull();
    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByRole("button", { name: /add job/i }));
    expect(screen.getAllByTestId(/^invoice-job-/)).toHaveLength(7);
    expect(screen.getByRole("button", { name: /add job/i }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove job 3" }));
    expect(screen.getAllByTestId(/^invoice-job-/)).toHaveLength(6);
    expect(screen.getByRole("button", { name: /add job/i }).disabled).toBe(false);
  });

  it("sends every job in the order typed", async () => {
    await open();
    fillGood();
    fireEvent.click(screen.getByRole("button", { name: /add job/i }));
    const second = within(screen.getByTestId("invoice-job-2"));
    fireEvent.change(second.getByLabelText("Job 2"), { target: { value: "Forklift" } });
    fireEvent.change(second.getByLabelText("Total RE hours"), { target: { value: "40" } });
    fireEvent.change(second.getByLabelText("Total cost ($)"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0][0].rows.map((r) => [r.job, r.totalHours, r.totalCost])).toEqual([["General worker", "431.05", "$7543.37"], ["Forklift", "40", "$1200.00"]]);
  });

  it("says so when the PDF cannot be made, and lets the person try again", async () => {
    download.mockRejectedValueOnce(new Error("fonts did not load"));
    await open();
    fillGood();
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    expect((await screen.findByRole("alert")).textContent).toContain("The invoice could not be made.");
    expect(screen.getByRole("button", { name: /download pdf/i }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    expect((await screen.findByRole("status")).textContent).toContain("Downloaded");
  });
});
