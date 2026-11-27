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
//   applied   taken in finalized pay runs, as history (finalized means approved, not that the driver was paid); never reduced by a refund
//   paid      the part of that whose statement payout is recorded as paid
//   refunded  given back by approved corrections whose payout is paid (the payroll's own netting: gross taken less what is still collected)
//   left      what is still owed for the current version (the payroll's own figure: eligible amount less what was really collected, drafts included)
// payout: 'paid' (all applied money has been paid out), 'partly_paid', or 'finalized' (approved runs only so far).
// state: none | partial | full | refunded, judged on what stands after refunds (applied less refunded): a fully refunded claim is not "deducted".
export const deductionOf = ({ amount, appliedCents, paidCents, grossCents = appliedCents, collectedCents = grossCents, leftCents }) => {
  const applied = Number(appliedCents);
  const paid = Number(paidCents);
  const refunded = Math.max(Number(grossCents) - Number(collectedCents), 0);
  const standing = Math.max(applied - refunded, 0);
  const total = toCents(amount);
  const state = applied <= 0 ? 'none' : standing >= total ? 'full' : standing > 0 ? 'partial' : 'refunded';
  return {
    state,
    applied: fromCents(applied),
    paid: fromCents(paid),
    refunded: fromCents(refunded),
    left: leftCents === null || leftCents === undefined ? null : fromCents(Math.max(Number(leftCents), 0)),
    payout: applied <= 0 ? null : paid >= applied ? 'paid' : paid > 0 ? 'partly_paid' : 'finalized',
  };
};

// What a hand-entered claim (a "manual claim" in a driver's ledger, #142) has had taken off pay: its recovery lines. applied and paid follow the
// carrier claims' meaning (finalized runs; paid out); left is what the payroll still has to recover (drafts and repayments outside payroll counted).
const MANUAL_HISTORY = `LEFT JOIN LATERAL (
      SELECT (COALESCE(SUM(-l.amount) FILTER (WHERE r.status = 'finalized'), 0) * 100)::bigint AS applied_cents,
             (COALESCE(SUM(-l.amount) FILTER (WHERE r.status = 'finalized' AND s.payout_status = 'paid'), 0) * 100)::bigint AS paid_cents,
             (COALESCE(SUM(-l.amount), 0) * 100)::bigint AS taken_cents
        FROM pay_statement_lines l
        JOIN pay_statements s ON s.id = l.statement_id
        JOIN pay_runs r ON r.id = s.pay_run_id
       WHERE l.ledger_entry_id = e.id AND l.active AND l.line_type = 'recovery') h ON true
    LEFT JOIN LATERAL (
      SELECT (COALESCE(SUM(CASE WHEN st.kind = 'reversal' THEN -st.amount ELSE st.amount END), 0) * 100)::bigint AS settled_cents
        FROM driver_ledger_settlements st WHERE st.entry_id = e.id) settled ON true`;

