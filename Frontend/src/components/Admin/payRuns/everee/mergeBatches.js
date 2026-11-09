// A run can be paid in several goes (one driver now, two later, the rest after that). Everee keeps each go as its own batch,
// but the person paying sees one list for the run. This joins the batches into one view and changes nothing on the server.
const toCents = (value) => Math.round(Number(value) * 100);

export const mergeBatches = (views) => {
  if (views.length <= 1) return views[0] ?? null;
  const counts = { submitted: 0, paid: 0, failed: 0, unconfirmed: 0 };
  for (const v of views) for (const key of Object.keys(counts)) counts[key] += v.counts[key] ?? 0;
  const latest = views.reduce((a, b) => (new Date(b.batch.createdAt) > new Date(a.batch.createdAt) ? b : a));
  const cents = views.reduce((sum, v) => sum + toCents(v.batch.total), 0);
  return {
    batch: {
      ...latest.batch,
      drivers: views.reduce((n, v) => n + v.batch.drivers, 0),
      total: (cents / 100).toFixed(2),
      sends: views.length,
    },
    counts,
    items: views.flatMap((v) => v.items).sort((a, b) => a.driverName.localeCompare(b.driverName) || a.itemId - b.itemId),
    canRetry: views.some((v) => v.canRetry),
  };
};

// Which batches an action applies to: checking is for batches still waiting or with a returned deposit; retrying for batches that can.
export const needsCheck = (v) => v.counts.submitted + v.counts.unconfirmed > 0 || v.items.some((i) => i.everee?.depositReturned);
export const needsRetry = (v) => Boolean(v.canRetry);
