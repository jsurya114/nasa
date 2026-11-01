import pool from '../../config/db.js';

/**
 * City rules for the admin access code actions (issue #12).
 *
 * A superadmin may act on every access code. Any other admin may act only on codes
 * of the cities assigned to them in admin_city_ref. A code with no city yet
 * (city_id NULL, every code that existed before the city column) stays visible to
 * every admin, as before, but only a superadmin may change it, until a person
 * assigns it a city. The admin always comes from the verified token.
 */

export const isSuperAdmin = (user) => user?.role === 'superadmin';

// A city id from a request: digits only, or null.
export const parseCityId = (value) => (/^\d{1,9}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);

// Ids of the cities assigned to this admin.
export async function assignedCityIds(user) {
  if (!Number.isInteger(Number(user?.id)) || Number(user.id) <= 0) return [];
  const { rows } = await pool.query('SELECT city_id FROM admin_city_ref WHERE admin_id = $1', [user.id]);
  return rows.map((r) => r.city_id);
}

// May this admin change (edit or delete) a stored access code with this city_id?
export async function canChangeCode(user, codeCityId) {
  if (isSuperAdmin(user)) return true;
  if (codeCityId === null || codeCityId === undefined) return false;
  return (await assignedCityIds(user)).includes(codeCityId);
}

/**
 * The city a created or edited code is saved with.
 * Returns { cityId } or { error: { status, message } }.
 *  - requested: the city_id the form sent (may be empty)
 *  - current:   the city the stored code has now (undefined when creating)
 */
export async function resolveCodeCity(user, requested, current) {
  const asked = requested === undefined || requested === null || requested === '' ? null : parseCityId(requested);
  if (requested !== undefined && requested !== null && requested !== '' && asked === null) {
    return { error: { status: 400, message: 'Invalid city' } };
  }

  if (isSuperAdmin(user)) {
    if (asked === null) return { cityId: current ?? null };
    const { rowCount } = await pool.query('SELECT 1 FROM city WHERE id = $1', [asked]);
    return rowCount > 0 ? { cityId: asked } : { error: { status: 400, message: 'Invalid city' } };
  }

  const mine = await assignedCityIds(user);
  if (asked !== null) {
    return mine.includes(asked)
      ? { cityId: asked }
      : { error: { status: 403, message: 'You can only manage access codes in your assigned cities' } };
  }
  if (current !== undefined && current !== null) return { cityId: current };
  if (mine.length === 1) return { cityId: mine[0] };
  return { error: { status: 400, message: 'Choose the city for this access code' } };
}
