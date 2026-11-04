// Records an admin's confirmation of an external payment. Never calls a bank or provider.
// Call inside a transaction. Frozen statements and immutable earning-line IDs define what is paid.
import { assertCityAllowed, PayrollError } from "./payRunStore.js";
import { lockCityPayroll } from "../claims/claimsStore.js";
import { blockersFor, reviewRunAsBatch } from "./payBatchReview.js";
import { fromCents, toCents } from "./payCalculator.js";
import { parseDate } from "../ledger/ledgerRules.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const paymentId = (v) =>
  /^\d{1,12}$/.test(String(v ?? "")) && Number(v) > 0 ? Number(v) : null;
export const parsePaymentRecord = (body = {}) => {
  const errors = {};
  const requestId =
    typeof body.requestId === "string" ? body.requestId.toLowerCase() : "";
  const paidOn = parseDate(body.paidOn);
  const reference =
    typeof body.reference === "string" ? body.reference.trim() : "";
  if (!UUID.test(requestId))
    errors.requestId = "Refresh the payment form and try again.";
  if (!paidOn) errors.paidOn = "Choose the date the drivers were paid.";
  if (!["bank_transfer", "cash", "other"].includes(body.method))
    errors.method = "Choose how the drivers were paid.";
  if (reference.length < 3 || reference.length > 200)
    errors.reference = "Add a payment reference or note (3–200 characters).";
  if (body.confirmed !== true)
    errors.confirmed =
      "Confirm that the selected drivers have received any amounts due.";
  let statementIds = null;
  if (body.statementIds !== undefined && body.statementIds !== null) {
    if (
      !Array.isArray(body.statementIds) ||
      body.statementIds.length === 0 ||
      body.statementIds.length > 2000 ||
      body.statementIds.some((v) => !paymentId(v))
    )
      errors.statementIds = "Choose valid statements from this run.";
    else
      statementIds = [...new Set(body.statementIds.map(Number))].sort(
        (a, b) => a - b,
      );
  }
  return Object.keys(errors).length
    ? { errors }
    : {
        request: {
          requestId,
          paidOn,
          method: body.method,
          reference,
          statementIds,
        },
      };
};

const receipt = async (db, id) => {
  const { rows } = await db.query(
    `SELECT p.id, p.pay_run_id, p.recorded_by, a.name AS recorded_by_name,
            to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.method, p.reference, p.created_at,
            count(i.statement_id)::int AS drivers, sum(i.amount)::text AS total
       FROM pay_run_payment_records p JOIN admin a ON a.id=p.recorded_by
       JOIN pay_run_payment_items i ON i.payment_record_id=p.id
      WHERE p.id=$1 GROUP BY p.id,a.name`,
    [id],
  );
  return rows[0];
};

export const approvedWork = async (db, ids, lock = false) =>
  (
    await db.query(
      `SELECT pd.id,pd.dashboard_data_id,pd.paid,pd.closed,pd.driver_payment::text AS gross,pd.insurance_deduction::text AS insurance,
          (pd.driver_id=s.driver_id AND dd.driver_id=pd.driver_id AND dd.route_id=pd.route_id AND dd.journey_date=pd.journey_date) AS same_work,
          l.statement_id,l.amount::text AS frozen_gross,
          COALESCE((SELECT -SUM(i.amount) FROM pay_statement_lines i WHERE i.statement_id=l.statement_id AND i.payment_dashboard_id=pd.id AND i.active AND i.line_type='insurance'),0)::text AS frozen_insurance
     FROM pay_statement_lines l JOIN payment_dashboard pd ON pd.id=l.payment_dashboard_id
     JOIN dashboard_data dd ON dd.id=pd.dashboard_data_id JOIN pay_statements s ON s.id=l.statement_id
    WHERE l.statement_id=ANY($1::bigint[]) AND l.active AND l.line_type='earning' ORDER BY pd.id ${lock ? "FOR UPDATE OF pd" : ""}`,
      [ids],
    )
  ).rows;
export const invalidWork = (statements, earnings) => {
  const byStatement = new Map();
  for (const row of earnings) {
    const key = String(row.statement_id);
    if (!byStatement.has(key)) byStatement.set(key, []);
    byStatement.get(key).push(row);
  }
  return new Set(
    statements
      .filter((s) => {
        const rows = byStatement.get(String(s.id)) ?? [];
        return (
          rows.length === 0 ||
          rows.length !== s.earning_lines ||
          rows.some(
            (e) =>
              !e.same_work ||
              !e.closed ||
              e.paid ||
              toCents(e.gross ?? "0") !== toCents(e.frozen_gross) ||
              toCents(e.insurance ?? "0") !== toCents(e.frozen_insurance),
          )
        );
      })
      .map((s) => String(s.id)),
  );
};
const priorRecord = async (db, requestId) =>
  (
    await db.query(
      "SELECT p.*,to_char(p.paid_on,'YYYY-MM-DD') AS paid_on FROM pay_run_payment_records p WHERE request_id=$1",
      [requestId],
    )
  ).rows[0];

