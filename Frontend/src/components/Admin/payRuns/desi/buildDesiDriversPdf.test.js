// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildDesiDriversPdf, cardOf, fileNameOf, pagesOfCards } from "./buildDesiDriversPdf.js";

// Made-up drivers only. The real font and logo files are read from disk (the browser fetches the same files by URL).
const file = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const assets = {
  regular: file("../../../../../node_modules/@fontsource/montserrat/files/montserrat-latin-400-normal.woff"),
  bold: file("../../../../../node_modules/@fontsource/montserrat/files/montserrat-latin-700-normal.woff"),
  addressBold: file("../../../../../node_modules/@fontsource/open-sans/files/open-sans-latin-700-normal.woff"),
  logo: file("../../../../assets/invoice-logo.png"),
};
const RUN = { period_start: "2026-11-09", period_end: "2026-11-15" };
const HOLD = "Payment setup is not complete. Work and payments are on hold until the driver finishes it (Everee for a Local driver, QuickBooks for a Desi driver).";
const driver = (id, name, net, extra = {}) => ({
  statementId: id, driverName: name, driverType: "DESI", payoutStatus: "not_submitted", eligible: true, amounts: { net }, blockers: [], ...extra,
});
const DRIVERS = [
  driver(1, "Dev Desi", "1627.61", { eligible: false, blockers: [{ code: "payment_setup_incomplete", severity: "blocking", message: HOLD }] }),
  driver(2, "Dina Desi", "2575.36"),
  driver(3, "Ravi Ramírez", "1543.23", { payoutStatus: "paid", blockers: [{ code: "already_paid", severity: "blocking", message: "already paid" }] }),
];
const build = (drivers = DRIVERS) => buildDesiDriversPdf({ drivers, run: RUN, cityName: "Test City", today: "2026-11-26" }, assets);
const load = async (bytes) => PDFDocument.load(bytes);

describe("the Desi drivers PDF", () => {
  it("is one Letter page for a few drivers, titled with the city and pay period", async () => {
    const pdf = await load(await build());
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getTitle()).toBe("Desi drivers Test City 2026-11-09 to 2026-11-15");
  });

  it("is the same file for the same drivers on the same day", async () => {
    expect(Buffer.from(await build()).equals(Buffer.from(await build()))).toBe(true);
  });

  it("prints a held driver's hold message, and never an already-paid note", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(assets.regular, { subset: true });
    const [held, waiting, paid] = DRIVERS.map((d) => cardOf(d, { regular }));
    expect(held.status).toEqual({ label: "Needs review", tone: "warning" });
    expect(held.notes.join(" ")).toBe(HOLD);
    expect(held.height).toBeGreaterThan(waiting.height);
    expect(waiting.status.label).toBe("Awaiting payment");
    expect(waiting.notes).toEqual([]);
    expect(paid.status.label).toBe("Paid");
    expect(paid.notes).toEqual([]);
  });

  it("runs over more pages for a long list, with every card on exactly one page", async () => {
    const many = Array.from({ length: 60 }, (_, i) => driver(i + 1, `Driver ${i + 1}`, "100.00"));
    const pdf = await load(await build(many));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const cards = Array.from({ length: 60 }, () => ({ height: 43 }));
    expect(pagesOfCards(cards).flat()).toHaveLength(60);
  });

  it("still makes a page when the run has no Desi drivers", async () => {
    expect((await load(await build([]))).getPageCount()).toBe(1);
  });

  it("names the file after the city and pay period, with nothing unsafe in it", () => {
    expect(fileNameOf("Fort Worth / TX", RUN)).toBe("Desi-drivers-Fort-Worth-TX-2026-11-09-to-2026-11-15.pdf");
  });
});
