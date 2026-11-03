// Date ranges for history screens, in the person's own local calendar (the phone's date, not UTC).

// The driver Deliveries screen opens on this many calendar days, today included (issue #139).
export const HISTORY_DEFAULT_DAYS = 10;

const pad = (n) => String(n).padStart(2, "0");

// YYYY-MM-DD for the local calendar date of `date`.
export const toLocalDateString = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// The last `days` calendar days ending today, both ends included: 10 days on 3 Nov is 25 Oct to 3 Nov.
// Built from the local year, month and day so a daylight-saving change cannot skip or repeat a date.
export const lastDaysRange = (days = HISTORY_DEFAULT_DAYS, now = new Date()) => {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from_date: toLocalDateString(first), to_date: toLocalDateString(now) };
};
