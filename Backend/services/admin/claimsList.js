// The Claims page: the carrier's claims (from the weekly upload's Claims Detail sheet) for the cities an admin works in, read only.
//
// "Matched": a claim NASA matched to a driver and city (chargeable, or exempt for the city and claim type). "Unmatched": a claim with no driver yet
// ("unresolved": waiting for delivery history; "ambiguous": not clear which driver or city; "review": held because the same claim was entered by hand).
// A claim belongs to the city its file was uploaded for (import_city_id), so an ordinary admin sees the claims of their assigned cities and a super admin
// sees all. Only current versions are listed (an amended claim shows once, at its latest amount). Nothing here changes a claim or a pay run.

import { NET_COLLECTED_SQL } from '../payroll/payRuns/payRunStore.js';
import { fromCents, toCents } from '../payroll/payRuns/payCalculator.js';

export const PAGE_SIZE = 20;
export const TABS = Object.freeze(['matched', 'unmatched']);

export class ClaimsInputError extends Error {}

const MATCHED = ['chargeable', 'exempt'];
const UNMATCHED = ['unresolved', 'ambiguous', 'review'];

// Everything the caller may choose is checked here, and only these values ever reach the query as parameters.
export const parseClaimsQuery = (query = {}) => {
  const tab = query.tab === undefined || query.tab === '' ? 'unmatched' : query.tab;
  if (!TABS.includes(tab)) throw new ClaimsInputError('Unknown claims tab');
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new ClaimsInputError('Unknown page');
  const cityRaw = query.cityId === undefined || query.cityId === '' || query.cityId === 'All' ? null : String(query.cityId);
  if (cityRaw !== null && !/^\d{1,9}$/.test(cityRaw)) throw new ClaimsInputError('Unknown city');
  return { tab, page, cityId: cityRaw === null ? null : Number(cityRaw), search: String(query.search ?? '').trim().slice(0, 100) };
};

// Who is asking, and what they may see, from the database now (not from the role in the token): a disabled or deleted account has no access, a super admin
// sees all claims, an ordinary admin only the cities assigned to them, and anything else (a driver id, an unknown role) nothing. null means no access.
export const claimsScopeOf = async (db, tokenAdmin) => {
  const id = Number(tokenAdmin?.id);
  if (!['admin', 'superadmin'].includes(tokenAdmin?.role) || !Number.isInteger(id) || id <= 0) return null;
  const { rows: [row] } = await db.query('SELECT role, is_active FROM admin WHERE id = $1', [id]);
  if (!row || row.is_active !== true) return null;
  if (row.role === 'superadmin') return { all: true };
  return row.role === 'admin' ? { adminId: id } : null;
};

// What has been deducted for one claim, from the pay run history of the claim itself (every version of it, any driver, keyed by claim_key):
//   applied  taken in finalized pay runs (finalized means approved, not that the driver was paid)
//   paid     the part of that whose statement payout is recorded as paid
//   left     what is still owed for the current version (the payroll's own figure: eligible amount less what was really collected, drafts included)
// payout: 'paid' (all applied money has been paid out), 'partly_paid', or 'finalized' (approved runs only so far). state: none | partial | full.
export const deductionOf = ({ amount, appliedCents, paidCents, leftCents }) => {
  const applied = Number(appliedCents);
  const paid = Number(paidCents);
  const total = toCents(amount);
  const state = applied <= 0 ? 'none' : applied >= total ? 'full' : 'partial';
  return {
    state,
    applied: fromCents(applied),
    paid: fromCents(paid),
    left: leftCents === null || leftCents === undefined ? null : fromCents(Math.max(Number(leftCents), 0)),
    payout: applied <= 0 ? null : paid >= applied ? 'paid' : paid > 0 ? 'partly_paid' : 'finalized',
  };
};

