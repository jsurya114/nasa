// Invoice payments received, for Insights: the saved totals of invoices marked "Payment received", counted once per invoice by the date the payment was
// received. Pending invoices add nothing. Company-wide: an invoice is not tied to a city or a delivery source, and no city is guessed from a vendor's
// address. Kept apart from delivery revenue, which may already include the same work (carrier statements or stored delivery figures).
import { centsToText, toCents } from './inputs.js';

const MONEY = 'numeric(16,2)';

// Returns { amount, invoices, scope, basis }, or null when the view is missing (the invoices migration has not been run) or the reporting role cannot
// read it (the grant is missing): the rest of the Insights overview still loads, without this one card.
export const invoicePaymentsFor = async (db, { startDate, endDate }) => {
  const { rows: [ready] } = await db.query("SELECT COALESCE(has_table_privilege(to_regclass('reporting.invoice_payments'), 'SELECT'), false) AS ok");
  if (!ready.ok) return null;
  const { rows: [r] } = await db.query(
    `SELECT (count(*))::int AS invoices, (COALESCE(sum(p.total), 0))::${MONEY} AS amount
       FROM reporting.invoice_payments p
      WHERE p.payment_received_on BETWEEN $1::date AND $2::date`,
    [startDate, endDate]);
  return {
    amount: centsToText(toCents(r.amount)),
    invoices: r.invoices,
    scope: 'company-wide',
    basis: 'Invoices marked Payment received, by the date the payment was received. Not part of delivery revenue.',
  };
};
