import { DRIVER_TYPES } from '../../admin/driverType.js';

// Which way a driver may be paid depends on the driver's type (LOCAL or DESI, the field set in the Drivers table). These rules are enforced
// on the server for every payment, never only on the screen:
//   LOCAL: Cash in Hand, or Everee.   DESI: QuickBooks (or Cash in Hand while QuickBooks payments are off), never Everee.   No type set: not paid at all until an admin chooses one.
// 'cash' is the method name stored on payment records; 'everee' is the Everee payment gateway (its payments live in the everee_* tables).
export const CASH = 'cash';
export const EVEREE = 'everee';
export const QUICKBOOKS = 'quickbooks'; // Desi drivers: the payment is recorded in QuickBooks (their 1099 records live there); its tables are quickbooks_*
export const METHODS_FOR = Object.freeze({ LOCAL: Object.freeze([CASH, EVEREE]), DESI: Object.freeze([CASH, QUICKBOOKS]) });

export const isDriverType = (value) => DRIVER_TYPES.includes(value);
export const methodAllowed = (driverType, method) => isDriverType(driverType) && METHODS_FOR[driverType].includes(method);

export const TYPE_BLOCKERS = Object.freeze({
  driver_type_not_set: { severity: 'blocking', message: 'set this driver as Local or Desi in the Drivers page before paying' },
  desi_not_everee: { severity: 'blocking', message: 'Desi drivers are paid in cash only, never through Everee' },
});

// Pure. Blockers that come from the driver's type alone, for a payment of any method.
export const typeBlockers = (driverType) => (isDriverType(driverType) ? [] : [{ code: 'driver_type_not_set', ...TYPE_BLOCKERS.driver_type_not_set }]);

// Pure. What stops this driver being paid through Everee because of the type (a driver with no type is already stopped by typeBlockers).
export const evereeTypeBlockers = (driverType) => (driverType === 'DESI' ? [{ code: 'desi_not_everee', ...TYPE_BLOCKERS.desi_not_everee }] : []);
