import { INPUT } from "./fieldStyles.js";
import { LIMITS, datesBetween, entriesOutside, isPartialItem, itemLineCents, itemRowsFor, itemSubtotalCents, moneyText, usDate, weekdayOf } from "./invoiceRules.js";

// The item-based invoice: one row for every calendar date of the billing period, From to To, both included and weekends too. The date and the day
// are filled in; the item, rate and quantity are typed. A row left empty is not billed and not printed. Each line's total is rate x quantity rounded
// to the cent, and the subtotal is the sum of those rounded lines (the server works it out the same way and saves that).
// `entries` holds what was typed, by date, so moving the dates keeps everything typed for a date that is still in the period.
export default function ItemLines({ start, end, entries, onChange, errors, disabled }) {
  const dates = datesBetween(start, end);
  const rows = itemRowsFor(start, end, entries);
  const lineErrors = errors.lineErrors ?? {};
  const outside = dates.length ? entriesOutside(start, end, entries) : [];
  const set = (date, field, value) => onChange({ ...entries, [date]: { date, item: "", rate: "", quantity: "", ...entries[date], [field]: value } });

  if (dates.length === 0) {
    return (
      <fieldset data-testid="item-lines">
        <legend className="mb-1 text-sm font-bold text-ink">Lines</legend>
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">Choose the billing period (From and To) to list its dates.</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2" data-testid="item-lines">
      <legend className="mb-1 text-sm font-bold text-ink">Lines</legend>
      <p className="text-xs text-ink-muted">{dates.length} {dates.length === 1 ? "day" : "days"}, {usDate(start)} to {usDate(end)}. Leave a day empty to leave it off the invoice.</p>
      {outside.length > 0 && (
        <p role="status" className="rounded-xl border border-amber-600 bg-amber-50 p-3 text-sm text-amber-900" data-testid="outside-warning">
          {outside.length} {outside.length === 1 ? "line you entered is" : "lines you entered are"} outside these dates ({outside.map(usDate).join(", ")}) and will not be on the invoice.
          Change the dates back to keep {outside.length === 1 ? "it" : "them"}; saving with these dates removes {outside.length === 1 ? "it" : "them"}.
        </p>
      )}
      {errors.lines && <p className="text-sm text-red-600" role="alert">{errors.lines}</p>}
      <div className="hidden grid-cols-[6.5rem_6.5rem_minmax(0,1fr)_7rem_6rem_7rem] gap-2 px-2 text-xs font-semibold uppercase text-ink-muted sm:grid" aria-hidden="true">
        <span>Date</span><span>Day</span><span>Item</span><span className="text-right">Rate ($)</span><span className="text-right">Quantity</span><span className="text-right">Total</span>
      </div>
      <ol className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const own = lineErrors[i] ?? {};
          const partial = isPartialItem(row);
          const cents = itemLineCents(row);
          const flagged = partial || Object.keys(own).length > 0;
          const day = weekdayOf(row.date);
          const id = `line-${row.date}`;
          const message = own.row ?? (partial ? "Fill in the item, rate and quantity, or leave the whole row empty." : null);
          const fieldError = own.date ?? own.item ?? own.rate ?? own.quantity;
          return (
            <li key={row.date} data-testid={id} data-partial={partial ? "true" : undefined}
              className={`grid grid-cols-2 items-center gap-2 rounded-xl border p-2 sm:grid-cols-[6.5rem_6.5rem_minmax(0,1fr)_7rem_6rem_7rem] ${flagged ? "border-amber-600 bg-amber-50/60" : "border-line bg-white"} ${day === "Saturday" || day === "Sunday" ? "sm:bg-canvas/60" : ""}`}>
              <span className="text-sm font-semibold tabular-nums text-ink" data-testid={`${id}-date`}>{usDate(row.date)}</span>
              <span className="text-right text-sm text-ink-muted sm:text-left" data-testid={`${id}-day`}>{day}</span>
              <input aria-label={`Item, ${day} ${usDate(row.date)}`} className={`${INPUT} col-span-2 sm:col-span-1`} value={row.item} disabled={disabled} onChange={(e) => set(row.date, "item", e.target.value)}
                maxLength={LIMITS.item} placeholder="Item" autoComplete="off" aria-invalid={Boolean(own.item || own.row || partial)} />
              <input aria-label={`Rate, ${usDate(row.date)}`} inputMode="decimal" className={`${INPUT} text-right`} value={row.rate} disabled={disabled} onChange={(e) => set(row.date, "rate", e.target.value)}
                placeholder="Rate" autoComplete="off" aria-invalid={Boolean(own.rate)} />
              <input aria-label={`Quantity, ${usDate(row.date)}`} inputMode="decimal" className={`${INPUT} text-right`} value={row.quantity} disabled={disabled} onChange={(e) => set(row.date, "quantity", e.target.value)}
                placeholder="Qty" autoComplete="off" aria-invalid={Boolean(own.quantity)} />
              <span className="col-span-2 text-right text-sm font-bold tabular-nums text-ink sm:col-span-1" data-testid={`${id}-total`}>{cents === null ? "—" : moneyText(cents)}</span>
              {(message || fieldError) && <p className="col-span-2 text-sm text-amber-900 sm:col-span-6" data-testid={`${id}-problem`}>{[message, fieldError].filter(Boolean).join(" ")}</p>}
            </li>
          );
        })}
      </ol>
      <p className="mt-1 flex justify-end gap-3 border-t border-line pt-3 text-base text-ink">
        Subtotal <span className="font-bold tabular-nums" data-testid="item-subtotal">{moneyText(itemSubtotalCents(rows))}</span>
      </p>
    </fieldset>
  );
}
