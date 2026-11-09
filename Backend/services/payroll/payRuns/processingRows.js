import logger from '../../../utils/logger.js';

// Marks the Dashboard's pay rows whose payment has been sent to Everee and is not confirmed yet (issue #31). The table's own Paid column says
// "Yes" only once the money is confirmed (the statement is paid and the row is marked paid); between pressing Pay and Everee's confirmation the row
// is neither paid nor payable again, so it gets `payout_state: 'processing'` and the table can say "Submitted". Nothing here changes any row, any
// amount or the table's query: it only adds a field to rows already chosen, and only for finalized runs whose statement is submitted or unconfirmed.
// A row that is already paid is never marked. If the payroll tables are not there yet (an older database), the rows are returned as they were.
const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';

export const markProcessingRows = async (db, rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = [...new Set(rows.filter((r) => r && !r.paid && Number.isInteger(Number(r.id))).map((r) => Number(r.id)))];
  if (ids.length === 0) return rows;
  let processing;
  try {
    const { rows: found } = await db.query(
      `SELECT DISTINCT l.payment_dashboard_id AS id
         FROM pay_statement_lines l JOIN pay_statements s ON s.id = l.statement_id JOIN pay_runs r ON r.id = s.pay_run_id
        WHERE l.active AND l.line_type = 'earning' AND l.payment_dashboard_id = ANY($1::int[])
          AND r.status = 'finalized' AND s.payout_status IN ('submitted', 'unconfirmed')`,
      [ids]
    );
    processing = new Set(found.map((r) => Number(r.id)));
  } catch (error) {
    if (error.code === UNDEFINED_TABLE || error.code === UNDEFINED_COLUMN) return rows;
    logger.warn('Pay rows could not be checked for payments in progress', { code: error.code });
    return rows;
  }
  return rows.map((r) => (r && processing.has(Number(r.id)) ? { ...r, payout_state: 'processing' } : r));
};
