// A driver's own Everee transfers (issue #242, PR D1): what NASA sent to Everee for this driver and where each one stands, from NASA's own records.
// It is a read, scoped to the driver in the token, and it never asks Everee anything. It shows only what NASA verified itself:
//  - "completed" only when NASA marked the payment paid, which happens only when Everee's payout records say PAID, or Everee's payment itself is PAID
//    with no failed payout (never from a screen event; see paymentState.countsAsLanded);
//  - "pending" while the payment is with Everee and not settled; "unconfirmed" and "failed" are kept apart from it; "returned" is a deposit a bank sent back.
// Amounts are exact decimal strings. These are TRANSFERS: they are not new earnings and not extra money. They pay the approved statement they point to, and
// cash receipts are not listed here.

import { readEvereeConfig } from './evereeConfig.js';

export const MAX_TRANSFERS = 50;

export const TRANSFER_STATUSES = Object.freeze(['pending', 'unconfirmed', 'failed', 'returned', 'completed']);

// Pure. item: an everee_payment_items row.
export const transferStatusOf = (item) => {
  if (item.deposit_returned) return 'returned';
  if (item.status === 'paid') return 'completed';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'unconfirmed') return 'unconfirmed';
  return 'pending';
};

export const listOwnTransfers = async (db, driverId, { env = process.env } = {}) => {
  const { environment } = readEvereeConfig(env);
  const { rows } = await db.query(
    `SELECT i.id, i.pay_statement_id, i.amount::text AS amount, i.status, i.deposit_returned, i.last_checked_at, i.paid_at, i.created_at,
            to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end
       FROM everee_payment_items i
       JOIN everee_payment_batches b ON b.id = i.batch_id
       JOIN pay_statements s ON s.id = i.pay_statement_id
       JOIN pay_runs r ON r.id = s.pay_run_id
      WHERE i.driver_id = $1 AND b.environment = $3
      ORDER BY i.id DESC
      LIMIT $2`, [driverId, MAX_TRANSFERS, environment]);
  const transfers = rows.map((row) => ({
    id: row.id,
    statementId: row.pay_statement_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    amount: row.amount,
    status: transferStatusOf(row),
    sentAt: row.created_at,
    lastCheckedAt: row.last_checked_at,
    paidAt: row.status === 'paid' && !row.deposit_returned ? row.paid_at : null,
  }));
  const checked = transfers.map((t) => t.lastCheckedAt).filter(Boolean).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return { transfers, lastCheckedAt: checked.length > 0 ? checked[checked.length - 1] : null };
};
