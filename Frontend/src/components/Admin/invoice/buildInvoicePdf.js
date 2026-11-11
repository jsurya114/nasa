import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { ISSUER, TERMS_TEXT, TERMS_TITLE } from "./invoiceTemplate.js";
import { SIGNATURE } from "./invoiceSignature.js";
import { amountText, costText, fileNameFor, periodText, readAmount, usDate, weekdayOf } from "./invoiceRules.js";
import montserratRegularUrl from "@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url";
import montserratBoldUrl from "@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url";
import openSansBoldUrl from "@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url";
import logoUrl from "../../../assets/invoice-logo.png?url";

// Draws a saved invoice as a Letter PDF, in the browser, from what the server saved (its number, dates, bill-to block, issuer, terms and lines), so
// a PDF made again later is the same invoice. Two formats on one design (the template the company supplied):
//   Hourly       one page: jobs with RE hours, overtime, total hours and total cost.
//   Item-based   Date | Day | Item | Rate | Quantity | Total, one line per billed date, then the subtotal. Runs over as many pages as it needs; every
//                page repeats the column headers and is numbered, and the last page carries the subtotal, terms, contact block and signature.
// Positions are in points from the top left of the page (the way the template was measured); `y` is always the text baseline.

const PAGE = { width: 612, height: 792 };
const COLORS = {
  purple: rgb(0.333, 0.043, 0.471), // #550B78: title, bill-to name, table header
  logoPurple: rgb(0.435, 0.161, 0.573), // #6F2992: the logo panel
  orange: rgb(0.949, 0.31, 0.137), // #F24F23: side bar, job rows, icons
  line: rgb(0.824, 0.188, 0.027), // #D23007: the thin line above the table
  black: rgb(0, 0, 0),
  white: rgb(1, 1, 1),
  ink: rgb(0.0196, 0.443, 0.827), // the signature
};
const MARGIN = 63.5;
const TABLE = { left: 63.5, width: 524.5, headerTop: 238.8, headerHeight: 22.7, firstRowTop: 274, rowHeight: 22.7, rowPitch: 31 };
const COLUMNS = { job: 69.8, reHours: 233.9, overtime: 341.4, totalHours: 434.4, totalCost: 535.8 };
const TERMS = { lineY: 558, left: MARGIN, right: 510.7, titleY: 575, bodyFirstY: 592.4, bodyLead: 9.8 };

// ---- assets -------------------------------------------------------------------------------------------------------------------------------

const fetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return new Uint8Array(await response.arrayBuffer());
};

// The two fonts and the logo, fetched once from the app's own files (they ship with the page). A test can pass its own bytes instead.
let cached = null;
export const loadInvoiceAssets = async () => {
  if (!cached) {
    cached = Promise.all([montserratRegularUrl, montserratBoldUrl, openSansBoldUrl, logoUrl].map(fetchBytes)).then(
      ([regular, bold, addressBold, logo]) => ({ regular, bold, addressBold, logo }),
    );
    cached.catch(() => { cached = null; });
  }
  return cached;
};

// ---- drawing helpers ----------------------------------------------------------------------------------------------------------------------

const toPdfY = (top) => PAGE.height - top;

// Characters the font cannot draw are dropped, so a stray symbol in a name never stops the invoice from being made. Upper case, as the template
// prints, unless `keepCase` (email addresses).
const printable = (text, font, keepCase = false) => {
  const known = new Set(font.getCharacterSet());
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  return [...(keepCase ? source : source.toUpperCase())].filter((ch) => known.has(ch.codePointAt(0))).join("").replace(/\s+/g, " ").trim();
};

// The size at which `text` is `width` points wide: used to match the template's own text widths with this font.
const sizeForWidth = (font, text, width) => (width / font.widthOfTextAtSize(text, 1));

