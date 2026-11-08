import { centsToText } from './statementMoney.js';

// The database side of carrier statements (issue #252). Every function takes the caller's `db` (a pool or a client in an open transaction)
// and uses parameters only. Statement rows are append-only evidence; see the migration for the triggers that enforce it.

const WEEKLY_ROW = '(pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0)';
const CHUNK = 5000;

const chunks = (list, size = CHUNK) => {
  const parts = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
};

// route code -> { routeId, cityId, cityCode, cityName } for the codes that exist (deleted routes included: history stays matchable).
export const loadRoutes = async (db, routeCodes) => {
  const { rows } = await db.query(
    `SELECT r.id, r.route_code_in_string AS code, c.id AS city_id, c.city_code, c.job AS city_name
       FROM routes r JOIN city c ON c.job = r.job
      WHERE r.route_code_in_string = ANY($1::text[])`,
    [routeCodes]
  );
  return new Map(rows.map((r) => [r.code, { routeId: r.id, cityId: r.city_id, cityCode: r.city_code, cityName: r.city_name }]));
};

// Delivery ID (text) -> driver id, for the drivers whose code is one of the statement's Delivery IDs.
export const loadDrivers = async (db, deliveryIds) => {
  const { rows } = await db.query('SELECT id, driver_code::text AS code FROM drivers WHERE driver_code::text = ANY($1::text[])', [deliveryIds]);
  return new Map(rows.map((r) => [r.code, r.id]));
};

// NASA's recorded weekly work for one city between two dates: the driver earnings are the stored ones, never recalculated.
export const loadNasaRows = async (db, { cityId, from, to }) => {
  const { rows } = await db.query(
    `SELECT pd.id, pd.driver_id, d.driver_code::text AS driver_code, to_char(pd.journey_date, 'YYYY-MM-DD') AS day,
            r.id AS route_id, r.route_code_in_string AS route_code, COALESCE(pd.delivered, 0) AS delivered,
            (COALESCE(pd.driver_payment, 0) * 100)::bigint AS driver_cents
       FROM payment_dashboard pd
       JOIN drivers d ON d.id = pd.driver_id
       JOIN routes r ON r.id = pd.route_id
       JOIN city c ON c.job = r.job
      WHERE c.id = $1 AND pd.journey_date BETWEEN $2::date AND $3::date AND ${WEEKLY_ROW}`,
    [cityId, from, to]
  );
  return rows.map((r) => ({ id: r.id, driverId: r.driver_id, driverCode: r.driver_code, day: r.day, routeId: r.route_id, routeCode: r.route_code, delivered: Number(r.delivered), driverCents: Number(r.driver_cents) }));
};

// Statements of one city and billing week (the verified city, never the fleet's spelling), newest version first, locked so two uploads of the same week run one after another.
export const lockWeek = async (db, { carrier, cityId, periodStart }) => {
  const { rows } = await db.query(
    `SELECT id, version, status, fingerprint, bill_number FROM carrier_statements
      WHERE carrier = $1 AND city_id = $2 AND period_start = $3::date ORDER BY version DESC FOR UPDATE`,
    [carrier, cityId, periodStart]
  );
  return rows;
};

export const markSuperseded = (db, id) => db.query("UPDATE carrier_statements SET status = 'superseded', superseded_at = now() WHERE id = $1 AND status = 'published'", [id]);

export const addEvent = (db, statementId, event, actorId, detail = null) =>
  db.query('INSERT INTO carrier_statement_events (statement_id, event, actor_id, detail) VALUES ($1, $2, $3, $4)', [statementId, event, actorId ?? null, detail]);

export const insertStatement = async (db, s) => {
  const { rows } = await db.query(
    `INSERT INTO carrier_statements
       (carrier, fleet, city_id, period_start, period_end, billing_week, bill_number, currency, fingerprint, version, status, origin,
        detail_fee_cents, offset_cents, claims_cents, adjustments_cents, settlement_payable_cents, prepaid_cents, withdrawal_fee_cents,
        detail_lines, offset_lines, carrier_deliveries, source_label, imported_by, supersedes_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING id`,
    [s.carrier, s.fleet, s.cityId, s.periodStart, s.periodEnd, s.billingWeek, s.billNumber, s.currency, s.fingerprint, s.version, s.origin,
      s.detailFeeCents, s.offsetCents, s.claimsCents, s.adjustmentsCents, s.settlementPayableCents, s.prepaidCents, s.withdrawalFeeCents,
      s.detailLines, s.offsetLines, s.carrierDeliveries ?? null, s.sourceLabel, s.importedBy ?? null, s.supersedesId ?? null]
  );
  return rows[0].id;
};

