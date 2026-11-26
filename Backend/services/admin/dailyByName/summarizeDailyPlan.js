// What the daily upload tells the admin after finding drivers by name: a count of every row of the file, and the lists that need a look.
// Names only for drivers already in the app and names as written in the file; no phone numbers or addresses.

export const LIST_LIMIT = 200;

const capped = (list) => ({ total: list.length, list: list.slice(0, LIST_LIMIT) });

export const summarizeDailyPlan = (plan, applied) => {
  const { inFile, ...parts } = plan.counts;
  const counted = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    rows: { inFile, ...parts, counted },
    days: { created: applied?.created ?? 0, extended: applied?.extended ?? 0, rebuilt: applied?.rebuilt ?? 0 },
    unmatchedNames: capped(plan.unmatchedNames.map(({ cityId, job, fileName, parcels, routes }) => ({ cityId, city: job, fileName, parcels, routes }))),
    disabledDrivers: capped(plan.disabledDrivers.map(({ cityId, job, fileName, driverId, parcels, routes }) => ({ cityId, city: job, fileName, driverId, parcels, routes }))),
    missingRoutes: capped(plan.missingRoutes),
    atMainPrice: capped(plan.atMainPrice),
    movedToSub: capped(plan.movedToSub),
    clashes: capped(plan.clashes),
    paidDays: capped(plan.paidDays),
  };
};
