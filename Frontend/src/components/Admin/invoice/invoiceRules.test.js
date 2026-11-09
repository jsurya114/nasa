import { describe, expect, it } from "vitest";
import { blankRow, checkInvoice, costText, fileNameFor, hoursText, readAmount, totalDiffers, usDate, withDerivedTotal } from "./invoiceRules.js";

const good = (over = {}) => ({
  invoiceNo: "0028", start: "2026-10-26", end: "2026-11-01", billName: "Gofo Inc.", billLine1: "36-47 Main Street,", billLine2: "Flushing, NY, 11354, USA",
  rows: [{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431.05", totalCost: "7543.37" }], includeSignature: true, ...over,
});

describe("reading and printing numbers", () => {
  it("reads plain decimals and nothing else", () => {
    expect(readAmount("360")).toBe(360);
    expect(readAmount(" 1,234.5 ")).toBe(1234.5);
    for (const bad of ["", "abc", "-1", "+1", "1.234", "1e3", "1 000", ".5", "5.", null, undefined]) expect(readAmount(bad), String(bad)).toBeNull();
  });
  it("prints hours without trailing zeros and cost with a dollar sign and cents, as the template does", () => {
    expect([hoursText(360), hoursText(71.05), hoursText(431.05), hoursText(0.1 + 0.2), hoursText(12.5)]).toEqual(["360", "71.05", "431.05", "0.3", "12.5"]);
    expect([costText(7543.37), costText(10), costText(0.5)]).toEqual(["$7543.37", "$10.00", "$0.50"]);
  });
  it("writes the schedule month first, and refuses a date that does not exist", () => {
    expect(usDate("2026-10-26")).toBe("10/26/2026");
    expect([usDate("2026-02-30"), usDate("26-10-2026"), usDate("")]).toEqual(["", "", ""]);
  });
});

describe("total hours", () => {
  it("follows RE hours + overtime until a total is typed, and is handed back when it is emptied", () => {
    expect(withDerivedTotal({ ...blankRow(), reHours: "360", overtime: "71.05" }).totalHours).toBe("431.05");
    expect(withDerivedTotal({ ...blankRow(), reHours: "360", overtime: "" }).totalHours).toBe("360");
    expect(withDerivedTotal({ ...blankRow(), reHours: "abc", overtime: "1" }).totalHours).toBe("");
    expect(withDerivedTotal({ ...blankRow(), reHours: "360", overtime: "71.05", totalHours: "430", totalTouched: true }).totalHours).toBe("430");
  });
  it("flags, but never blocks, a total that differs", () => {
    expect(totalDiffers({ reHours: "360", overtime: "71.05", totalHours: "430" })).toBe(true);
    expect(totalDiffers({ reHours: "360", overtime: "71.05", totalHours: "431.05" })).toBe(false);
    const { errors } = checkInvoice(good({ rows: [{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "430", totalCost: "7543.37" }] }));
    expect(errors).toEqual({});
  });
});

describe("checking the form", () => {
  it("accepts the template's own invoice and cleans it for printing", () => {
    const { errors, invoice } = checkInvoice(good());
    expect(errors).toEqual({});
    expect(invoice).toEqual({
      invoiceNo: "0028", schedule: "10/26/2026 - 11/01/2026", billTo: { name: "Gofo Inc.", line1: "36-47 Main Street,", line2: "Flushing, NY, 11354, USA" },
      rows: [{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431.05", totalCost: "$7543.37" }], includeSignature: true,
    });
  });
  it("lets overtime be empty (printed as 0) but nothing else", () => {
    const rows = [{ job: "General worker", reHours: "360", overtime: "", totalHours: "360", totalCost: "7000" }];
    const { errors, invoice } = checkInvoice(good({ rows }));
    expect(errors).toEqual({});
    expect(invoice.rows[0].overtime).toBe("0");
    const empty = checkInvoice(good({ rows: [blankRow()] })).errors;
    expect(Object.keys(empty.rowErrors[0]).sort()).toEqual(["job", "reHours", "totalCost", "totalHours"]);
  });
  it("names each problem on its own field", () => {
    const { errors } = checkInvoice(good({ invoiceNo: "", start: "", end: "2026-02-30", billName: "  ", rows: [] }));
    expect(Object.keys(errors).sort()).toEqual(["billName", "end", "invoiceNo", "rows", "start"]);
    expect(checkInvoice(good({ start: "2026-11-02" })).errors.end).toMatch(/before/);
    expect(checkInvoice(good({ invoiceNo: "<b>" })).errors.invoiceNo).toMatch(/letters, numbers/);
    expect(checkInvoice(good({ invoiceNo: "A".repeat(21) })).errors.invoiceNo).toBeTruthy();
    expect(checkInvoice(good({ billName: "x".repeat(61) })).errors.billName).toBeTruthy();
  });
  it("refuses negative, lettered, over-precise and over-large amounts", () => {
    const row = (over) => [{ job: "General worker", reHours: "1", overtime: "0", totalHours: "1", totalCost: "1", ...over }];
    for (const over of [{ reHours: "-1" }, { overtime: "x" }, { totalHours: "1.234" }, { totalCost: "$5" }, { reHours: "100000" }, { totalCost: "100000000" }, { job: "j".repeat(41) }]) {
      expect(checkInvoice(good({ rows: row(over) })).errors.rowErrors, JSON.stringify(over)).toBeTruthy();
    }
  });
  it("holds at most seven jobs", () => {
    const rows = Array.from({ length: 8 }, () => ({ job: "General worker", reHours: "1", overtime: "0", totalHours: "1", totalCost: "1" }));
    expect(checkInvoice(good({ rows })).errors.rows).toMatch(/up to 7/);
    expect(checkInvoice(good({ rows: rows.slice(0, 7) })).errors).toEqual({});
  });
  it("names the file after the invoice, with nothing a file name cannot hold", () => {
    expect(fileNameFor("0028")).toBe("NASA FD INVOICE 0028.pdf");
    expect(fileNameFor(" A/B:7 ")).toBe("NASA FD INVOICE AB7.pdf");
  });
});
