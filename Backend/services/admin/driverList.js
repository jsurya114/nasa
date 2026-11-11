import { readEvereeConfig } from '../payments/everee/evereeConfig.js';
import { normalizePhone, splitName } from '../payments/everee/workerRules.js';

// The Users page's list of drivers: search, filters, sorting and each driver's Everee onboarding status, in one query. Read only.
//
// Everee status is derived the same way the payment setup overview does it (services/payments/everee/onboardingReadiness.js): a Local driver is
// "complete" only with a live Everee link for the configured environment AND tenant whose onboarding is complete. NASA's own records are read; nothing
// is asked of Everee here. Desi drivers do not use Everee, and a driver with no type is waiting to be classified.

export const PAGE_SIZE = 10;

export class ListInputError extends Error {}

// The statuses an admin can filter by. 'in-progress' covers a started setup, one being created and one being checked by Everee.
export const STATUSES = Object.freeze(['complete', 'in-progress', 'not-started', 'needs-review', 'not-required', 'classification-required', 'service-unavailable']);
export const ISSUES = Object.freeze(['no_phone', 'agreement_not_signed', 'one_word_name']);
export const SORTS = Object.freeze(['name', 'code', 'city', 'type', 'status', 'enabled']);
const TYPES = ['LOCAL', 'DESI', 'none'];

// Everything the caller may choose is checked against these lists, and only the lists' own words ever reach the SQL text.
export const parseListQuery = (query = {}) => {
  const pick = (value, allowed, label) => {
    if (value === undefined || value === '' || value === 'All') return '';
    if (!allowed.includes(value)) throw new ListInputError(`Unknown ${label}`);
    return value;
  };
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new ListInputError('Unknown page');
  const search = String(query.search ?? '').trim().slice(0, 100);
  const dir = pick(String(query.dir ?? '').toLowerCase() || undefined, ['asc', 'desc'], 'sort direction') || 'asc';
  return {
    page,
    search,
    city: String(query.city ?? '').slice(0, 100),
    type: pick(query.type, TYPES, 'driver type'),
    enabled: pick(query.enabled, ['enabled', 'disabled'], 'account filter'),
    status: pick(query.status, STATUSES, 'Everee status'),
    issue: pick(query.issue, ISSUES, 'issue'),
    sort: pick(query.sort, SORTS, 'sort') || 'name',
    dir,
  };
};

// Pending work first when sorted ascending, finished and not-applicable last.
const STATUS_RANK = `CASE s.grp WHEN 'needs-review' THEN 1 WHEN 'not-started' THEN 2 WHEN 'in-progress' THEN 3 WHEN 'complete' THEN 4
  WHEN 'service-unavailable' THEN 5 WHEN 'classification-required' THEN 6 ELSE 7 END`;
const SORT_SQL = {
  name: 'lower(s.name)',
  code: 's.driver_code',
  city: 'lower(s.job)',
  type: "CASE s.driver_type WHEN 'LOCAL' THEN 1 WHEN 'DESI' THEN 2 ELSE 3 END",
  status: STATUS_RANK,
  enabled: 'CASE WHEN s.enabled THEN 0 ELSE 1 END',
};

const PHONE_OK = `regexp_replace(COALESCE(d.phone_number, ''), '\\D', '', 'g') ~ '^1?[0-9]{10}$'`;
const ISSUE_SQL = {
  no_phone: `NOT (${PHONE_OK})`,
  agreement_not_signed: 'NOT COALESCE(d.agreement_signed, false)',
  one_word_name: `btrim(regexp_replace(d.name, '\\s+', ' ', 'g')) !~ ' '`,
};

const tablesReady = async (db) => (await db.query("SELECT to_regclass('everee_workers') IS NOT NULL AND to_regclass('everee_onboarding') IS NOT NULL AS ok")).rows[0].ok;

