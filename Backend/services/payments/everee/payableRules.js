// What is sent to Everee for one pay statement (issue #31, part 4). Pure: no database, no network.
// Agreed with Jasil on #31: pay code CONTRACTOR; the earning date is the pay run's last day at noon in the city's time zone.

export const PAY_CODE = 'CONTRACTOR';
export const PAYABLE_TYPE = 'NASA_PAY_RUN';
export const DEFAULT_TIME_ZONE = 'America/Chicago'; // the sandbox default; a live payment needs the city's own setting

export const externalIdOf = (statementId) => `nasa-stmt-${statementId}`;

export const isTimeZone = (name) => {
  if (typeof name !== 'string' || name.length < 3 || name.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

// Unix seconds of 12:00 on `date` (YYYY-MM-DD) in `timeZone`. Noon is far from the clock change at 2 am, so the answer is the same on the day
// the clocks change. Found by asking the time zone what UTC offset it has at that moment.
export const noonInZone = (date, timeZone) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isTimeZone(timeZone)) throw new Error('a date and a time zone are needed');
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 12, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const at = (type) => Number(parts.find((p) => p.type === type).value);
  const shown = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'));
  const offsetMs = shown - guess; // how far the zone's clock is from UTC at that moment
  return Math.round((guess - offsetMs) / 1000);
};

// The body of POST /integration/v1/payables. The amount is the statement's frozen net, as it is (never recalculated). The label carries no
// personal data. The worker is named by the external ID when the link has one, else by Everee's own ID.
export const payableBody = ({ statementId, amount, worker, periodStart, periodEnd, timeZone, workLocationId }) => ({
  externalId: externalIdOf(statementId),
  ...(worker.externalWorkerId ? { externalWorkerId: worker.externalWorkerId } : { workerId: worker.workerId }),
  type: PAYABLE_TYPE,
  label: `NASA pay ${periodStart} to ${periodEnd}`,
  amount: { amount: Number(amount), currency: 'USD' },
  payableModel: 'PRE_CALCULATED',
  payCode: PAY_CODE,
  earningTimestamp: noonInZone(periodEnd, timeZone),
  ...(workLocationId ? { workLocationId: Number(workLocationId) } : {}),
});
