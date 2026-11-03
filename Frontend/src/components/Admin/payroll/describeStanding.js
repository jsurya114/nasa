// Where an owed amount stands, in the words that keep approval and payment apart (#166): a draft only reserves it, an approved
// run allocates it, and only a confirmed payout, or a recorded repayment or waiver, settles it. The numbers are the server's.
export const describeStanding = (e, money) => {
  const n = (v) => Number(v ?? 0);
  const parts = [];
  if (n(e.outstanding) > 0) parts.push(`${money(e.outstanding)} outstanding`);
  if (n(e.reserved) > 0) parts.push(`${money(e.reserved)} reserved in a draft pay run (not approved)`);
  if (n(e.allocated) > 0) parts.push(`${money(e.allocated)} allocated to an approved pay run, payment not confirmed`);
  if (n(e.paid) > 0) parts.push(`${money(e.paid)} paid through payroll`);
  if (n(e.settled_outside) > 0) parts.push(`${money(e.settled_outside)} repaid or waived outside payroll`);
  if (n(e.outstanding) === 0 && n(e.reserved) === 0 && n(e.allocated) === 0) parts.push("settled");
  return parts.join(" · ");
};