export const insertLines = async (db, statementId, kind, lines) => {
  for (const part of chunks(lines)) {
    await db.query(
      `INSERT INTO carrier_statement_lines (statement_id, kind, source_row, waybill, delivery_id, route_code, signed_on, fee_cents)
       SELECT $1, $2, t.source_row, t.waybill, t.delivery_id, NULLIF(t.route_code, ''), t.signed_on, t.fee_cents
         FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::date[], $8::bigint[]) AS t(source_row, waybill, delivery_id, route_code, signed_on, fee_cents)`,
      [statementId, kind, part.map((l) => l.ref.row), part.map((l) => l.waybill ?? ''), part.map((l) => l.deliveryId), part.map((l) => l.route ?? ''), part.map((l) => l.signedOn), part.map((l) => l.feeCents)]
    );
  }
};

export const insertItems = async (db, statementId, kind, items) => {
  if (items.length === 0) return;
  await db.query(
    `INSERT INTO carrier_statement_items (statement_id, kind, source_row, delivery_id, on_day, amount_cents, label)
     SELECT $1, $2, t.source_row, NULLIF(t.delivery_id, ''), t.on_day, t.amount_cents, NULLIF(t.label, '')
       FROM unnest($3::int[], $4::text[], $5::date[], $6::bigint[], $7::text[]) AS t(source_row, delivery_id, on_day, amount_cents, label)`,
    [statementId, kind, items.map((i) => i.ref.row), items.map((i) => i.deliveryId ?? i.courierId ?? ''), items.map((i) => i.onDay ?? null), items.map((i) => i.amountCents), items.map((i) => i.label ?? '')]
  );
};

// The matched groups of a statement point at NASA's pay rows by plain id (no foreign key), so the rows are LOCKED here until the transaction ends and checked once
// more: each must still exist with the same driver, route and day. Without this, a journey moved or deleted between matching and commit could leave a published
// statement pointing at work that is no longer there. Returns true when every matched group's row is held and unchanged; the caller rolls back otherwise.
export const holdMatchedWork = async (db, statementId) => {
  const { rows } = await db.query(
    `WITH held AS (
       SELECT g.delivery_id
         FROM carrier_statement_groups g
         JOIN payment_dashboard pd ON pd.id = g.payment_dashboard_id AND pd.driver_id = g.driver_id AND pd.route_id = g.route_id AND pd.journey_date = g.signed_on
        WHERE g.statement_id = $1 AND g.match_state = 'matched'
          FOR SHARE OF pd
     )
     SELECT (SELECT count(*) FROM carrier_statement_groups WHERE statement_id = $1 AND match_state = 'matched')::int AS expected, (SELECT count(*) FROM held)::int AS held`,
    [statementId]
  );
  return rows[0].expected === rows[0].held;
};

export const insertGroups = async (db, statementId, groups) => {
  for (const part of chunks(groups)) {
    await db.query(
      `INSERT INTO carrier_statement_groups
         (statement_id, delivery_id, signed_on, route_code, fee_cents, fee_lines, offset_lines, match_state, route_id, driver_id, payment_dashboard_id, nasa_driver_cents, matched_at)
       SELECT $1, t.delivery_id, t.signed_on, t.route_code, t.fee_cents, t.fee_lines, t.offset_lines, t.match_state, t.route_id, t.driver_id, t.pd_id, t.nasa_cents,
              CASE WHEN t.match_state = 'matched' THEN now() END
         FROM unnest($2::text[], $3::date[], $4::text[], $5::bigint[], $6::int[], $7::int[], $8::text[], $9::int[], $10::int[], $11::int[], $12::bigint[])
              AS t(delivery_id, signed_on, route_code, fee_cents, fee_lines, offset_lines, match_state, route_id, driver_id, pd_id, nasa_cents)`,
      [statementId, part.map((g) => g.deliveryId), part.map((g) => g.signedOn), part.map((g) => g.routeCode), part.map((g) => g.feeCents), part.map((g) => g.feeLines),
        part.map((g) => g.offsetLines), part.map((g) => g.matchState), part.map((g) => g.routeId), part.map((g) => g.driverId), part.map((g) => g.paymentDashboardId), part.map((g) => g.nasaDriverCents)]
    );
  }
};

