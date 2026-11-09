import { withTransaction } from '../../payroll/claims/claimsStore.js';

// One protocol for everything that decides or changes whether a driver is linked to an Everee worker (issue #242). Each such writer runs in a
// transaction that first takes this per-driver lock, so two of them for the same driver are strictly one after the other: the driver's own onboarding
// (claim and final save), an admin linking, unlinking or creating a test worker, and (see onboardingGate.js) a work write that must see the link as it is.
// A row lock cannot do this alone: when there is no link yet, there is no row to lock, and a writer could slip a link in between another writer's check
// and its write. The lock is held until the transaction ends. Provider (Everee) calls are never made while holding it.

export const DRIVER_LOCK_NAMESPACE = 424242;

export const lockDriver = (tx, driverId) => tx.query('SELECT pg_advisory_xact_lock($1, $2)', [DRIVER_LOCK_NAMESPACE, driverId]);

let savepointCounter = 0;

// A short transaction on a pool; on a client that is already inside one (the tests) a savepoint, so a failure undoes only this step.
export const inDriverTransaction = async (db, fn) => {
  // A pool has connect() but no release(); a client taken from a pool has both, so connect() alone cannot tell them apart.
  if (typeof db.connect === 'function' && typeof db.release !== 'function') return withTransaction(db, fn);
  const name = `driver_lock_sp_${savepointCounter++}`;
  await db.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn(db);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
};

// Runs fn(tx) in a transaction that holds the driver's lock.
export const withDriverLock = (db, driverId, fn) => inDriverTransaction(db, async (tx) => {
  await lockDriver(tx, driverId);
  return fn(tx);
});
