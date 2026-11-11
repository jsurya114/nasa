// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildInvoicePdf, pagesFor } from "./buildInvoicePdf.js";
import { datesBetween } from "./invoiceRules.js";
import { ISSUER, TERMS_TEXT } from "./invoiceTemplate.js";

// The real font and logo files, read from disk (the browser fetches the same files by URL).
const file = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const assets = {
  regular: file("../../../../node_modules/@fontsource/montserrat/files/montserrat-latin-400-normal.woff"),
  bold: file("../../../../node_modules/@fontsource/montserrat/files/montserrat-latin-700-normal.woff"),
  addressBold: file("../../../../node_modules/@fontsource/open-sans/files/open-sans-latin-700-normal.woff"),
  logo: file("../../../assets/invoice-logo.png"),
};

// Saved invoices, shaped as the server returns them.
const base = {
  id: 1, invoiceNumber: "0028", invoiceDate: "2026-11-11", periodStart: "2026-10-26", periodEnd: "2026-11-01", vendorId: 1, vendorName: "GOFO INC.",
  billTo: { name: "Gofo Inc.", line1: "36-47 Main Street,", line2: "Flushing, NY, 11354, USA", contactName: "", contactEmail: "" },
  issuer: ISSUER, terms: TERMS_TEXT, templateVersion: "2026-11-11", includeSignature: true, status: "pending", version: 1,
};
const hourly = (over = {}) => ({
  ...base, type: "hourly", total: "7543.37",
  lines: [{ position: 1, kind: "hourly", job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431.05", totalCost: "7543.37" }], ...over,
});
const item = (days, over = {}) => {
  const dates = datesBetween("2026-06-01", "2026-12-31").slice(0, days);
  return {
    ...base, type: "item", invoiceNumber: "0029", periodStart: dates[0], periodEnd: dates.at(-1), total: (dates.length * 800).toFixed(2),
    billTo: { ...base.billTo, contactName: "Pat Lee", contactEmail: "pat@example.test" },
    lines: dates.map((date, i) => ({ position: i + 1, kind: "item", date, item: "Box truck with driver", rate: "200.00", quantity: "4", total: "800.00" })), ...over,
  };
};
const textOf = async (bytes, page = 0) => (await PDFDocument.load(bytes)).getPage(page).node.Contents()?.toString() ?? "";

describe("the invoice PDF", () => {
  it("hourly: one Letter page, titled with the invoice number", async () => {
    const bytes = await buildInvoicePdf(hourly(), assets);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getTitle()).toBe("Invoice 0028");
  });

  it("hourly: holds seven jobs, long names and stray characters without failing", async () => {
    const lines = Array.from({ length: 7 }, (_, i) => ({ position: i + 1, kind: "hourly", job: `Job ${i + 1} with a long description of work`, reHours: "99999.99", overtime: "0", totalHours: "99999.99", totalCost: "99999999.99" }));
    const bytes = await buildInvoicePdf(hourly({ lines, billTo: { name: "An extremely long company name of the West \u{1F680} 你好", line1: "École d'été ☃ 12" } }), assets);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("leaves the signature out when it is switched off", async () => {
    const withSignature = await buildInvoicePdf(hourly(), assets);
    const without = await buildInvoicePdf(hourly({ includeSignature: false }), assets);
    expect(without.length).toBeLessThan(withSignature.length);
  });

  it("is made the same way twice (no clock or random value in the file)", async () => {
    const a = await buildInvoicePdf(item(40), assets);
    const b = await buildInvoicePdf(item(40), assets);
    expect(a).toEqual(b);
  });

  it("item-based: a short invoice is one page; a long one runs over pages, never leaving the subtotal alone", async () => {
    expect((await PDFDocument.load(await buildInvoicePdf(item(5), assets))).getPageCount()).toBe(1);
    const long = await PDFDocument.load(await buildInvoicePdf(item(45), assets));
    expect(long.getPageCount()).toBe(pagesFor(item(45).lines).length);
    expect(long.getPageCount()).toBeGreaterThan(1);
    for (const n of [1, 12, 13, 24, 25, 40, 57, 58, 120, 366]) {
      const pages = pagesFor(Array.from({ length: n }, (_, i) => i));
      expect(pages.flat()).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(pages.at(-1).length).toBeGreaterThan(0);
      expect(pages.every((p) => p.length > 0)).toBe(true);
    }
    expect(pagesFor(Array.from({ length: 12 }, (_, i) => i))).toHaveLength(1);
    expect(pagesFor(Array.from({ length: 13 }, (_, i) => i))).toHaveLength(2);
  });

  it("item-based: a year of lines still makes a PDF, every page the same size", async () => {
    const doc = await PDFDocument.load(await buildInvoicePdf(item(214), assets));
    expect(doc.getPages().every((p) => p.getWidth() === 612 && p.getHeight() === 792)).toBe(true);
  });

  it("prints no old street address", async () => {
    const source = readFileSync(new URL("./buildInvoicePdf.js", import.meta.url), "utf8") + readFileSync(new URL("./invoiceTemplate.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/MONTE CARLO/i);
    expect(await textOf(await buildInvoicePdf(hourly(), assets))).not.toBe("");
  });
});
