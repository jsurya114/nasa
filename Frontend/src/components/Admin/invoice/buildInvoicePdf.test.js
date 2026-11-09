// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildInvoicePdf } from "./buildInvoicePdf.js";
import { checkInvoice } from "./invoiceRules.js";

// The real font and logo files, read from disk (the browser fetches the same files by URL).
const file = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const assets = {
  regular: file("../../../../node_modules/@fontsource/montserrat/files/montserrat-latin-400-normal.woff"),
  bold: file("../../../../node_modules/@fontsource/montserrat/files/montserrat-latin-700-normal.woff"),
  addressBold: file("../../../../node_modules/@fontsource/open-sans/files/open-sans-latin-700-normal.woff"),
  logo: file("../../../assets/invoice-logo.png"),
};

const form = (over = {}) => ({
  invoiceNo: "0028", start: "2026-10-26", end: "2026-11-01", billName: "Gofo Inc.", billLine1: "36-47 Main Street,", billLine2: "Flushing, NY, 11354, USA",
  rows: [{ job: "General worker", reHours: "360", overtime: "71.05", totalHours: "431.05", totalCost: "7543.37" }], includeSignature: true, ...over,
});
const make = async (over) => {
  const { errors, invoice } = checkInvoice(form(over));
  expect(errors).toEqual({});
  return buildInvoicePdf(invoice, assets);
};

describe("the invoice PDF", () => {
  it("is one Letter page, titled with the invoice number", async () => {
    const bytes = await make();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getTitle()).toBe("Invoice 0028");
  });

  it("holds up to seven jobs, long names and stray characters without failing", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ job: `Job ${i + 1} with a long description of work`, reHours: "99999.99", overtime: "0", totalHours: "99999.99", totalCost: "99999999.99" }));
    const bytes = await make({ rows, billName: "An extremely long company name of the West \u{1F680} \u4F60\u597D", billLine1: "École d'été ☃ 12" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("leaves the signature out when it is switched off", async () => {
    const withSignature = await make();
    const without = await make({ includeSignature: false });
    expect(without.length).toBeLessThan(withSignature.length);
  });

  it("is made the same way twice (no clock or random value in the content)", async () => {
    const a = await make();
    const b = await make();
    const textOf = async (bytes) => { const doc = await PDFDocument.load(bytes); return doc.getPage(0).node.Contents()?.toString() ?? ""; };
    expect(await textOf(a)).toBe(await textOf(b));
  });
});