export const recordRunPayment = async (db, admin, runId, request) => {
  const found = (
    await db.query("SELECT id,city_id FROM pay_runs WHERE id=$1", [runId])
  ).rows[0];
  if (!found) throw new PayrollError(404, "Pay run not found.");
  await assertCityAllowed(db, admin, found.city_id);
  const run = (
    await db.query(
      "SELECT id,city_id,status FROM pay_runs WHERE id=$1 FOR UPDATE",
      [runId],
    )
  ).rows[0];
  await lockCityPayroll(db, run.city_id);
  const prior = await priorRecord(db, request.requestId);
  const selection = request.statementIds ?? "all";
  const replay = async (row) => {
    if (
      String(row.pay_run_id) !== String(runId) ||
      row.recorded_by !== Number(admin.id) ||
      String(row.paid_on) !== request.paidOn ||
      row.method !== request.method ||
      row.reference !== request.reference ||
      JSON.stringify(row.selection) !== JSON.stringify(selection)
    )
      throw new PayrollError(
        409,
        "This confirmation was already used with different details. Reopen the form.",
      );
    return {
      receipt: await receipt(db, row.id),
      replay: true,
      driverNames: [],
    };
  };
  if (prior) return replay(prior);
  if (run.status !== "finalized")
    throw new PayrollError(
      409,
      "Approve this pay run before recording payments.",
    );
  const today = (
    await db.query("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS d")
  ).rows[0].d;
  if (request.paidOn > today)
    throw new PayrollError(400, "Payment date cannot be in the future.");
  const { rows: selected } = await db.query(
    `SELECT s.*,(SELECT count(*) FROM pay_statement_lines l WHERE l.statement_id=s.id AND l.active AND l.line_type='earning')::int AS earning_lines
       FROM pay_statements s WHERE s.pay_run_id=$1 AND ($2::bigint[] IS NULL OR s.id=ANY($2)) ORDER BY s.id FOR UPDATE`,
    [runId, request.statementIds],
  );
  if (request.statementIds && selected.length !== request.statementIds.length)
    throw new PayrollError(
      400,
      "Some selected drivers do not belong to this run. Refresh the list.",
    );
  const targets = selected.filter((s) => s.payout_status !== "paid");
  if (!targets.length)
    return { receipt: null, replay: false, alreadyPaid: true, driverNames: [] };
  if (
    targets.some((s) =>
      blockersFor({ statement: s, runStatus: run.status }).some(
        (b) => b.severity === "blocking",
      ),
    )
  )
    throw new PayrollError(
      409,
      "A selected payment is processing, unconfirmed or needs review. Resolve it before marking these drivers paid.",
    );
  const ids = targets.map((s) => s.id);
  // Lock source rows before derived pay rows, matching the upload's lock order.
  await db.query(
    `SELECT dd.id FROM dashboard_data dd WHERE dd.id IN (
    SELECT pd.dashboard_data_id FROM payment_dashboard pd JOIN pay_statement_lines l ON l.payment_dashboard_id=pd.id
     WHERE l.statement_id=ANY($1::bigint[]) AND l.active AND l.line_type='earning') ORDER BY dd.id FOR UPDATE`,
    [ids],
  );
  const earnings = await approvedWork(db, ids, true);
  if (invalidWork(targets, earnings).size)
    throw new PayrollError(
      409,
      "Some included earnings changed or are already marked paid. Review this run before recording payment.",
    );
  const inserted = (
    await db.query(
      `INSERT INTO pay_run_payment_records(request_id,pay_run_id,recorded_by,paid_on,method,reference,selection)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_id) DO NOTHING RETURNING id`,
      [
        request.requestId,
        runId,
        admin.id,
        request.paidOn,
        request.method,
        request.reference,
        JSON.stringify(selection),
      ],
    )
  ).rows[0];
  if (!inserted) return replay(await priorRecord(db, request.requestId));
  await db.query(
    `INSERT INTO pay_run_payment_items(payment_record_id,statement_id,amount)
    SELECT $1,id,net FROM pay_statements WHERE id=ANY($2::bigint[])`,
    [inserted.id, ids],
  );
  await db.query(
    "UPDATE dashboard_data SET paid=true WHERE id=ANY($1::int[])",
    [earnings.map((e) => e.dashboard_data_id).filter(Boolean)],
  );
  await db.query(
    "UPDATE payment_dashboard SET paid=true,payment_date=$2 WHERE id=ANY($1::int[])",
    [earnings.map((e) => e.id), request.paidOn],
  );
  await db.query(
    "UPDATE pay_statements SET payout_status='paid',payout_reference=$2,paid_at=now() WHERE id=ANY($1::bigint[])",
    [ids, request.reference],
  );
  const driverNames = (
    await db.query("SELECT name FROM drivers WHERE id=ANY($1::int[])", [
      targets.map((s) => s.driver_id),
    ])
  ).rows.map((r) => r.name);
  return {
    receipt: await receipt(db, inserted.id),
    replay: false,
    driverNames,
  };
};