// scope: { adminId } for an ordinary admin (only the cities they are assigned to) or { all: true } for a super admin.
// Returns { drivers, total, totalPages, page, counts, everee }.
export async function listDrivers(db, scope, filters, { env = process.env } = {}) {
  const config = readEvereeConfig(env);
  const available = await tablesReady(db);
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  const evereeEnv = add(config.environment);
  const tenant = add(config.tenantId);
  const configured = add(Boolean(config.configured));

  // A server without the Everee tables (a database not migrated yet) has no link or onboarding records: nothing is invented, the status is "unavailable".
  const joins = available
    ? `LEFT JOIN everee_workers w ON w.driver_id = d.id AND w.environment = ${evereeEnv} AND w.unlinked_at IS NULL
       LEFT JOIN everee_onboarding o ON o.driver_id = d.id AND o.environment = ${evereeEnv} AND o.tenant_id = ${tenant}`
    : `LEFT JOIN (SELECT NULL::bigint AS id, NULL::int AS driver_id, NULL::text AS tenant_id, NULL::boolean AS onboarding_complete) w ON false
       LEFT JOIN (SELECT NULL::int AS driver_id, NULL::text AS state) o ON false`;
  const unlinked = available
    ? `EXISTS (SELECT 1 FROM everee_workers old WHERE old.driver_id = d.id AND old.environment = ${evereeEnv} AND old.unlinked_at IS NOT NULL)`
    : 'false';

  const where = [];
  let scopeJoin = '';
  if (scope.all) {
    // every driver with a city, as the list always did
  } else {
    scopeJoin = `JOIN admin_city_ref acr ON acr.city_id = c.id`;
    where.push(`acr.admin_id = ${add(scope.adminId)}`);
  }
  if (filters.search) {
    const like = add(`%${filters.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(d.name ILIKE ${like} OR d.email ILIKE ${like} OR d.driver_code::text ILIKE ${like} OR d.phone_number ILIKE ${like})`);
  }
  if (filters.city && filters.city !== 'All') where.push(`c.job = ${add(filters.city)}`);
  if (filters.type === 'none') where.push('d.driver_type IS NULL');
  else if (filters.type) where.push(`d.driver_type = ${add(filters.type)}`);
  if (filters.enabled) where.push(filters.enabled === 'enabled' ? 'd.enabled' : 'NOT d.enabled');
  if (filters.issue) where.push(ISSUE_SQL[filters.issue]);

  // The state of each driver, as the payment setup overview works it out.
  const base = `
    SELECT d.id, d.driver_code, d.name, d.email, d.phone_number, c.job, d.enabled, d.driver_type, d.agreement_signed,
      CASE
        WHEN d.driver_type IS NULL THEN 'classification-required'
        WHEN d.driver_type <> 'LOCAL' THEN 'not-required'
        WHEN NOT ${configured} THEN 'service-unavailable'
        WHEN w.id IS NOT NULL AND w.tenant_id IS DISTINCT FROM ${tenant} THEN 'needs-review'
        WHEN w.id IS NOT NULL AND w.onboarding_complete THEN 'complete'
        WHEN w.id IS NOT NULL THEN 'in-progress'
        WHEN ${unlinked} OR o.state = 'needs_review' THEN 'needs-review'
        WHEN o.state IN ('creating', 'verifying') THEN 'in-progress'
        ELSE 'not-started' END AS grp
    FROM drivers d
    JOIN city c ON c.id = d.city_id
    ${scopeJoin}
    ${joins}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  // Counts per status for the chips: every filter except the status itself, so the numbers say what choosing a chip would show.
  const { rows: countRows } = await db.query(`WITH s AS (${base}) SELECT grp, count(*)::int AS n FROM s GROUP BY grp`, params);
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  for (const r of countRows) counts[r.grp] = r.n;
  const all = countRows.reduce((sum, r) => sum + r.n, 0);

  const statusWhere = filters.status ? `WHERE s.grp = ${add(filters.status)}` : '';
  const order = `${SORT_SQL[filters.sort]} ${filters.dir === 'desc' ? 'DESC' : 'ASC'}, lower(s.name) ASC, s.id ASC`;
  const total = filters.status ? counts[filters.status] : all;
  const limit = add(PAGE_SIZE);
  const offset = add((filters.page - 1) * PAGE_SIZE);
  const { rows } = await db.query(`WITH s AS (${base}) SELECT * FROM s ${statusWhere} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params);

  const drivers = rows.map(({ agreement_signed: agreementSigned, grp, ...driver }) => {
    // What blocks Everee for a Local driver who is not onboarded: the three things its setup needs from NASA's own records.
    const needs = [];
    if (driver.driver_type === 'LOCAL' && grp !== 'complete') {
      if (!normalizePhone(driver.phone_number)) needs.push('no_phone');
      if (!agreementSigned) needs.push('agreement_not_signed');
      if (!splitName(driver.name)) needs.push('one_word_name');
    }
    return { ...driver, everee_status: grp, everee_needs: needs };
  });

  return {
    drivers,
    page: filters.page,
    total,
    totalPages: Math.ceil(total / PAGE_SIZE),
    counts: { all, ...counts },
    everee: {
      available,
      configured: Boolean(config.configured),
      onboardingEnabled: String(env.EVEREE_DRIVER_ONBOARDING_ENABLED ?? '').trim().toLowerCase() === 'true',
      enforced: String(env.EVEREE_DRIVER_ONBOARDING_ENABLED ?? '').trim().toLowerCase() === 'true' && String(env.EVEREE_ONBOARDING_ENFORCED ?? '').trim().toLowerCase() === 'true',
    },
  };
}