// scope: { adminId } for an ordinary admin (only their assigned cities) or { all: true } for a super admin.
// Returns { claims, total, page, pageSize, totalPages, counts: { matched, unmatched } }. The counts follow the city and search, not the tab.
export const listClaims = async (db, scope, filters) => {
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  const where = ['c.superseded_at IS NULL'];
  if (!scope.all) where.push(`c.import_city_id IN (SELECT city_id FROM admin_city_ref WHERE admin_id = ${add(scope.adminId)})`);
  if (filters.cityId) where.push(`c.import_city_id = ${add(filters.cityId)}`);
  if (filters.search) {
    const like = add(`%${filters.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(c.waybill ILIKE ${like} OR c.claim_type ILIKE ${like} OR c.courier_name ILIKE ${like} OR d.name ILIKE ${like})`);
  }
  const joins = `FROM courier_claims c
    JOIN courier_claim_matches m ON m.claim_id = c.id
    JOIN city ci ON ci.id = c.import_city_id
    LEFT JOIN drivers d ON d.id = m.driver_id`;
  const from = `${joins} WHERE ${where.join(' AND ')}`;
  // The deduction history of the claim itself, by claim identity, so an amended claim keeps what was taken under an earlier version.
  const history = `LEFT JOIN LATERAL (
      SELECT (SUM(-l.amount) FILTER (WHERE r.status = 'finalized') * 100)::bigint AS applied_cents,
             (SUM(-l.amount) FILTER (WHERE r.status = 'finalized' AND s.payout_status = 'paid') * 100)::bigint AS paid_cents
        FROM courier_claims cv
        JOIN pay_statement_lines l ON l.claim_id = cv.id AND l.active AND l.line_type = 'claim'
        JOIN pay_statements s ON s.id = l.statement_id
        JOIN pay_runs r ON r.id = s.pay_run_id
       WHERE cv.claim_key = c.claim_key) h ON true`;
  const rowsFrom = `${joins} ${history} WHERE ${where.join(' AND ')}`;

  // Each query gets its own parameter list: the filters first, then its own values (a parameter a query does not use would have no type).
  const n = params.length;
  const { rows: [counted] } = await db.query(
    `SELECT count(*) FILTER (WHERE m.status = ANY($${n + 1}::text[]))::int AS matched,
            count(*) FILTER (WHERE m.status = ANY($${n + 2}::text[]))::int AS unmatched ${from}`, [...params, MATCHED, UNMATCHED]);
  const counts = { matched: counted.matched, unmatched: counted.unmatched };
  const total = counts[filters.tab];

  const { rows } = await db.query(
    `SELECT c.id, c.courier, c.waybill, c.claim_type, to_char(c.claim_at, 'YYYY-MM-DD') AS claim_date, c.deduction_amount::text AS amount,
            c.courier_name, ci.job AS city, m.status, m.reason, d.name AS driver_name, d.driver_code,
            COALESCE(h.applied_cents, 0)::bigint AS applied_cents, COALESCE(h.paid_cents, 0)::bigint AS paid_cents,
            CASE WHEN m.status = 'chargeable' THEN ((m.eligible_deduction - ${NET_COLLECTED_SQL('c')}) * 100)::bigint END AS left_cents
       ${rowsFrom} AND m.status = ANY($${n + 1}::text[])
      ORDER BY c.claim_at DESC, c.id DESC LIMIT $${n + 2} OFFSET $${n + 3}`,
    [...params, filters.tab === 'matched' ? MATCHED : UNMATCHED, PAGE_SIZE, (filters.page - 1) * PAGE_SIZE]);

  return {
    claims: rows.map((r) => ({
      id: Number(r.id), courier: r.courier, waybill: r.waybill, claimType: r.claim_type, claimDate: r.claim_date, amount: r.amount, city: r.city,
      status: r.status, reason: r.reason, courierName: r.courier_name, driverName: r.driver_name, driverCode: r.driver_code,
      deduction: deductionOf({ amount: r.amount, appliedCents: r.applied_cents, paidCents: r.paid_cents, leftCents: r.left_cents }),
    })),
    total, page: filters.page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE), counts,
  };
};
