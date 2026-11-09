// Backfills older carrier statements (issue #252). Reporting only: it calls the same preview and publish as the upload route, which write nothing but the
// carrier statement tables, so no payroll table, pay run, rate or Dashboard row is ever written. Pure orchestration: the caller passes the files and the two
// functions, so it is tested without a database.
//
// Files are handled oldest billing week first (then by name), one at a time, so a later week never waits on a failed earlier one. A file that does not reconcile is
// reported and skipped, never published. The default is a dry run: nothing is stored unless `commit` is true.

const ORDER_UNKNOWN = '9999';

export const orderFiles = (reviews) => [...reviews].sort((a, b) => (a.week ?? ORDER_UNKNOWN).localeCompare(b.week ?? ORDER_UNKNOWN) || a.name.localeCompare(b.name));

// files: [{ name, buffer }]. preview(buffer) and publish(buffer, { sourceLabel }) are the service functions.
export const runBackfill = async ({ files, preview, publish, commit = false }) => {
  const reviews = [];
  for (const file of files) {
    const result = await preview(file.buffer);
    reviews.push({ name: file.name, buffer: file.buffer, result, week: result.period?.start ?? null });
  }
  const results = [];
  for (const review of orderFiles(reviews)) {
    const { result } = review;
    const base = { file: review.name, billingWeek: result.period?.label ?? null, city: result.city?.name ?? null };
    if (result.status !== 'ready') {
      results.push({ ...base, outcome: 'rejected', reasons: result.reasons ?? [] });
    } else if (result.outcome.kind === 'already_published') {
      results.push({ ...base, outcome: 'already_published' });
    } else if (result.outcome.kind === 'older_version') {
      results.push({ ...base, outcome: 'older_version' });
    } else if (!commit) {
      results.push({ ...base, outcome: `would_publish_${result.outcome.kind}`, matchedRevenue: result.matching.matchedRevenue, unallocatedRevenue: result.matching.unallocatedRevenue });
    } else {
      const published = await publish(review.buffer, { sourceLabel: review.name });
      results.push({ ...base, outcome: published.status, version: published.version ?? null, matchedRevenue: published.matching?.matchedRevenue ?? null, unallocatedRevenue: published.matching?.unallocatedRevenue ?? null, reasons: published.reasons ?? undefined });
    }
  }
  const failed = results.filter((r) => r.outcome === 'rejected' || r.outcome === 'older_version').length;
  return { committed: commit, results, failed };
};
