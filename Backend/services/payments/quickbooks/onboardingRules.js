// Pure rules for a new Desi driver's QuickBooks setup. The tax ID is sent to QuickBooks once and is never stored, logged or returned by NASA.

export const STATES = Object.freeze({
  NOT_REQUIRED: 'not-required',
  NOT_STARTED: 'not-started',
  COMPLETE: 'complete',
  NEEDS_REVIEW: 'needs-review',
  SERVICE_UNAVAILABLE: 'service-unavailable',
});

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Returns { details, missing }. `details` holds only what is sent; `missing` names every field that is absent or wrong (never its value).
export const parseDetails = (body = {}) => {
  const missing = [];
  const legalName = clean(body.legalName, 100);
  if (legalName.length < 2) missing.push('legalName');
  const addressLine1 = clean(body.addressLine1, 100);
  if (!addressLine1) missing.push('addressLine1');
  const city = clean(body.city, 50);
  if (!city) missing.push('city');
  const state = clean(body.state, 20).toUpperCase(); // not cut to 2 letters first: "Texas" must be refused, not turned into "TE"
  if (!/^[A-Z]{2}$/.test(state)) missing.push('state');
  const postalCode = clean(body.postalCode, 10);
  if (!/^\d{5}(-\d{4})?$/.test(postalCode)) missing.push('postalCode');
  const taxId = String(body.taxId ?? '').replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(taxId) || /^(\d)\1{8}$/.test(taxId) || taxId.startsWith('000')) missing.push('taxId');
  if (body.certified !== true) missing.push('certified');
  return { details: { legalName, addressLine1, city, state, postalCode, taxId }, missing };
};

// The QuickBooks vendor for a 1099 contractor. The email is the driver's own address from NASA (never typed in the form), so the driver, the vendor and the
// admin's email match agree. TaxIdentifier is write-only at QuickBooks.
export const vendorBody = ({ details, email, phone }) => {
  const parts = details.legalName.split(' ');
  return {
    DisplayName: details.legalName,
    PrintOnCheckName: details.legalName,
    ...(parts.length > 1 && { GivenName: parts[0].slice(0, 25), FamilyName: parts.slice(1).join(' ').slice(0, 25) }),
    PrimaryEmailAddr: { Address: email },
    ...(phone && { PrimaryPhone: { FreeFormNumber: phone } }),
    BillAddr: { Line1: details.addressLine1, City: details.city, CountrySubDivisionCode: details.state, PostalCode: details.postalCode },
    Vendor1099: true,
    TaxIdentifier: details.taxId,
  };
};

export const FIELD_LABELS = Object.freeze({ legalName: 'full legal name', addressLine1: 'street address', city: 'city', state: '2-letter state', postalCode: 'ZIP code', taxId: '9-digit tax ID (SSN or EIN)', certified: 'the tax ID certification' });
