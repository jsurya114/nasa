import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY, TERMS_TEXT, TERMS_TITLE } from "./invoiceTemplate.js";
import { SIGNATURE } from "./invoiceSignature.js";
import { fileNameFor } from "./invoiceRules.js";
import montserratRegularUrl from "@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url";
import montserratBoldUrl from "@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url";
import openSansBoldUrl from "@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url";
import logoUrl from "../../../assets/invoice-logo.png?url";

// Draws NASA's invoice (the template the company supplied) as a one page Letter PDF, in the browser. Nothing is sent anywhere or stored: the
// bytes are made here and handed to the person as a download. Positions are in points from the top left of the page (the same way the template
// was measured); `y` is always the text baseline.

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

// Characters the font cannot draw are dropped, so a stray symbol in a name never stops the invoice from being made.
const printable = (text, font) => {
  const known = new Set(font.getCharacterSet());
  return [...String(text ?? "").toUpperCase().replace(/\s+/g, " ").trim()].filter((ch) => known.has(ch.codePointAt(0))).join("").replace(/\s+/g, " ").trim();
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
  pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
  mail: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
};

const drawContactIcon = (page, kind, cx, cy) => {
  const radius = 13.1;
  page.drawCircle({ x: cx, y: toPdfY(cy), size: radius, color: COLORS.orange });
  page.drawCircle({ x: cx, y: toPdfY(cy), size: radius - 1.9, borderColor: COLORS.black, borderWidth: 1, opacity: 0, borderOpacity: 1 });
  const scale = 0.5;
  page.drawSvgPath(ICONS[kind], { x: cx - 12 * scale, y: toPdfY(cy - 12 * scale), scale, color: COLORS.black });
  // the pin's hole
  if (kind === "pin") page.drawCircle({ x: cx, y: toPdfY(cy - 12 * scale + 9 * scale), size: 2.5 * scale, color: COLORS.orange });
};

// ---- the invoice --------------------------------------------------------------------------------------------------------------------------

