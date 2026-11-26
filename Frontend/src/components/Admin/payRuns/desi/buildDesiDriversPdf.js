import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  COLORS, MARGIN, PAGE, drawText, fitText, loadInvoiceAssets, printable, rect, sizeForWidth, toPdfY, wrapWords,
} from "../../invoice/buildInvoicePdf.js";
import { ISSUER } from "../../invoice/invoiceTemplate.js";
import { usDate } from "../../invoice/invoiceRules.js";
import { formatMoney } from "../../../../utils/money.js";
import { notesOf, statusOf } from "../driverStatus.js";

// The Desi drivers of one pay run as a Letter PDF in NASA's invoice style (the same fonts, logo, side bar and purple), made in the browser from the
// payment review the page already loaded. Nothing is sent or stored. Each driver is a card like the one on screen: the name, the status, the amount,
// and the messages that hold the payment back. Runs over as many pages as it needs; every page is numbered.

const CARD = { left: MARGIN, width: 524.5, pad: 10, gap: 8, nameSize: 10.5, statusSize: 8.4, noteSize: 8, noteLead: 10.4 };
const AMOUNT_RIGHT = CARD.left + CARD.width - CARD.pad;
const NAME_WIDTH = 360;
const NOTE_WIDTH = CARD.width - 2 * CARD.pad;
const FIRST_CARD_TOP = 222;
const LATER_CARD_TOP = 78;
const BOTTOM = 760;
const TONES = {
  paid: rgb(0.082, 0.502, 0.239), // green-700
  warning: rgb(0.573, 0.251, 0.055), // amber-800, as on screen
  muted: rgb(0.4, 0.42, 0.46),
};
const BORDER = rgb(0.86, 0.86, 0.9);
const MONEY_GREY = rgb(0.4, 0.42, 0.46);

// What one card holds, as lines of text, so its height is known before anything is drawn.
export const cardOf = (driver, fonts) => {
  const status = statusOf(driver);
  const notes = notesOf(driver).flatMap((note) => wrapWords(printable(note, fonts.regular, true), fonts.regular, CARD.noteSize, NOTE_WIDTH).map((w) => w.join(" ")));
  const height = CARD.pad + 13 + 12 + notes.length * CARD.noteLead + CARD.pad - 2;
  return { driver, status, notes, height };
};

// Cards split into pages: as many as fit above the foot of each page.
export const pagesOfCards = (cards) => {
  const pages = [[]];
  let top = FIRST_CARD_TOP;
  for (const card of cards) {
    if (top + card.height > BOTTOM && pages.at(-1).length > 0) {
      pages.push([]);
      top = LATER_CARD_TOP;
    }
    pages.at(-1).push(card);
    top += card.height + CARD.gap;
  }
  return pages;
};

const sumCents = (drivers) => drivers.reduce((n, d) => n + Math.round(Number(d.amounts.net) * 100), 0) / 100;

