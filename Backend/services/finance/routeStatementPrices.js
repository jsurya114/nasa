import { centsToText } from './gofoStatement/statementMoney.js';

// What the carrier paid per delivery on each weekly GOFO route, taken from the city's latest published statement (issue #252). The statement is the weekly workbook uploaded
// under File Upload, so the Routes page follows each weekly upload by itself. Display only: the route's stored company price is not changed, so pay and estimates stay as they are.
// Fee lines only; offsets and claims are not part of a per-delivery price. Owner-only data: callers must not pass it to a city admin.
const UNDEFINED_TABLE = '42P01';

export const routeStatementPrices = async (db, routeIds) => {
  if (!Array.isArray(routeIds) || routeIds.length === 0) return new Map();
  try {
    const { rows } = await db.query(
      `SELECT r.id AS route_id, latest.billing_week, SUM(cl.fee_cents)::bigint AS cents, COUNT(*)::int AS deliveries
         FROM routes r
         JOIN city c ON c.job = r.job AND c.city_type = 'WEEKLY'
         JOIN LATERAL (SELECT s.id, s.billing_week FROM carrier_statements s
                        WHERE s.city_id = c.id AND s.status = 'published'
                        ORDER BY s.period_start DESC, s.version DESC LIMIT 1) latest ON TRUE
         JOIN carrier_statement_lines cl ON cl.statement_id = latest.id AND cl.kind = 'fee' AND cl.route_code = r.route_code_in_string
        WHERE r.id = ANY($1::int[])
        GROUP BY r.id, latest.billing_week`,
      [routeIds],
    );
    return new Map(rows.map((row) => [row.route_id, {
      perDelivery: centsToText(Math.round(Number(row.cents) / row.deliveries)),
      deliveries: row.deliveries,
      week: row.billing_week,
    }]));
  } catch (error) {
    if (error.code === UNDEFINED_TABLE) return new Map();
    throw error;
  }
};