// Bounded, city-scoped cards for the Dashboard. Delivery-date filters do not hide approved payments.
export const listPaymentRuns = async (
  db,
  admin,
  { view = "ready", cityId = null, beforeId = null } = {},
) => {
  if (cityId) await assertCityAllowed(db, admin, cityId);
  const { rows } = await db.query(
    `SELECT r.id,r.city_id,c.job AS city,r.data_type,to_char(r.period_start,'YYYY-MM-DD') AS period_start,
            to_char(r.period_end,'YYYY-MM-DD') AS period_end,count(*)::int AS drivers,
            count(*) FILTER(WHERE s.payout_status='paid')::int AS paid,
            count(*) FILTER(WHERE s.payout_status IN ('submitted','unconfirmed'))::int AS processing,
            COALESCE(sum(s.net) FILTER(WHERE s.payout_status<>'paid'),0)::text AS remaining,
            sum(s.net)::text AS total
       FROM pay_runs r JOIN city c ON c.id=r.city_id JOIN pay_statements s ON s.pay_run_id=r.id
      WHERE r.status='finalized' AND ($1::int IS NULL OR r.city_id=$1)
        AND ($2::boolean OR EXISTS(SELECT 1 FROM admin_city_ref a WHERE a.admin_id=$3 AND a.city_id=r.city_id))
        AND ($4::bigint IS NULL OR r.id<$4) GROUP BY r.id,c.job
      HAVING CASE WHEN $5='history' THEN count(*) FILTER(WHERE s.payout_status='paid')>0
                  ELSE count(*) FILTER(WHERE s.payout_status<>'paid')>0 END
      ORDER BY r.id DESC LIMIT 11`,
    [cityId, admin?.role === "superadmin", admin?.id, beforeId, view],
  );
  return {
    runs: rows.slice(0, 10),
    nextBeforeId: rows.length > 10 ? rows[9].id : null,
  };
};

export const reviewRunPayments = async (db, admin, runId) => {
  const review = await reviewRunAsBatch(db, admin, runId);
  const history = (
    await db.query(
      `SELECT i.statement_id,p.id,to_char(p.paid_on,'YYYY-MM-DD') AS paid_on,p.method,p.reference,p.created_at,a.name AS recorded_by_name
       FROM pay_run_payment_records p JOIN pay_run_payment_items i ON i.payment_record_id=p.id
       JOIN admin a ON a.id=p.recorded_by WHERE p.pay_run_id=$1 ORDER BY p.id`,
      [runId],
    )
  ).rows;
  // A legacy mark must be reconciled, never silently treated as a fresh payment confirmation.
  const unpaid = (
    await db.query(
      `SELECT s.id,count(l.id)::int AS earning_lines FROM pay_statements s
    LEFT JOIN pay_statement_lines l ON l.statement_id=s.id AND l.active AND l.line_type='earning'
    WHERE s.pay_run_id=$1 AND s.payout_status<>'paid' GROUP BY s.id`,
      [runId],
    )
  ).rows;
  const changed = invalidWork(
    unpaid,
    await approvedWork(
      db,
      unpaid.map((s) => s.id),
    ),
  );
  const drivers = review.drivers.map((d) => ({
    ...d,
    ...(changed.has(String(d.statementId))
      ? {
          eligible: false,
          blockers: [
            ...d.blockers,
            {
              code: "earnings_changed",
              severity: "blocking",
              message:
                "Included earnings changed or are already marked paid. Review payment history before continuing.",
            },
          ],
        }
      : {}),
    payment:
      history.find((p) => String(p.statement_id) === String(d.statementId)) ??
      null,
  }));
  const eligible = drivers.filter((d) => d.eligible);
  const eligibleTotals = Object.fromEntries(
    Object.keys(review.summary.eligibleTotals).map((key) => [
      key,
      fromCents(eligible.reduce((n, d) => n + toCents(d.amounts[key]), 0)),
    ]),
  );
  return {
    ...review,
    drivers,
    summary: {
      ...review.summary,
      eligible: eligible.length,
      blocked: drivers.length - eligible.length,
      eligibleTotals,
    },
  };
};
