// What the GOFO import history page says (issue #252). Display only: every amount is the exact text the server sent.

export const STATUS_LABELS = { published: "Published", superseded: "Replaced by a newer version", voided: "Voided" };

// A downloadable file name for the CSV export.
export const csvFileName = (date = new Date()) => `carrier-statements-${date.toISOString().slice(0, 10)}.csv`;
