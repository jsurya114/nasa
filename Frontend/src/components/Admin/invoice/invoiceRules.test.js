import { describe, expect, it } from "vitest";
import {
  amountText, blankRow, checkInvoice, chicagoToday, costText, datesBetween, entriesOutside, fileNameFor, formFromInvoice, hoursText, isPartialItem,
  itemRowsFor, itemSubtotalCents, lineTotalCents, moneyText, readAmount, toCents, totalDiffers, usDate, weekdayOf, withDerivedTotal,
} from "./invoiceRules.js";

const billTo = { name: "GOFO INC.", line1: "36-47 MAIN STREET,", line2: "FLUSHING, NY, 11354, USA", contactName: "", contactEmail: "" };
const hourly = (over = {}) => ({
  invoiceNumber: "0028", vendorId: 1, type: "hourly", periodStart: "2026-10-26", periodEnd: "2026-11-01", billTo, includeSignature: true,
  rows: [{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431.05", totalCost: "7543.37" }], ...over,
});
const item = (entries, over = {}) => ({ ...hourly(), type: "item", periodStart: "2026-06-01", periodEnd: "2026-06-07", rows: [], entries, ...over });

describe("money", () => {
  it("reads plain decimals only, in whole cents", () => {
    expect(readAmount("1,234.5")).toBe(1234.5);
    expect([toCents("200"), toCents("1,465.97"), toCents("0.5"), toCents(" 12 ")]).toEqual([20000, 146597, 50, 1200]);
    for (const bad of ["-1", "1.234", "12a", "", "1e3", "$5"]) expect(toCents(bad)).toBeNull();
  });

  it("works out each line as rate x quantity rounded to the cent, and the subtotal as the sum of rounded lines", () => {
    expect(lineTotalCents(20000, 400)).toBe(80000); // $200.00 x 4 = $800.00
    expect(lineTotalCents(19999, 333)).toBe(66597); // 665.9667 -> 665.97
    expect(lineTotalCents(33, 50)).toBe(17); // 0.165 rounds half up
    expect(lineTotalCents(999999999, 9999999)).toBe(99999989900000); // 9,999,999.99 x 99,999.99, no floating point drift
    const rows = [{ date: "2026-06-01", item: "A", rate: "0.33", quantity: "0.5" }, { date: "2026-06-02", item: "A", rate: "0.33", quantity: "0.5" }];
    expect(itemSubtotalCents(rows)).toBe(34); // 0.17 + 0.17, not round(0.33)
    expect(moneyText(146597)).toBe("$1,465.97");
    expect(amountText("800.00")).toBe("$800.00");
  });

  it("prints hours and the hourly cost as the template does", () => {
    expect(hoursText(71.05)).toBe("71.05");
    expect(hoursText(360)).toBe("360");
    expect(costText(7543.37)).toBe("$7543.37");
  });
});

describe("dates", () => {
  it("lists every date from From to To, both included, weekends too, with the right weekday", () => {
    const dates = datesBetween("2026-06-01", "2026-06-07");
    expect(dates).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"]);
    expect(dates.map(weekdayOf)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(datesBetween("2026-06-05", "2026-06-05")).toEqual(["2026-06-05"]);
    // across daylight saving time and a month end and a leap day
    expect(datesBetween("2026-03-07", "2026-03-09")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(datesBetween("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("lists nothing for a reversed, unreal or over-long range", () => {
    expect(datesBetween("2026-06-07", "2026-06-01")).toEqual([]);
    expect(datesBetween("2026-02-30", "2026-03-01")).toEqual([]);
    expect(datesBetween("2026-01-01", "2027-01-02")).toEqual([]);
    expect(usDate("2026-10-26")).toBe("10/26/2026");
    expect(usDate("2026-13-01")).toBe("");
  });

  it("takes today in America/Chicago", () => {
    expect(chicagoToday(new Date("2026-11-11T04:30:00Z"))).toBe("2026-11-10"); // 10:30 pm the day before in Chicago
    expect(chicagoToday(new Date("2026-11-11T06:30:00Z"))).toBe("2026-11-11");
  });

  it("keeps what was typed for a date while it stays in range, and says which typed dates fall outside", () => {
    const entries = { "2026-06-02": { date: "2026-06-02", item: "Van", rate: "100", quantity: "1" }, "2026-06-06": { date: "2026-06-06", item: "Van", rate: "100", quantity: "2" } };
    expect(itemRowsFor("2026-06-01", "2026-06-04", entries).map((r) => r.item)).toEqual(["", "Van", "", ""]);
    expect(entriesOutside("2026-06-01", "2026-06-04", entries)).toEqual(["2026-06-06"]);
    expect(itemRowsFor("2026-06-01", "2026-06-07", entries).filter((r) => r.item).map((r) => r.date)).toEqual(["2026-06-02", "2026-06-06"]);
  });
});

describe("hourly", () => {
  it("follows RE hours + overtime until a total is typed, and only hints when it differs", () => {
    expect(withDerivedTotal({ ...blankRow(), reHours: "360", overtime: "71.05" }).totalHours).toBe("431.05");
    expect(withDerivedTotal({ ...blankRow(), reHours: "360", overtime: "", totalHours: "400", totalTouched: true }).totalHours).toBe("400");
    expect(totalDiffers({ reHours: "360", overtime: "71.05", totalHours: "431" })).toBe(true);
    expect(checkInvoice(hourly({ rows: [{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431", totalCost: "1" }] })).errors).toEqual({});
  });

  it("accepts the template's own invoice and builds what is sent to the server", () => {
    const { errors, body } = checkInvoice(hourly());
    expect(errors).toEqual({});
    expect(body).toMatchObject({ invoiceNumber: "0028", vendorId: 1, type: "hourly", periodStart: "2026-10-26", periodEnd: "2026-11-01", includeSignature: true });
    expect(body.lines).toEqual([{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431.05", totalCost: "7543.37" }]);
  });

  it("names each problem on its own field, and refuses bad numbers", () => {
    const { errors } = checkInvoice(hourly({ invoiceNumber: "", vendorId: null, periodStart: "", periodEnd: "", billTo: { ...billTo, name: " ", contactEmail: "nope" },
      rows: [{ job: "", reHours: "-1", overtime: "x", totalHours: "", totalCost: "1.234" }] }));
    expect(Object.keys(errors).sort()).toEqual(["billTo.contactEmail", "billTo.name", "invoiceNumber", "lineErrors", "periodEnd", "periodStart", "vendorId"]);
    expect(Object.keys(errors.lineErrors[0]).sort()).toEqual(["job", "overtime", "reHours", "totalCost", "totalHours"]);
    expect(checkInvoice(hourly({ periodStart: "2026-11-02" })).errors.periodEnd).toBe("The last day cannot be before the first day.");
    expect(checkInvoice(hourly({ rows: Array.from({ length: 8 }, () => hourly().rows[0]) })).errors.lines).toMatch(/up to 7 jobs/);
  });
});

describe("item-based", () => {
  const line = (date, over = {}) => ({ date, item: "Box truck", rate: "200", quantity: "4", ...over });

  it("skips empty days, sends every date in order, and totals to the cent", () => {
    const { errors, body } = checkInvoice(item({ "2026-06-01": line("2026-06-01"), "2026-06-03": line("2026-06-03", { rate: "199.99", quantity: "3.33" }) }));
    expect(errors).toEqual({});
    expect(body.lines.map((l) => l.date)).toEqual(datesBetween("2026-06-01", "2026-06-07"));
    expect(itemSubtotalCents(body.lines)).toBe(146597);
  });

  it("flags a part-filled row, and needs at least one complete line with an amount", () => {
    expect(isPartialItem({ item: "Box truck", rate: "", quantity: "" })).toBe(true);
    const partial = checkInvoice(item({ "2026-06-02": line("2026-06-02", { quantity: "" }) }));
    expect(partial.errors.lineErrors[1].row).toMatch(/Fill in the item, rate and quantity/);
    expect(checkInvoice(item({})).errors.lines).toBe("Enter at least one line: an item, its rate and quantity.");
    expect(checkInvoice(item({ "2026-06-02": line("2026-06-02", { rate: "0" }) })).errors.lines).toBe("At least one line must have an amount.");
    expect(checkInvoice(item({ "2026-06-02": line("2026-06-02", { rate: "abc" }) })).errors.lineErrors[1].rate).toMatch(/Enter the rate/);
    expect(checkInvoice(item({ "2026-06-02": line("2026-06-02", { rate: "9999999.99", quantity: "99999.99" }) })).errors.lineErrors[1].quantity).toMatch(/more than 99,999,999.99/);
  });

  it("leaves out what was typed for dates outside the period", () => {
    const { errors, body } = checkInvoice(item({ "2026-06-01": line("2026-06-01"), "2026-06-20": line("2026-06-20") }));
    expect(errors).toEqual({});
    expect(body.lines.some((l) => l.date === "2026-06-20")).toBe(false);
  });
});

describe("a saved invoice back in the form", () => {
  it("restores hourly jobs (a total of its own stays its own) and item lines by date", () => {
    const h = formFromInvoice({ invoiceNumber: "1", vendorId: 1, type: "hourly", periodStart: "2026-10-26", periodEnd: "2026-11-01", billTo, includeSignature: false,
      lines: [{ job: "A", reHours: "10", overtime: "0", totalHours: "12", totalCost: "5.00" }] });
    expect(h.rows[0]).toMatchObject({ overtime: "", totalHours: "12", totalTouched: true });
    expect(h.includeSignature).toBe(false);
    const i = formFromInvoice({ invoiceNumber: "2", vendorId: 2, type: "item", periodStart: "2026-06-01", periodEnd: "2026-06-03", billTo,
      lines: [{ date: "2026-06-02", item: "Van", rate: "200.00", quantity: "4", total: "800.00" }] });
    expect(i.entries["2026-06-02"]).toEqual({ date: "2026-06-02", item: "Van", rate: "200.00", quantity: "4" });
    expect(checkInvoice(i).errors).toEqual({});
  });

  it("names the file after the invoice, with nothing a file name cannot hold", () => {
    expect(fileNameFor(" 0028/ab ")).toBe("NASA FD INVOICE 0028ab.pdf");
  });
});
