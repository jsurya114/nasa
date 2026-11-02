// Courier claim rules (issue #141). Pure functions: no database, no files, no network.
//
// Owner-confirmed rules (issue #138):
// - Only real rows of the carrier's "Claims Detail" sheet are claims. Nothing is inferred from delivery statuses.
// - The deduction is the absolute value of "The total expenses-exclusive of taxes": +40 and -40 both mean 40.
//   "Declared value (USD)" is never used.
// - City DFW GOFO (key "dfwgofo") together with claim type "Tracking interruption" is exempt: no deduction.
//   Both must hold. Every other exactly matched claim is chargeable.
// - The driver comes only from waybill -> carrier Delivery ID -> NASA driver, with the historical city.
//   Never from a name. Missing or conflicting evidence leaves the claim unresolved.

import { createHash } from 'node:crypto';

// Bump when a rule below changes, so stored results show which rules produced them.
export const CLAIM_RULES_VERSION = 'claims-2026-11-03';

export const COURIERS = Object.freeze(['gofo', 'speedx']);

// Lower case, letters and digits only: "DFW GOFO", "dfw-gofo" and " Dfw  Gofo " are all "dfwgofo".
export const cityKey = (name) => (typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]/g, '') : '');

// Lower case, single spaces: "Tracking  Interruption " is "tracking interruption".
export const claimTypeKey = (type) => (typeof type === 'string' ? type.trim().replace(/\s+/g, ' ').toLowerCase() : '');

// Exempt city and claim type pairs. A city is matched by its stored name's key, never by a guessed alias.
// The owner confirmed on 3 Nov 2026 that the stored city "Dallas GOFO" is the DFW GOFO city, so both names are listed.
// Other Dallas cities (for example "Dallas SpeedX") are not exempt.
const EXEMPT_TYPE = 'tracking interruption';
export const EXEMPTIONS = Object.freeze([
  Object.freeze({ city: 'dfwgofo', claimType: EXEMPT_TYPE }),
  Object.freeze({ city: 'dallasgofo', claimType: EXEMPT_TYPE }),
]);

export const isExempt = (cityName, claimType) => {
  const city = cityKey(cityName);
  const type = claimTypeKey(claimType);
  return Boolean(city && type) && EXEMPTIONS.some((rule) => rule.city === city && rule.claimType === type);
};

// The charge as written in the file, to the cent. Returns { charge, deduction } as "12.34" strings, or { error }.
// Blank, zero, text, and amounts with more than two decimals are refused: never turned into zero or rounded.
export const parseCharge = (value) => {
  let n = value;
  if (typeof value === 'string') {
    const text = value.trim().replace(/,/g, '');
    if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return { error: 'amount is blank or not a number' };
    n = Number(text);
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'amount is blank or not a number' };
  if (n === 0) return { error: 'amount is zero' };
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return { error: 'amount has more than two decimals' };
  const toText = (c) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
  return { charge: toText(cents), deduction: toText(Math.abs(cents)) };
};

// Carrier dates are written month first: "09/28/2026 14:05:00" (checked against the sample workbooks, where the
// second number goes above 12). Also accepts "2026-09-28" with an optional time. Returns "YYYY-MM-DD HH:MM:SS"
// in the carrier's own clock, or null when the text is not a real date.
export const parseCarrierDateTime = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  let year, month, day, hh, mm, ss;
  if (m) [, month, day, year, hh, mm, ss] = m;
  else {
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (!m) return null;
    [, year, month, day, hh, mm, ss] = m;
  }
  const [y, mo, d, h, mi, s] = [year, month, day, hh ?? '00', mm ?? '00', ss ?? '00'].map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  const pad = (v) => String(v).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
};

// Waybills compare without case or spaces.
export const normalizeWaybill = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, '').toUpperCase() : '');

// A claim's identity: courier + waybill + claim type. Not the amount (an amended amount is a new version of the
// same claim) and not the file name (the same claim in two uploads is one claim). Provisional until the carrier
// confirms whether one waybill can carry two separate claims of the same type (issue #138, open decision).
export const claimKey = ({ courier, waybill, claimType }) =>
  createHash('sha256').update(`${courier}|${normalizeWaybill(waybill)}|${claimTypeKey(claimType)}`).digest('hex');

// Decides one claim from the delivery history found for its waybill.
// candidates: [{ driverId, cityId, cityName, carrierDeliveryId, routeId, journeyDate }], from history only.
// importCityId: the city the claims file was uploaded for.
// Returns { status, driverId, cityId, carrierDeliveryId, routeId, journeyDate, eligibleDeduction, reason }.
// status is "chargeable", "exempt", "unresolved" or "ambiguous". Only "chargeable" carries a deduction.
export const resolveClaim = (claim, candidates, importCityId) => {
  const open = (status, reason) => ({ status, driverId: null, cityId: null, carrierDeliveryId: null, routeId: null, journeyDate: null, eligibleDeduction: null, reason });
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return open('unresolved', 'no delivery history for this waybill yet');

  const drivers = new Set(list.map((c) => c.driverId ?? null));
  const cities = new Set(list.map((c) => c.cityId ?? null));
  if (drivers.size > 1) return open('ambiguous', 'the waybill is linked to more than one driver');
  if (cities.size > 1) return open('ambiguous', 'the waybill is linked to more than one city');

  const [match] = list;
  if (match.driverId == null) return open('unresolved', 'the carrier delivery ID is not linked to a NASA driver');
  if (match.cityId == null || !cityKey(match.cityName)) return open('unresolved', 'the delivery has no verified city');
  if (importCityId != null && match.cityId !== importCityId) return open('ambiguous', 'the delivery city differs from the city the file was uploaded for');

  const exempt = isExempt(match.cityName, claim.claimType);
  return {
    status: exempt ? 'exempt' : 'chargeable',
    driverId: match.driverId,
    cityId: match.cityId,
    carrierDeliveryId: match.carrierDeliveryId ?? null,
    routeId: match.routeId ?? null,
    journeyDate: match.journeyDate ?? null,
    eligibleDeduction: exempt ? '0.00' : claim.deduction,
    reason: exempt ? 'exempt: DFW GOFO and Tracking interruption' : 'matched by waybill and delivery history',
  };
};