const fitText = (text, font, size, maxWidth, minSize = 6) => {
  let current = size;
  while (current > minSize && font.widthOfTextAtSize(text, current) > maxWidth) current -= 0.25;
  if (font.widthOfTextAtSize(text, current) <= maxWidth) return { text, size: current };
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, current) > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}...`, size: current };
};

const drawText = (page, text, { x, y, size, font, color = COLORS.black, align = "left" }) => {
  if (!text) return;
  const width = font.widthOfTextAtSize(text, size);
  const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  page.drawText(text, { x: left, y: toPdfY(y), size, font, color });
};

// Greedy wrap into lines of words that fit `width`.
const wrapWords = (text, font, size, width) => {
  const lines = [];
  let line = [];
  for (const word of text.split(" ")) {
    const attempt = [...line, word];
    if (line.length > 0 && font.widthOfTextAtSize(attempt.join(" "), size) > width) {
      lines.push(line);
      line = [word];
    } else line = attempt;
  }
  if (line.length) lines.push(line);
  return lines;
};

// Justified paragraph, as in the template: every line but the last is spread to the full width.
const drawJustified = (page, text, { x, width, y, size, lead, font, color = COLORS.black }) => {
  const lines = wrapWords(text, font, size, width);
  lines.forEach((words, i) => {
    const baseline = y + i * lead;
    const last = i === lines.length - 1;
    if (last || words.length === 1) {
      drawText(page, words.join(" "), { x, y: baseline, size, font, color });
      return;
    }
    const wordsWidth = words.reduce((sum, w) => sum + font.widthOfTextAtSize(w, size), 0);
    const gap = (width - wordsWidth) / (words.length - 1);
    let cursor = x;
    for (const word of words) {
      drawText(page, word, { x: cursor, y: baseline, size, font, color });
      cursor += font.widthOfTextAtSize(word, size) + gap;
    }
  });
  return lines.length;
};

const rect = (page, { x, top, width, height, color }) => page.drawRectangle({ x, y: toPdfY(top + height), width, height, color });

// Material Design icons (Apache 2.0), 24 x 24, drawn black on the orange circle like the template's.
const ICONS = {
  phone: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  mail: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
};

const drawContactIcon = (page, kind, cx, cy) => {
  const radius = 13.1;
  page.drawCircle({ x: cx, y: toPdfY(cy), size: radius, color: COLORS.orange });
  page.drawCircle({ x: cx, y: toPdfY(cy), size: radius - 1.9, borderColor: COLORS.black, borderWidth: 1, opacity: 0, borderOpacity: 1 });
  const scale = 0.5;
  page.drawSvgPath(ICONS[kind], { x: cx - 12 * scale, y: toPdfY(cy - 12 * scale), scale, color: COLORS.black });
};

// ---- the invoice --------------------------------------------------------------------------------------------------------------------------

// Font sizes: the template's own text widths, measured with these fonts.
const SIZE = { address: 10.56, label: 8.63, head: 8.61, cell: 8.57, item: 8.4, contact: 8.65, terms: 8.65, pageNo: 7.5 };
const ITEM = {
  rowHeight: 18, rowPitch: 20, firstRowTopPage1: 266, firstRowTopLater: 97.5, laterHeaderTop: 70,
  // The lowest a line may reach: on a page that continues, near the foot; on the last page, above the subtotal and the terms.
  fullBottom: 760, lastBottom: 548, subtotalGap: 4,
  columns: { date: 69.8, day: 136, item: 212, itemWidth: 165, rate: 444, quantity: 514, total: 582 },
};
const ROW_TINT = rgb(0.996, 0.906, 0.875); // a light orange for every other line, so a long table stays easy to follow

// How many item lines fit below `firstRowTop` without going past `bottom` (a last page also keeps room for the subtotal band).
const capacity = (firstRowTop, bottom, last) => {
  const extra = last ? ITEM.subtotalGap + TABLE.headerHeight : 0;
  return Math.max(0, Math.floor((bottom - extra - ITEM.rowHeight - firstRowTop) / ITEM.rowPitch) + 1);
};

// The item lines split into pages. The last page always has at least one line (never a subtotal on its own) and room for the footer.
export const pagesFor = (lines) => {
  const pages = [];
  let rest = lines;
  for (;;) {
    const top = pages.length === 0 ? ITEM.firstRowTopPage1 : ITEM.firstRowTopLater;
    const lastCap = capacity(top, ITEM.lastBottom, true);
    if (rest.length <= lastCap) { pages.push(rest); return pages; }
    const take = Math.min(capacity(top, ITEM.fullBottom, false), rest.length - 1);
    pages.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
};

// "4.00" -> "4", "3.30" -> "3.3"
const quantityText = (value) => {
  const n = readAmount(value);
  return n === null ? "" : String(Number(n.toFixed(2)));
};

// invoice: a saved invoice as the server returns it (GET /admin/invoices/:id). assets: { regular, bold, addressBold, logo } as bytes (see
// loadInvoiceAssets). Returns the PDF as bytes.
export const buildInvoicePdf = async (invoice, assets) => {
  const issuer = invoice.issuer ?? ISSUER;
  const terms = invoice.terms || TERMS_TEXT;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Invoice ${invoice.invoiceNumber}`);
  doc.setAuthor(issuer.name);
  doc.setCreator(issuer.name);
  doc.setProducer(issuer.name);
  // A fixed date, so the same invoice always makes the same file.
  const stamp = new Date(`${invoice.invoiceDate}T12:00:00Z`);
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);
  const regular = await doc.embedFont(assets.regular, { subset: true });
  const bold = await doc.embedFont(assets.bold, { subset: true });
  const addressBold = await doc.embedFont(assets.addressBold, { subset: true });
  const logo = await doc.embedPng(assets.logo);

  const titleSize = sizeForWidth(bold, "NASA LOGISTICS CARRIERS", 217.2);
  const billLabelSize = sizeForWidth(bold, "BILL TO:", 36.3);
  const billNameSize = sizeForWidth(bold, "GOFO INC.", 82.8);
  const termsTitleSize = sizeForWidth(bold, TERMS_TITLE, 115);
  const lines = invoice.lines ?? [];
  const itemPages = invoice.type === "item" ? pagesFor(lines) : [lines];
  const pageCount = itemPages.length;

  const newPage = () => {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    // Side decoration: the orange bar, then the black corner over its foot.
    page.drawSvgPath("M17.47 -10 L35.24 -10 L35.24 621.6 L17.47 621.6 Z", { x: 0, y: PAGE.height, color: COLORS.orange });
    page.drawSvgPath("M3.75 539.4 L46.15 581.4 L46.15 816 L3.75 858 Z", { x: 0, y: PAGE.height, color: COLORS.black });
    return page;
  };
  const pageNumber = (page, index) => {
    if (pageCount > 1) drawText(page, `PAGE ${index + 1} OF ${pageCount}`, { x: 588, y: 780, size: SIZE.pageNo, font: bold, align: "right" });
  };

  // ---- page one: issuer, logo, invoice number / date / billing period, bill to ----
  const first = newPage();
  drawText(first, printable(issuer.name, bold), { x: MARGIN, y: 65.6, size: titleSize, font: bold, color: COLORS.purple });
  issuer.addressLines.forEach((line, i) => drawText(first, printable(line, addressBold), { x: MARGIN, y: 84.7 + i * 15.4, size: SIZE.address, font: addressBold }));
  rect(first, { x: 379, top: 28.6, width: 179.8, height: 78.3, color: COLORS.logoPurple });
  const logoWidth = 207;
  const logoHeight = (logo.height / logo.width) * logoWidth;
  first.drawImage(logo, { x: 468.9 - logoWidth / 2, y: toPdfY(70.6 + logoHeight / 2), width: logoWidth, height: logoHeight });
  const facts = [
    `INVOICE NUMBER: ${printable(invoice.invoiceNumber, bold)}`,
    `INVOICE DATE: ${usDate(invoice.invoiceDate)}`,
    `BILLING PERIOD: ${periodText(invoice.periodStart, invoice.periodEnd)}`,
  ];
  facts.forEach((text, i) => {
    const fitted = fitText(text, bold, SIZE.label, 209, 6);
    drawText(first, fitted.text, { x: 379, y: 125 + i * 10.3, size: fitted.size, font: bold });
  });

  drawText(first, "BILL TO:", { x: MARGIN, y: 154, size: billLabelSize, font: bold });
  const billTo = invoice.billTo ?? {};
  const name = fitText(printable(billTo.name, bold), bold, billNameSize, 300, 9);
  drawText(first, name.text, { x: MARGIN, y: 181, size: name.size, font: bold, color: COLORS.purple });
  const contact = [billTo.contactName && `ATTN: ${printable(billTo.contactName, addressBold)}`, billTo.contactEmail && printable(billTo.contactEmail, addressBold, true)].filter(Boolean).join("  ·  ");
  [printable(billTo.line1, addressBold), printable(billTo.line2, addressBold), contact].filter(Boolean).forEach((line, i) => {
    const fitted = fitText(line, addressBold, SIZE.address, 300, 7);
    drawText(first, fitted.text, { x: MARGIN, y: 195.3 + i * 13, size: fitted.size, font: addressBold });
  });
  first.drawLine({ start: { x: TABLE.left, y: toPdfY(235.8) }, end: { x: TABLE.left + TABLE.width, y: toPdfY(235.8) }, thickness: 1, color: COLORS.line });

  const header = (page, top, labels) => {
    rect(page, { x: TABLE.left, top, width: TABLE.width, height: TABLE.headerHeight, color: COLORS.purple });
    const baseline = top + TABLE.headerHeight / 2 + SIZE.head * 0.35;
    for (const [text, x, align] of labels) drawText(page, text, { x, y: baseline, size: SIZE.head, font: bold, color: COLORS.white, align });
  };

  let last = first;
  if (invoice.type === "item") {
    const c = ITEM.columns;
    const labels = [["DATE", c.date, "left"], ["DAY", c.day, "left"], ["ITEM", c.item, "left"], ["RATE", c.rate, "right"], ["QUANTITY", c.quantity, "right"], ["TOTAL", c.total, "right"]];
    itemPages.forEach((pageLines, index) => {
      const page = index === 0 ? first : newPage();
      let firstRowTop = ITEM.firstRowTopPage1;
      if (index === 0) header(page, TABLE.headerTop, labels);
      else {
        // A page that continues the table: who it is from and which invoice, then the same column headers.
        drawText(page, printable(issuer.name, bold), { x: MARGIN, y: 50, size: 11, font: bold, color: COLORS.purple });
        drawText(page, `INVOICE NUMBER: ${printable(invoice.invoiceNumber, bold)}  (CONTINUED)`, { x: 588, y: 50, size: SIZE.label, font: bold, align: "right" });
        header(page, ITEM.laterHeaderTop, labels);
        firstRowTop = ITEM.firstRowTopLater;
      }
      pageLines.forEach((line, i) => {
        const top = firstRowTop + i * ITEM.rowPitch;
        if (i % 2 === 0) rect(page, { x: TABLE.left, top, width: TABLE.width, height: ITEM.rowHeight, color: ROW_TINT });
        const baseline = top + ITEM.rowHeight / 2 + SIZE.item * 0.35;
        const cell = (text, x, align = "left", font = regular) => drawText(page, text, { x, y: baseline, size: SIZE.item, font, align });
        cell(usDate(line.date), c.date);
        cell(printable(weekdayOf(line.date), regular), c.day);
        const item = fitText(printable(line.item, regular), regular, SIZE.item, c.itemWidth, 6);
        drawText(page, item.text, { x: c.item, y: baseline, size: item.size, font: regular });
        cell(amountText(line.rate), c.rate, "right");
        cell(quantityText(line.quantity), c.quantity, "right");
        cell(amountText(line.total), c.total, "right", bold);
      });
      if (index === pageCount - 1) {
        const top = firstRowTop + pageLines.length * ITEM.rowPitch + ITEM.subtotalGap;
        rect(page, { x: TABLE.left, top, width: TABLE.width, height: TABLE.headerHeight, color: COLORS.purple });
        const baseline = top + TABLE.headerHeight / 2 + SIZE.head * 0.35;
        drawText(page, "SUBTOTAL", { x: c.quantity, y: baseline, size: SIZE.head, font: bold, color: COLORS.white, align: "right" });
        drawText(page, amountText(invoice.total), { x: c.total, y: baseline, size: SIZE.head + 0.6, font: bold, color: COLORS.white, align: "right" });
        last = page;
      }
      pageNumber(page, index);
    });
  } else {
    // Hourly: the template's own table, one orange row per job.
    header(first, TABLE.headerTop, [["JOB", COLUMNS.job, "left"], ["TOTAL RE HOURS", COLUMNS.reHours, "center"], ["OVERTIME", COLUMNS.overtime, "center"],
      ["TOTAL HOURS", COLUMNS.totalHours, "center"], ["TOTAL COST", COLUMNS.totalCost, "center"]]);
    lines.forEach((row, i) => {
      const top = TABLE.firstRowTop + i * TABLE.rowPitch;
      rect(first, { x: TABLE.left, top, width: TABLE.width, height: TABLE.rowHeight, color: COLORS.orange });
      const baseline = top + TABLE.rowHeight / 2 + SIZE.cell * 0.35;
      // The job column ends before the RE hours figure begins, so a long job is shrunk, then shortened, never run into it.
      const job = fitText(printable(row.job, bold), bold, SIZE.cell, 125, 6);
      drawText(first, job.text, { x: COLUMNS.job, y: baseline, size: job.size, font: bold });
      drawText(first, row.reHours, { x: COLUMNS.reHours, y: baseline, size: SIZE.cell, font: bold, align: "center" });
      drawText(first, row.overtime, { x: COLUMNS.overtime, y: baseline, size: SIZE.cell, font: bold, align: "center" });
      drawText(first, row.totalHours, { x: COLUMNS.totalHours, y: baseline, size: SIZE.cell, font: bold, align: "center" });
      drawText(first, costText(readAmount(row.totalCost) ?? 0), { x: COLUMNS.totalCost, y: baseline, size: SIZE.cell, font: bold, align: "center" });
    });
  }

  // ---- the last page: terms, contact block, signature ----
  last.drawLine({ start: { x: TERMS.left, y: toPdfY(TERMS.lineY) }, end: { x: TERMS.right, y: toPdfY(TERMS.lineY) }, thickness: 1, color: COLORS.black });
  drawText(last, TERMS_TITLE, { x: TERMS.left, y: TERMS.titleY, size: termsTitleSize, font: bold });
  drawJustified(last, terms, { x: TERMS.left, width: TERMS.right - TERMS.left, y: TERMS.bodyFirstY, size: SIZE.terms, lead: TERMS.bodyLead, font: regular });

  const contactX = 87.5;
  drawText(last, "CONTACT", { x: MARGIN, y: 652, size: SIZE.contact, font: bold, color: COLORS.purple });
  drawContactIcon(last, "phone", 66.7, 675.3);
  drawText(last, "Phone", { x: contactX, y: 670, size: SIZE.contact, font: bold });
  drawText(last, issuer.phone, { x: contactX, y: 683.5, size: SIZE.contact, font: regular });
  drawContactIcon(last, "mail", 66.7, 713.5);
  drawText(last, "Email", { x: contactX, y: 707.3, size: SIZE.contact, font: bold });
  issuer.emails.forEach((email, i) => drawText(last, email, { x: contactX, y: 719.5 + i * 12.1, size: SIZE.contact, font: regular }));

  // Signature: the line and its label always; the owner's signature itself when it is switched on.
  if (invoice.includeSignature) {
    for (const path of SIGNATURE.paths) last.drawSvgPath(path, { x: 468.98, y: toPdfY(681.45), color: COLORS.ink });
  }
  last.drawLine({ start: { x: 465, y: toPdfY(736.7) }, end: { x: 545.2, y: toPdfY(736.7) }, thickness: 1.5, color: COLORS.black });
  drawText(last, "SIGNATURE", { x: 505.1, y: 751.4, size: sizeForWidth(bold, "SIGNATURE", 76), font: bold, align: "center" });

  return doc.save();
};

// ---- download and preview -----------------------------------------------------------------------------------------------------------------

const blobUrlOf = async (invoice) => {
  const bytes = await buildInvoicePdf(invoice, await loadInvoiceAssets());
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

// Makes the PDF of a saved invoice and saves it through the browser.
export const downloadInvoice = async (invoice) => {
  const url = await blobUrlOf(invoice);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFor(invoice.invoiceNumber);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

// Shows the PDF in a tab the caller opened (opened before any waiting, so the browser does not block it as a pop-up).
export const previewInvoice = async (invoice, tab) => {
  const url = await blobUrlOf(invoice);
  if (tab && !tab.closed) tab.location.href = url;
  else window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