export const loadStatement = async (db, id) => {
  const { rows } = await db.query(
    `SELECT s.*, t.matched_cents, t.unallocated_cents, t.unallocated_groups, c.job AS city_name
       FROM carrier_statements s JOIN carrier_statement_totals t ON t.statement_id = s.id JOIN city c ON c.id = s.city_id WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
};

// Runs `work(client)` as one unit: everything it writes commits together or not at all. `db` is a pool (a transaction of its own is opened) or a client that
// is already inside a transaction (a savepoint is used, so the caller's transaction decides in the end).
let savepoints = 0;
export const inTransaction = async (db, work) => {
  if (typeof db.release === 'function') {
    const name = `statement_work_${(savepoints += 1)}`;
    await db.query(`SAVEPOINT ${name}`);
    try {
      const result = await work(db);
      await db.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
      throw error;
    }
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// The status change and its audit event are one transaction: a failed event leaves the statement published, and a void is never without its event.
export const voidStatement = (db, id, { actorId, reason }) => inTransaction(db, async (tx) => {
  const { rowCount } = await tx.query(
    "UPDATE carrier_statements SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1 AND status = 'published'",
    [id, actorId ?? null, reason]
  );
  if (rowCount !== 1) return false;
  await addEvent(tx, id, 'voided', actorId, reason);
  return true;
});

// Re-matches one published statement and records who did it, in one transaction. The statement row is locked first, so a void or another re-match cannot
// run in between. Returns null when the statement is not published, otherwise how many groups were matched.
export class StatementWorkChanged extends Error {
  constructor() { super('A journey changed while the statement was being matched. Nothing was changed. Try again.'); this.name = 'StatementWorkChanged'; }
}

export const rematchStatement = (db, id, { actorId }) => inTransaction(db, async (tx) => {
  const { rows } = await tx.query('SELECT status FROM carrier_statements WHERE id = $1 FOR UPDATE', [id]);
  if (rows[0]?.status !== 'published') return null;
  const matched = await rematchOpenGroups(tx, { statementId: id });
  // The newly matched pay rows are held and re-checked, as in publishing, so work that changed meanwhile cannot be attached (the whole re-match is undone).
  if (matched > 0 && !(await holdMatchedWork(tx, id))) throw new StatementWorkChanged();
  if (matched > 0) await addEvent(tx, id, 'rematched', actorId, `${matched} group${matched === 1 ? '' : 's'} matched`);
  return matched;
});

// The list the owner sees: newest week first, with matched and unallocated revenue.
export const listStatements = async (db, { limit = 50 } = {}) => {
  const { rows } = await db.query(
    `SELECT s.id, s.fleet, s.city_id, c.job AS city_name, to_char(s.period_start, 'YYYY-MM-DD') AS period_start, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
            s.billing_week, s.bill_number, s.version, s.status, s.origin, s.settlement_payable_cents, s.detail_fee_cents, s.offset_cents, s.claims_cents, s.adjustments_cents,
            s.imported_at, s.voided_at, s.void_reason, t.matched_cents, t.unallocated_cents, t.unallocated_groups
       FROM carrier_statements s JOIN carrier_statement_totals t ON t.statement_id = s.id JOIN city c ON c.id = s.city_id
      ORDER BY s.period_start DESC, s.version DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id, fleet: r.fleet, cityId: r.city_id, city: r.city_name, periodStart: r.period_start, periodEnd: r.period_end, billingWeek: r.billing_week, billNumber: r.bill_number,
    version: r.version, status: r.status, origin: r.origin, importedAt: r.imported_at, voidedAt: r.voided_at, voidReason: r.void_reason,
    deliveryRevenue: centsToText(Number(r.detail_fee_cents) + Number(r.offset_cents)), claims: centsToText(Number(r.claims_cents)), adjustments: centsToText(Number(r.adjustments_cents)),
    settlementPayable: centsToText(Number(r.settlement_payable_cents)), matchedRevenue: centsToText(Number(r.matched_cents)), unallocatedRevenue: centsToText(Number(r.unallocated_cents)),
    unallocatedGroups: r.unallocated_groups,
  }));
};

