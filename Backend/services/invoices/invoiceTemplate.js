// What NASA prints on every invoice, saved with each invoice when it is made, so a later change here never rewrites an invoice already issued.
// The terms are the shared copy agreed for this module: no due period, late fee, tax or payment instructions are added without an approved rule.
export const TEMPLATE_VERSION = '2026-11-11';

export const ISSUER = Object.freeze({
  name: 'NASA LOGISTICS CARRIERS',
  addressLines: Object.freeze(['ARLINGTON, TEXAS 76015']),
  phone: '+1 (682) 699-3175',
  emails: Object.freeze(['nasalogisticscarriers@gmail.com', 'Info@drivefornlc.com']),
});

export const TERMS = 'This invoice covers the items or services listed for the billing period shown. Payment is due according to the terms agreed between '
  + 'NASA Logistics Carriers and the billed party. Please include the invoice number with your payment and contact us if you have a billing question or '
  + 'discrepancy.';
