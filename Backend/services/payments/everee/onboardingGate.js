import { readEvereeConfig } from './evereeConfig.js';
import { withDriverLock } from './driverLock.js';

// The hard gate of Everee onboarding (issue #242, PR B). A LOCAL driver whose Everee onboarding is not verified complete cannot work and cannot be
// the subject of ANY new payment, Cash in Hand included. Desi drivers and drivers with no type are not affected by this gate (their own type rules stay).
//
// Enforced only when BOTH EVEREE_DRIVER_ONBOARDING_ENABLED and EVEREE_ONBOARDING_ENFORCED are exactly "true". Off, nothing here queries anything, so the app
// behaves as before and works on a database that has not run the onboarding migration. On, it fails closed: if Everee is not set up, no Local driver can
// be verified, so every Local driver is held. There is no silent bypass and no Desi or cash fallback.
//
// "Verified complete" is the same thing the driver's status screen shows (driverOnboarding.js): a live link in the configured environment AND tenant whose
// onboarding_complete is true, as read from Everee. A link made before tenants were recorded (tenant NULL) or for another tenant does not count.
// Nothing else is restricted (no extra work rule for a failed tax ID, for example): that is Everee readiness, which is separate.

export const ONBOARDING_REQUIRED = Object.freeze({
  code: 'onboarding_required',
  message: 'Everee payment setup is not complete. Work and payments are on hold until the driver finishes it.',
});

const flag = (value) => String(value ?? '').trim().toLowerCase() === 'true';

export const enforcement = (env = process.env) => ({
  enforced: flag(env.EVEREE_DRIVER_ONBOARDING_ENABLED) && flag(env.EVEREE_ONBOARDING_ENFORCED),
  config: readEvereeConfig(env),
});

// Of these driver IDs, the ones held by the gate (a Set of numbers). With `lock`, the driver rows and their live links are share-locked until the
// transaction ends, so the type or the link cannot change between this check and the write that follows it.
export const blockedDriverIds = async (db, driverIds, { env = process.env, lock = false } = {}) => {
  const { enforced, config } = enforcement(env);
  const ids = [...new Set((driverIds ?? []).map(Number).filter(Number.isInteger))];
  if (!enforced || ids.length === 0) return new Set();
  const params = [ids, config.environment, config.tenantId];
  if (lock) {
    await db.query('SELECT id FROM everee_workers WHERE driver_id = ANY($1::int[]) AND unlinked_at IS NULL ORDER BY id FOR SHARE', [ids]);
  }
  const { rows } = await db.query(
    `SELECT d.id FROM drivers d
      WHERE d.id = ANY($1::int[]) AND d.driver_type = 'LOCAL'
        AND NOT EXISTS (SELECT 1 FROM everee_workers w
                         WHERE w.driver_id = d.id AND w.environment = $2 AND w.tenant_id = $3 AND w.unlinked_at IS NULL AND w.onboarding_complete)
      ORDER BY d.id ${lock ? 'FOR SHARE OF d' : ''}`, params);
  return new Set(rows.map((r) => r.id));
};

export class OnboardingRequiredError extends Error {
  constructor(driverIds = []) {
    super(ONBOARDING_REQUIRED.message);
    this.name = 'OnboardingRequiredError';
    this.status = 409;
    this.code = ONBOARDING_REQUIRED.code;
    this.driverIds = driverIds;
  }
}

// For one driver's work. Throws OnboardingRequiredError when the gate holds this driver.
export const assertMayWork = async (db, driverId, deps = {}) => {
  const blocked = await blockedDriverIds(db, [driverId], deps);
  if (blocked.size > 0) throw new OnboardingRequiredError([...blocked]);
};

// A work write that must not be undone by a concurrent eligibility change. With the gate off it simply runs `fn(pool)` as before. With the gate on, the check
// and the write are ONE transaction: it takes the driver's lock (driverLock.js), checks the driver with the driver row and the live links share-locked, and
// runs `fn(tx)` on the same connection, so an administrator's unlink, a classification change or a link refresh is either completely before it (and
// refuses the work) or waits until the work has committed. `fn` must do every write through the `db` it is given.
export const withWorkGate = async (pool, driverId, fn, deps = {}) => {
  if (!enforcement(deps.env ?? process.env).enforced) return fn(pool);
  return withDriverLock(pool, driverId, async (tx) => {
    await assertMayWork(tx, driverId, { ...deps, lock: true });
    return fn(tx);
  });
};

// For a set of drivers about to be paid. The whole set is refused when any one is held (never a partial payment of a mixed selection).
export const assertMayBePaid = async (db, driverIds, deps = {}) => {
  const blocked = await blockedDriverIds(db, driverIds, deps);
  if (blocked.size > 0) throw new OnboardingRequiredError([...blocked]);
};

// The answer a driver or admin screen gets for a refused work action.
export const refusal = () => ({ success: false, code: ONBOARDING_REQUIRED.code, message: ONBOARDING_REQUIRED.message });

// An availability update "allows work" when it turns a day ON that was off. Turning days off, or leaving them as they are, stays allowed.
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const turnsWorkOn = (requested, current) => {
  const before = current?.availability ?? current ?? {};
  return DAYS.some((day) => requested?.[day] === true && before?.[day] !== true);
};
