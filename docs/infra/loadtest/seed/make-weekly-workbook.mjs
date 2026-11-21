#!/usr/bin/env node
// A fictional weekly carrier workbook for the staging upload test, plus the totals the upload must report.
// Uses the seeded drivers (driver_code 100001..100786) and routes (STGR001..STGR100). No real data.
//   NODE_PATH=Backend/node_modules node docs/infra/loadtest/seed/make-weekly-workbook.mjs <out.xlsx> <expected.json>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const [out, expectedOut] = process.argv.slice(2);
if (!out || !expectedOut) { console.error('usage: make-weekly-workbook.mjs <out.xlsx> <expected.json>'); process.exit(2); }

const DRIVERS = 420;           // drivers who worked in the week
const DAYS = 7;
const WORKED = 0.6;            // share of driver-days worked
const pad = (n, w) => String(n).padStart(w, '0');
// Last week's Monday to Sunday in America/Chicago terms; dates only, so the time zone of this machine does not matter.
const today = new Date();
const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7) - 7));

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Details of Delivery Fees');
ws.addRow(['No.', 'Region/Route', 'Courier', 'Delivery ID', 'Signing Time', 'Stop Point Details', 'Fee']);
let rows = 0;
const groups = new Set();
for (let d = 1; d <= DRIVERS; d++) {
  const city = (d - 1) % 8 + 1;
  const route = `STGR${pad(Math.min(100, city + 8 * (d % 12)), 3)}`;
  for (let day = 0; day < DAYS; day++) {
    if (rand() > WORKED) continue;
    const date = new Date(monday.getTime() + day * 86400000);
    const mmddyyyy = `${pad(date.getUTCMonth() + 1, 2)}/${pad(date.getUTCDate(), 2)}/${date.getUTCFullYear()}`;
    const packages = 25 + Math.floor(rand() * 25);
    for (let s = 1; s <= packages; s++) {
      const stop = s % 5 === 0 ? s - 1 : s; // every fifth package shares the previous stop's address
      ws.addRow([++rows, route, `Load Test Driver ${pad(d, 4)}`, 100000 + d, `${mmddyyyy} ${pad(8 + Math.floor(s / 6), 2)}:${pad((s * 7) % 60, 2)}:00`, `${stop} Test Street, Unit ${d}`, 1.5]);
    }
    groups.add(`${date.toISOString().slice(0, 10)}-${100000 + d}-${route}`);
  }
}
await wb.xlsx.writeFile(out);
const expected = { recordsProcessed: rows, recordsSkipped: 0, recordsInserted: groups.size, weekStart: monday.toISOString().slice(0, 10) };
writeFileSync(expectedOut, JSON.stringify(expected, null, 2));
console.log(JSON.stringify(expected));