// Matches groups that were left unmatched when NASA has since recorded the work (or the driver or route was added). Matching only ever
// moves a group from unmatched to matched, so this is safe to run any time and as often as wanted. Returns how many groups it matched.
export const rematchOpenGroups = async (db, { statementId = null, cityId = null } = {}) => {
  const { rows } = await db.query(
    `WITH open_groups AS (
       SELECT g.statement_id, g.delivery_id, g.signed_on, g.route_code, s.city_id
         FROM carrier_statement_groups g JOIN carrier_statements s ON s.id = g.statement_id
        WHERE g.match_state <> 'matched' AND g.route_code <> '' AND s.status = 'published'
          AND ($1::bigint IS NULL OR g.statement_id = $1) AND ($2::int IS NULL OR s.city_id = $2)
     ), found AS (
       SELECT og.statement_id, og.delivery_id, og.signed_on, og.route_code, d.id AS driver_id, r.id AS route_id,
              min(pd.id) AS anchor_id, (sum(COALESCE(pd.driver_payment, 0)) * 100)::bigint AS driver_cents
         FROM open_groups og
         JOIN drivers d ON d.driver_code::text = og.delivery_id
         JOIN routes r ON r.route_code_in_string = og.route_code
         JOIN city c ON c.job = r.job AND c.id = og.city_id
         JOIN payment_dashboard pd ON pd.driver_id = d.id AND pd.route_id = r.id AND pd.journey_date = og.signed_on AND ${WEEKLY_ROW}
        GROUP BY og.statement_id, og.delivery_id, og.signed_on, og.route_code, d.id, r.id
     )
     UPDATE carrier_statement_groups g
        SET match_state = 'matched', driver_id = f.driver_id, route_id = f.route_id, payment_dashboard_id = f.anchor_id, nasa_driver_cents = f.driver_cents, matched_at = now()
       FROM found f
      WHERE g.statement_id = f.statement_id AND g.delivery_id = f.delivery_id AND g.signed_on = f.signed_on AND g.route_code = f.route_code
        AND NOT EXISTS (SELECT 1 FROM carrier_statement_groups x WHERE x.payment_dashboard_id = f.anchor_id AND x.statement_id = f.statement_id)
     RETURNING g.statement_id`,
    [statementId, cityId]
  );
  return rows.length;
};

const REASON = Object.freeze({
  no_route: 'The carrier gave no route',
  unknown_route: 'The route is not set up in NASA',
  unknown_driver: 'No NASA driver has this Delivery ID',
  no_pay_group: 'NASA has no recorded work for this driver, day and route',
});

// The unmatched money of one statement, largest first, so the owner can see what is unallocated and why.
export const listUnallocated = async (db, statementId, { limit = 200 } = {}) => {
  const { rows } = await db.query(
    `SELECT g.delivery_id, to_char(g.signed_on, 'YYYY-MM-DD') AS day, g.route_code, g.match_state, g.fee_cents, g.fee_lines, g.offset_lines
       FROM carrier_statement_groups g
      WHERE g.statement_id = $1 AND g.match_state <> 'matched'
      ORDER BY abs(g.fee_cents) DESC, g.signed_on, g.delivery_id, g.route_code LIMIT $2`,
    [statementId, limit]
  );
  return rows.map((r) => ({ deliveryId: r.delivery_id, day: r.day, route: r.route_code || null, state: r.match_state, reason: REASON[r.match_state], revenue: centsToText(Number(r.fee_cents)), lines: r.fee_lines, offsets: r.offset_lines }));
};