// invoice: the cleaned form from checkInvoice(...).invoice. assets: { regular, bold, addressBold, logo } as bytes (see loadInvoiceAssets).
// Returns the PDF as bytes.
export const buildInvoicePdf = async (invoice, assets) => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Invoice ${invoice.invoiceNo}`);
  doc.setAuthor(COMPANY.name);
  doc.setCreator(COMPANY.name);
  doc.setProducer(COMPANY.name);
  const regular = await doc.embedFont(assets.regular, { subset: true });
  const bold = await doc.embedFont(assets.bold, { subset: true });
  const addressBold = await doc.embedFont(assets.addressBold, { subset: true });
  const logo = await doc.embedPng(assets.logo);
  const page = doc.addPage([PAGE.width, PAGE.height]);

  // Sizes that make this font as wide as the template's own text.
  const titleSize = sizeForWidth(bold, COMPANY.name, 217.2);
  const addressSize = sizeForWidth(addressBold, "2306 B MONTE CARLO DR,", 134.4);
  const labelSize = sizeForWidth(bold, "INVOICE NO : 0028", 84.7);
  const billLabelSize = sizeForWidth(bold, "BILL TO:", 36.3);
  const billNameSize = sizeForWidth(bold, "GOFO INC.", 82.8);
  const headSize = sizeForWidth(bold, "TOTAL RE HOURS", 79.5);
  const cellSize = sizeForWidth(bold, "GENERAL WORKER", 87.4);
  const termsTitleSize = sizeForWidth(bold, TERMS_TITLE, 115);
  const contactSize = 8.65;

  // Side decoration: the orange bar, then the black corner over its foot.
  page.drawSvgPath("M17.47 -10 L35.24 -10 L35.24 621.6 L17.47 621.6 Z", { x: 0, y: PAGE.height, color: COLORS.orange });
  page.drawSvgPath("M3.75 539.4 L46.15 581.4 L46.15 816 L3.75 858 Z", { x: 0, y: PAGE.height, color: COLORS.black });

  // Header: company, logo panel, invoice number and schedule.
  drawText(page, COMPANY.name, { x: MARGIN, y: 65.6, size: titleSize, font: bold, color: COLORS.purple });
  COMPANY.addressLines.forEach((line, i) => drawText(page, line, { x: MARGIN, y: 84.7 + i * 15.4, size: addressSize, font: addressBold }));
  rect(page, { x: 379, top: 28.6, width: 179.8, height: 78.3, color: COLORS.logoPurple });
  const logoWidth = 207;
  const logoHeight = (logo.height / logo.width) * logoWidth;
  page.drawImage(logo, { x: 468.9 - logoWidth / 2, y: toPdfY(70.6 + logoHeight / 2), width: logoWidth, height: logoHeight });
  drawText(page, `INVOICE NO : ${printable(invoice.invoiceNo, bold)}`, { x: 379, y: 125, size: labelSize, font: bold });
  drawText(page, `SCHEDULE: ${invoice.schedule}`, { x: 379, y: 135.3, size: labelSize, font: bold });

  // Bill to.
  drawText(page, "BILL TO:", { x: MARGIN, y: 154, size: billLabelSize, font: bold });
  const name = fitText(printable(invoice.billTo.name, bold), bold, billNameSize, 300, 9);
  drawText(page, name.text, { x: MARGIN, y: 181, size: name.size, font: bold, color: COLORS.purple });
  [invoice.billTo.line1, invoice.billTo.line2].filter(Boolean).forEach((line, i) => {
    const fitted = fitText(printable(line, addressBold), addressBold, addressSize, 300, 7);
    drawText(page, fitted.text, { x: MARGIN, y: 195.3 + i * 15, size: fitted.size, font: addressBold });
  });

  // Table: thin line, purple header, one orange row per job.
  page.drawLine({ start: { x: TABLE.left, y: toPdfY(235.8) }, end: { x: TABLE.left + TABLE.width, y: toPdfY(235.8) }, thickness: 1, color: COLORS.line });
  rect(page, { x: TABLE.left, top: TABLE.headerTop, width: TABLE.width, height: TABLE.headerHeight, color: COLORS.purple });
  const headBaseline = TABLE.headerTop + TABLE.headerHeight / 2 + headSize * 0.35;
  drawText(page, "JOB", { x: COLUMNS.job, y: headBaseline, size: headSize, font: bold, color: COLORS.white });
  drawText(page, "TOTAL RE HOURS", { x: COLUMNS.reHours, y: headBaseline, size: headSize, font: bold, color: COLORS.white, align: "center" });
  drawText(page, "OVERTIME", { x: COLUMNS.overtime, y: headBaseline, size: headSize, font: bold, color: COLORS.white, align: "center" });
  drawText(page, "TOTAL HOURS", { x: COLUMNS.totalHours, y: headBaseline, size: headSize, font: bold, color: COLORS.white, align: "center" });
  drawText(page, "TOTAL COST", { x: COLUMNS.totalCost, y: headBaseline, size: headSize, font: bold, color: COLORS.white, align: "center" });
  invoice.rows.forEach((row, i) => {
    const top = TABLE.firstRowTop + i * TABLE.rowPitch;
    rect(page, { x: TABLE.left, top, width: TABLE.width, height: TABLE.rowHeight, color: COLORS.orange });
    const baseline = top + TABLE.rowHeight / 2 + cellSize * 0.35;
    // The job column ends before the RE hours figure begins, so a long job is shrunk, then shortened, never run into it.
    const job = fitText(printable(row.job, bold), bold, cellSize, 125, 6);
    drawText(page, job.text, { x: COLUMNS.job, y: baseline, size: job.size, font: bold });
    drawText(page, row.reHours, { x: COLUMNS.reHours, y: baseline, size: cellSize, font: bold, align: "center" });
    drawText(page, row.overtime, { x: COLUMNS.overtime, y: baseline, size: cellSize, font: bold, align: "center" });
    drawText(page, row.totalHours, { x: COLUMNS.totalHours, y: baseline, size: cellSize, font: bold, align: "center" });
    drawText(page, row.totalCost, { x: COLUMNS.totalCost, y: baseline, size: cellSize, font: bold, align: "center" });
  });

  // Terms and conditions.
  page.drawLine({ start: { x: TERMS.left, y: toPdfY(TERMS.lineY) }, end: { x: TERMS.right, y: toPdfY(TERMS.lineY) }, thickness: 1, color: COLORS.black });
  drawText(page, TERMS_TITLE, { x: TERMS.left, y: TERMS.titleY, size: termsTitleSize, font: bold });
  drawJustified(page, TERMS_TEXT, { x: TERMS.left, width: TERMS.right - TERMS.left, y: TERMS.bodyFirstY, size: 8.65, lead: TERMS.bodyLead, font: regular });

  // Contact block.
  const contactX = 87.5;
  drawContactIcon(page, "phone", 66.7, 671.3);
  drawText(page, "Phone", { x: contactX, y: 666, size: contactSize, font: bold });
  drawText(page, COMPANY.phone, { x: contactX, y: 679.5, size: contactSize, font: regular });
  drawContactIcon(page, "pin", 66.7, 709.5);
  drawText(page, "Address", { x: contactX, y: 703.3, size: contactSize, font: bold });
  COMPANY.addressLines.forEach((line, i) => drawText(page, line, { x: contactX, y: 713.5 + i * 12.1, size: contactSize, font: regular }));
  drawContactIcon(page, "mail", 66.7, 748);
  drawText(page, "Email", { x: contactX, y: 742.8, size: contactSize, font: bold });
  drawText(page, COMPANY.email, { x: contactX, y: 755.8, size: contactSize, font: regular });

  // Signature: the line and its label always; the owner's signature itself when it is switched on.
  if (invoice.includeSignature) {
    for (const path of SIGNATURE.paths) page.drawSvgPath(path, { x: 468.98, y: toPdfY(681.45), color: COLORS.ink });
  }
  page.drawLine({ start: { x: 465, y: toPdfY(736.7) }, end: { x: 545.2, y: toPdfY(736.7) }, thickness: 1.5, color: COLORS.black });
  drawText(page, "SIGNATURE", { x: 505.1, y: 751.4, size: sizeForWidth(bold, "SIGNATURE", 76), font: bold, align: "center" });

  return doc.save();
};

// ---- download -----------------------------------------------------------------------------------------------------------------------------

// Makes the PDF and saves it through the browser. The file exists only in the person's browser and downloads folder.
export const downloadInvoice = async (invoice) => {
  const bytes = await buildInvoicePdf(invoice, await loadInvoiceAssets());
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFor(invoice.invoiceNo);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
