// Rules for saving an edited driver, and what a failed save says. Pure: no database, no Express.
// A refused value is a clear 400 or 409 the admin can act on. It must never surface as a bare "Server error", which tells nobody what to change.

export const LIMITS = Object.freeze({ email: 150, phone: 20, driverCode: 2147483647 });

// The fields that go straight into columns with a size or type limit. `enabled` is NOT NOT-NULL-safe from the form (an old client may leave it out),
// so a missing one keeps the driver's current value. Returns { error } or { email, phoneNumber, driverCode }.
export const parseDriverFields = ({ email, phoneNumber, driver_code: driverCode }) => {
  const mail = typeof email === 'string' ? email.trim() : '';
  if (!mail) return { error: 'Email is required' };
  if (mail.length > LIMITS.email) return { error: `Email can be at most ${LIMITS.email} characters` };
  const phone = phoneNumber === undefined || phoneNumber === null ? '' : String(phoneNumber).trim();
  if (phone.length > LIMITS.phone) return { error: `Phone number can be at most ${LIMITS.phone} characters` };
  const code = String(driverCode ?? '').trim();
  if (code !== '' && (!/^\d{1,10}$/.test(code) || Number(code) < 1 || Number(code) > LIMITS.driverCode)) {
    return { error: 'Driver code must be a whole number between 1 and 2147483647' };
  }
  return { email: mail, phoneNumber: phone === '' ? null : phone, driverCode: code === '' ? null : Number(code) };
};

// What to answer when the database or a lookup refused the save: { status, message }, or null when it is not a refusal we know (a real server error).
export const driverUpdateFailure = (error) => {
  if (error?.code === 'CITY_NOT_AVAILABLE') return { status: 400, message: 'That city is disabled or no longer exists. Enable it or choose another city.' };
  if (error?.code === '23505') {
    if (/drivers_email/.test(error.constraint ?? '')) return { status: 409, message: 'Another driver already uses this email' };
    if (/drivers_driver_code/.test(error.constraint ?? '')) return { status: 409, message: 'Driver code already exists' };
  }
  if (error?.code === '22001') return { status: 400, message: `A value is too long (email up to ${LIMITS.email} characters, phone up to ${LIMITS.phone})` };
  if (error?.code === '22003' || error?.code === '22P02') return { status: 400, message: 'Driver code must be a whole number between 1 and 2147483647' };
  return null;
};