// drivers: the Desi drivers of the run, as the payment review returns them. run: { period_start, period_end }. today: "YYYY-MM-DD".
export const buildDesiDriversPdf = async ({ drivers, run, cityName, today }, assets) => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Desi drivers ${cityName} ${run.period_start} to ${run.period_end}`);
  doc.setAuthor(ISSUER.name);
  doc.setCreator(ISSUER.name);
  doc.setProducer(ISSUER.name);
  const stamp = new Date(`${today}T12:00:00Z`);
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);
  const regular = await doc.embedFont(assets.regular, { subset: true });
  const bold = await doc.embedFont(assets.bold, { subset: true });
  const addressBold = await doc.embedFont(assets.addressBold, { subset: true });
  const logo = await doc.embedPng(assets.logo);

  const pages = pagesOfCards(drivers.map((d) => cardOf(d, { regular })));
  const newPage = (index) => {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    page.drawSvgPath("M17.47 -10 L35.24 -10 L35.24 621.6 L17.47 621.6 Z", { x: 0, y: PAGE.height, color: COLORS.orange });
    page.drawSvgPath("M3.75 539.4 L46.15 581.4 L46.15 816 L3.75 858 Z", { x: 0, y: PAGE.height, color: COLORS.black });
    drawText(page, `PAGE ${index + 1} OF ${pages.length}`, { x: 588, y: 780, size: 7.5, font: bold, align: "right" });
    return page;
  };
  const period = `${usDate(run.period_start)} - ${usDate(run.period_end)}`;

  pages.forEach((cards, index) => {
    const page = newPage(index);
    let top = LATER_CARD_TOP;
    if (index === 0) {
      // The invoice's header: who it is from, the logo panel, then what this list is.
      drawText(page, ISSUER.name, { x: MARGIN, y: 65.6, size: sizeForWidth(bold, ISSUER.name, 217.2), font: bold, color: COLORS.purple });
      ISSUER.addressLines.forEach((line, i) => drawText(page, line, { x: MARGIN, y: 84.7 + i * 15.4, size: 10.56, font: addressBold }));
      rect(page, { x: 379, top: 28.6, width: 179.8, height: 78.3, color: COLORS.logoPurple });
      const logoWidth = 207;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      page.drawImage(logo, { x: 468.9 - logoWidth / 2, y: toPdfY(70.6 + logoHeight / 2), width: logoWidth, height: logoHeight });
      [`CITY: ${printable(cityName, bold)}`, `PAY PERIOD: ${period}`, `PRINTED: ${usDate(today)}`].forEach((text, i) => {
        const fitted = fitText(text, bold, 8.63, 209, 6);
        drawText(page, fitted.text, { x: 379, y: 125 + i * 10.3, size: fitted.size, font: bold });
      });
      drawText(page, "DESI DRIVERS", { x: MARGIN, y: 150, size: 16, font: bold, color: COLORS.purple });
      drawText(page, "Desi drivers are paid by check only.", { x: MARGIN, y: 166, size: 8.6, font: regular });
      drawText(page, `${drivers.length} DRIVER${drivers.length === 1 ? "" : "S"}`, { x: MARGIN, y: 190, size: 9, font: bold });
      drawText(page, `TOTAL ${formatMoney(sumCents(drivers))}`, { x: AMOUNT_RIGHT, y: 190, size: 12, font: bold, color: COLORS.purple, align: "right" });
      page.drawLine({ start: { x: CARD.left, y: toPdfY(204) }, end: { x: CARD.left + CARD.width, y: toPdfY(204) }, thickness: 1, color: COLORS.line });
      top = FIRST_CARD_TOP;
    } else {
      drawText(page, ISSUER.name, { x: MARGIN, y: 50, size: 11, font: bold, color: COLORS.purple });
      drawText(page, `DESI DRIVERS · ${printable(cityName, bold)} · ${period}  (CONTINUED)`, { x: 588, y: 50, size: 8.63, font: bold, align: "right" });
    }
    if (drivers.length === 0 && index === 0) drawText(page, "No Desi drivers in this pay run.", { x: MARGIN, y: top + 12, size: 10, font: regular });

    for (const card of cards) {
      page.drawRectangle({ x: CARD.left, y: toPdfY(top + card.height), width: CARD.width, height: card.height, borderColor: BORDER, borderWidth: 0.8 });
      const x = CARD.left + CARD.pad;
      const name = fitText(printable(card.driver.driverName, bold, true), bold, CARD.nameSize, NAME_WIDTH, 7);
      drawText(page, name.text, { x, y: top + CARD.pad + 9, size: name.size, font: bold });
      const amount = formatMoney(card.driver.amounts.net);
      drawText(page, amount, { x: AMOUNT_RIGHT, y: top + CARD.pad + 9, size: CARD.nameSize, font: bold, color: amount.startsWith("-") ? MONEY_GREY : COLORS.black, align: "right" });
      drawText(page, card.status.label, { x, y: top + CARD.pad + 22, size: CARD.statusSize, font: regular, color: TONES[card.status.tone] });
      card.notes.forEach((line, i) => drawText(page, line, { x, y: top + CARD.pad + 35 + i * CARD.noteLead, size: CARD.noteSize, font: regular, color: TONES.warning }));
      top += card.height + CARD.gap;
    }
  });

  return doc.save();
};

const safePart = (text) => String(text ?? "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const fileNameOf = (cityName, run) => `desi-drivers-list-${safePart(cityName) || "city"}-${run.period_start}-to-${run.period_end}.pdf`;

// Makes the PDF and saves it through the browser.
export const downloadDesiDriversPdf = async ({ drivers, run, cityName, today }) => {
  const bytes = await buildDesiDriversPdf({ drivers, run, cityName, today }, await loadInvoiceAssets());
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameOf(cityName, run);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
