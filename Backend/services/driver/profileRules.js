import { cleanDriverName, MAX_DRIVER_NAME } from '../admin/driverName.js';
import { LIMITS, parsePhone } from '../admin/driverUpdateRules.js';

// Rules for a driver editing their own profile (full name, email, phone). Pure: no database, no Express.
// The name and phone use the same rules as the admin's Edit Driver form, so a value one side accepts the other accepts too.

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Each refused field maps to a key under `profile.` in the backend translations, so the message reaches the driver in their language.
// Returns { values: { name, email, phoneNumber } } (cleaned, ready to store) or { errors: { name?, email?, phoneNumber? } }.
export const parseProfile = (body) => {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};

  const name = cleanDriverName(input.name);
  if (!name) errors.name = 'nameRequired';
  else if (name.length > MAX_DRIVER_NAME) errors.name = 'nameTooLong';

  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!email) errors.email = 'emailRequired';
  else if (email.length > LIMITS.email) errors.email = 'emailTooLong';
  else if (!EMAIL_SHAPE.test(email)) errors.email = 'emailInvalid';

  const phone = parsePhone(input.phoneNumber);
  if (phone.error) errors.phoneNumber = 'phoneInvalid';

  if (Object.keys(errors).length > 0) return { errors };
  return { values: { name, email, phoneNumber: phone.phone } };
};
