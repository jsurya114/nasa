import logger from '../../utils/logger.js';
import { PayrollError, assertCityAllowed, isSuperAdmin } from '../payroll/payRuns/payRunStore.js';
import { withDriverLock } from './everee/driverLock.js';

// A driver can edit their own email and phone in the Profile page. Everee and QuickBooks find a person by exactly those two details, so a changed
// one is held (drivers.contact_changed_at) until a super admin has checked it and confirms it here. Only then can the driver be linked to a payroll record.

// Clears the hold of one driver in one city. `contactChangedAt` is the moment the admin was shown: if the driver changed their details again since,
// it no longer matches and nothing is cleared, so the admin never confirms details they have not seen. Returns { confirmed: true }.
export const confirmContact = async (db, admin, { cityId, driverId, contactChangedAt }) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can confirm a driver\'s contact details');
  await assertCityAllowed(db, admin, cityId);
  const shown = new Date(contactChangedAt);
  if (!contactChangedAt || Number.isNaN(shown.getTime())) throw new PayrollError(400, 'contactChangedAt must be the time shown for this driver');

  const { rowCount } = await withDriverLock(db, driverId, (tx) => tx.query(
    `UPDATE drivers SET contact_changed_at = NULL
      WHERE id = $1 AND city_id = $2 AND date_trunc('milliseconds', contact_changed_at) = date_trunc('milliseconds', $3::timestamptz)`,
    [driverId, cityId, shown.toISOString()]));
  if (rowCount === 0) throw new PayrollError(409, 'this driver\'s contact details changed or were already confirmed; reload and check them again');
  logger.info('Driver contact details confirmed', { driverId, adminId: admin.id });
  return { confirmed: true };
};
