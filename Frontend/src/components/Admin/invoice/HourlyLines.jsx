import { Plus, Trash2 } from "lucide-react";
import { Field } from "./fields.jsx";
import { INPUT, invalid } from "./fieldStyles.js";
import { MAX_ROWS } from "./invoiceTemplate.js";
import { LIMITS, blankRow, hourlyTotalCents, moneyText, totalDiffers, withDerivedTotal } from "./invoiceRules.js";

// The hourly invoice's jobs (up to seven), as on the template: job, total RE hours, overtime, total hours (follows RE hours + overtime until a total
// of your own is typed) and total cost. The invoice total is the sum of the costs exactly as entered.
export default function HourlyLines({ rows, onChange, errors, disabled }) {
  const lineErrors = errors.lineErrors ?? {};
  const setRow = (index, field, value) => onChange(rows.map((row, i) => {
    if (i !== index) return row;
    const next = { ...row, [field]: value };
    // Typing a total of your own stops it following RE hours + overtime; emptying it hands it back.
    if (field === "totalHours") next.totalTouched = value.trim() !== "";
    return withDerivedTotal(next);
  }));
  const add = () => rows.length < MAX_ROWS && onChange([...rows, blankRow()]);
  const remove = (index) => rows.length > 1 && onChange(rows.filter((_, i) => i !== index));

  return (
    <fieldset className="flex flex-col gap-3" data-testid="hourly-lines">
      <legend className="mb-1 text-sm font-bold text-ink">Jobs</legend>
      {errors.lines && <p className="text-sm text-red-600" role="alert">{errors.lines}</p>}
      {rows.map((row, i) => {
        const own = lineErrors[i] ?? {};
        const n = i + 1;
        return (
          <div key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-brand-50/30 p-3" data-testid={`invoice-job-${n}`}>
            <div className="flex items-end gap-2">
              <Field id={`job-${n}`} label={rows.length > 1 ? `Job ${n}` : "Job"} error={own.job} className="flex-1">
                <input id={`job-${n}`} className={INPUT} value={row.job} disabled={disabled} onChange={(e) => setRow(i, "job", e.target.value)} maxLength={LIMITS.job} placeholder="General worker" autoComplete="off" {...invalid(`job-${n}`, own.job)} />
              </Field>
              {rows.length > 1 && !disabled && (
                <button type="button" onClick={() => remove(i)} aria-label={`Remove job ${n}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-white text-ink-muted hover:bg-brand-50">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field id={`re-${n}`} label="Total RE hours" error={own.reHours}>
                <input id={`re-${n}`} inputMode="decimal" className={INPUT} value={row.reHours} disabled={disabled} onChange={(e) => setRow(i, "reHours", e.target.value)} placeholder="360" autoComplete="off" {...invalid(`re-${n}`, own.reHours)} />
              </Field>
              <Field id={`ot-${n}`} label="Overtime" error={own.overtime}>
                <input id={`ot-${n}`} inputMode="decimal" className={INPUT} value={row.overtime} disabled={disabled} onChange={(e) => setRow(i, "overtime", e.target.value)} placeholder="71.05" autoComplete="off" {...invalid(`ot-${n}`, own.overtime)} />
              </Field>
              <Field id={`total-${n}`} label="Total hours" error={own.totalHours} hint={totalDiffers(row) ? "Differs from RE hours + overtime." : undefined}>
                <input id={`total-${n}`} inputMode="decimal" className={INPUT} value={row.totalHours} disabled={disabled} onChange={(e) => setRow(i, "totalHours", e.target.value)} placeholder="431.05" autoComplete="off" {...invalid(`total-${n}`, own.totalHours)} />
              </Field>
              <Field id={`cost-${n}`} label="Total cost ($)" error={own.totalCost}>
                <input id={`cost-${n}`} inputMode="decimal" className={INPUT} value={row.totalCost} disabled={disabled} onChange={(e) => setRow(i, "totalCost", e.target.value)} placeholder="7543.37" autoComplete="off" {...invalid(`cost-${n}`, own.totalCost)} />
              </Field>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!disabled && (
          <div>
            <button type="button" onClick={add} disabled={rows.length >= MAX_ROWS} className="ui-btn ui-btn-ghost">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add job
            </button>
            {rows.length >= MAX_ROWS && <span className="ml-3 text-xs text-ink-muted">An hourly invoice holds up to {MAX_ROWS} jobs.</span>}
          </div>
        )}
        <p className="ml-auto text-sm text-ink">Invoice total <span className="font-bold tabular-nums" data-testid="hourly-total">{moneyText(hourlyTotalCents(rows))}</span></p>
      </div>
    </fieldset>
  );
}