// scope: { adminId } for an ordinary admin (only their assigned cities) or { all: true } for a super admin.
// Returns { claims, total, page, pageSize, totalPages, counts: { matched, unmatched } }. The counts follow the city and search, not the tab.
// Two kinds of claim are listed: the carrier's (source 'file', from the weekly upload) and the ones an admin entered by hand in a driver's ledger
// (source 'manual', for daily cities above all, which have no carrier file). A hand-entered claim already names its driver, so it is always matched:
// chargeable, or exempt when it was entered as exempt. A voided one is not listed.
export const listClaims = async (db, scope, filters) => {
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  const fileWhere = ['c.superseded_at IS NULL'];
  const manualWhere = [`e.entry_type = 'manual_claim'`, 'NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)'];
  if (!scope.all) {
    const admin = add(scope.adminId);
    fileWhere.push(`c.import_city_id IN (SELECT city_id FROM admin_city_ref WHERE admin_id = ${admin})`);
    manualWhere.push(`e.city_id IN (SELECT city_id FROM admin_city_ref WHERE admin_id = ${admin})`);
  }
  if (filters.cityId) {
    const city = add(filters.cityId);
    fileWhere.push(`c.import_city_id = ${city}`);
    manualWhere.push(`e.city_id = ${city}`);
  }
  if (filters.search) {
    const like = add(`%${filters.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    fileWhere.push(`(c.waybill ILIKE ${like} OR c.claim_type ILIKE ${like} OR c.courier_name ILIKE ${like} OR d.name ILIKE ${like})`);
    manualWhere.push(`(e.waybill ILIKE ${like} OR e.claim_type ILIKE ${like} OR d.name ILIKE ${like})`);
  }
  const fileJoins = `FROM courier_claims c
    JOIN courier_claim_matches m ON m.claim_id = c.id
    JOIN city ci ON ci.id = c.import_city_id
    LEFT JOIN drivers d ON d.id = m.driver_id`;
  const manualJoins = `FROM driver_ledger_entries e
    JOIN city ci ON ci.id = e.city_id
    JOIN drivers d ON d.id = e.driver_id`;
  // The deduction history of the claim itself, by claim identity, so an amended claim keeps what was taken under an earlier version.
  const history = `LEFT JOIN LATERAL (
      SELECT (SUM(-l.amount) FILTER (WHERE r.status = 'finalized') * 100)::bigint AS applied_cents,
             (SUM(-l.amount) FILTER (WHERE r.status = 'finalized' AND s.payout_status = 'paid') * 100)::bigint AS paid_cents,
             (SUM(-l.amount) * 100)::bigint AS gross_cents
        FROM courier_claims cv
        JOIN pay_statement_lines l ON l.claim_id = cv.id AND l.active AND l.line_type = 'claim'
        JOIN pay_statements s ON s.id = l.statement_id
        JOIN pay_runs r ON r.id = s.pay_run_id
       WHERE cv.claim_key = c.claim_key) h ON true`;

  // Each query gets its own parameter list: the filters first, then its own values (a parameter a query does not use would have no type).
  const n = params.length;
  const { rows: [counted] } = await db.query(
    `SELECT (SELECT count(*) FILTER (WHERE m.status = ANY($${n + 1}::text[])) ${fileJoins} WHERE ${fileWhere.join(' AND ')})::int
              + (SELECT count(*) ${manualJoins} WHERE ${manualWhere.join(' AND ')})::int AS matched,
            (SELECT count(*) FILTER (WHERE m.status = ANY($${n + 2}::text[])) ${fileJoins} WHERE ${fileWhere.join(' AND ')})::int AS unmatched`,
    [...params, MATCHED, UNMATCHED]);
  const counts = { matched: counted.matched, unmatched: counted.unmatched };
  const total = counts[filters.tab];

  const fileRows = `SELECT 'file' AS source, c.id, c.courier, c.waybill, c.claim_type, c.claim_at AS sort_at, to_char(c.claim_at, 'YYYY-MM-DD') AS claim_date,
            c.deduction_amount::text AS amount, c.courier_name, ci.job AS city, m.status, m.reason, d.name AS driver_name, d.driver_code,
            COALESCE(h.applied_cents, 0)::bigint AS applied_cents, COALESCE(h.paid_cents, 0)::bigint AS paid_cents,
            COALESCE(h.gross_cents, 0)::bigint AS gross_cents, (${NET_COLLECTED_SQL('c')} * 100)::bigint AS collected_cents,
            CASE WHEN m.status = 'chargeable' THEN ((m.eligible_deduction - ${NET_COLLECTED_SQL('c')}) * 100)::bigint END AS left_cents
       ${fileJoins} ${history} WHERE ${fileWhere.join(' AND ')} AND m.status = ANY($${n + 1}::text[])`;
  const manualRows = `SELECT 'manual' AS source, e.id, e.claim_courier, e.waybill, e.claim_type, e.effective_date::timestamp AS sort_at,
            to_char(e.effective_date, 'YYYY-MM-DD') AS claim_date, e.amount::text AS amount, NULL::text AS courier_name, ci.job AS city,
            CASE WHEN e.exempt THEN 'exempt' ELSE 'chargeable' END AS status, e.reason, d.name AS driver_name, d.driver_code,
            h.applied_cents, h.paid_cents, h.taken_cents AS gross_cents, h.taken_cents AS collected_cents,
            CASE WHEN e.exempt THEN NULL ELSE (e.amount * 100)::bigint - h.taken_cents - settled.settled_cents END AS left_cents
       ${manualJoins} ${MANUAL_HISTORY} WHERE ${manualWhere.join(' AND ')}`;
  const { rows } = await db.query(
    `SELECT * FROM (${fileRows}${filters.tab === 'matched' ? ` UNION ALL ${manualRows}` : ''}) u
      ORDER BY u.sort_at DESC, u.source, u.id DESC LIMIT $${n + 2} OFFSET $${n + 3}`,
    [...params, filters.tab === 'matched' ? MATCHED : UNMATCHED, PAGE_SIZE, (filters.page - 1) * PAGE_SIZE]);

  return {
    claims: rows.map((r) => ({
      id: Number(r.id), source: r.source, courier: r.courier, waybill: r.waybill, claimType: r.claim_type, claimDate: r.claim_date, amount: r.amount,
      city: r.city, status: r.status, reason: r.reason, courierName: r.courier_name, driverName: r.driver_name, driverCode: r.driver_code,
      deduction: deductionOf({ amount: r.amount, appliedCents: r.applied_cents, paidCents: r.paid_cents, grossCents: r.gross_cents, collectedCents: r.collected_cents, leftCents: r.left_cents }),
    })),
    total, page: filters.page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE), counts,
  };
};
