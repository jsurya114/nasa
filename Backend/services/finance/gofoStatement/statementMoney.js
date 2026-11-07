// Exact money and dates for the carrier (GOFO) statement. Cents are whole numbers; nothing here uses floating-point sums.
// A blank cell is "missing" (null), which is different from a valid 0. Anything that is not money is an error, never 0.

export class StatementError extends Error {}

const TEXT_MONEY = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const FLOAT_TOLERANCE = 1e-4; // cents: a float such as 0.07 * 100 = 7.000000000000001 is still seven cents

// null for a blank cell, whole cents for a number or numeric text with at most two decimals, a StatementError for anything else.
export const centsOf = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && 'result' in value) return centsOf(value.result); // a formula cell: its saved result
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return null;
    const match = TEXT_MONEY.exec(text);
    if (!match) throw new StatementError('not an amount');
    const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
    return match[1] === '-' ? -cents : cents;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new StatementError('not an amount');
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > FLOAT_TOLERANCE) throw new StatementError('more than two decimals');
  return cents;
};

export const centsToText = (cents) => {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

// A whole count (deliveries, tickets): null when blank.
export const countOf = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isInteger(n) || n < 0) throw new StatementError('not a count');
  return n;
};

const DATE_TEXT = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/;
// "MM/DD/YYYY" or "MM/DD/YYYY HH:mm:ss" (the carrier's own format) to { day: 'YYYY-MM-DD', time }. The day is the carrier's, with no time zone shift.
export const dayOf = (value) => {
  const match = typeof value === 'string' ? DATE_TEXT.exec(value.trim()) : null;
  if (!match) throw new StatementError('not a date');
  const [, mm, dd, yyyy, hh = '00', mi = '00', ss = '00'] = match;
  const probe = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
  if (probe.getUTCMonth() !== Number(mm) - 1 || probe.getUTCDate() !== Number(dd) || Number(hh) > 23) throw new StatementError('not a date');
  return { day: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:${ss}` };
};
