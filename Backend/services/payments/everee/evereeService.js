import { PayrollError, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import { describeConfig, readEvereeConfig } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';

// What the Pay runs page asks about Everee (issue #31). Super admin only: it shows how payments are connected.

const MAX_PAY_CODES_SHOWN = 50;

const requireSuperAdmin = (admin) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can see or test the Everee connection');
};

// Says whether the backend is set up for Everee, and for which environment. Makes no call to Everee.
export const getEvereeStatus = (admin, { env = process.env } = {}) => {
  requireSuperAdmin(admin);
  return describeConfig(readEvereeConfig(env));
};

// Asks Everee for the company's pay codes with the configured token and tenant ID. That proves the pair works and shows which
// pay codes payments can use later. Moves no money and changes nothing in Everee. Never throws for an Everee problem: the answer says
// what went wrong, with Everee's request ID for support.
export const checkEvereeConnection = async (admin, { env = process.env, fetchImpl } = {}) => {
  requireSuperAdmin(admin);
  const config = readEvereeConfig(env);
  const status = describeConfig(config);
  if (!config.configured) return { ...status, ok: false, reason: 'Everee is not set up in the backend settings', payCodes: [], requestId: null };

  try {
    const { data, requestId } = await createEvereeClient(config, fetchImpl ? { fetchImpl } : {}).listPayCodes();
    // The sandbox answers with a plain list; Everee's reference page shows a page object with `items`. Both are read.
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    const payCodes = items.slice(0, MAX_PAY_CODES_SHOWN).map((p) => ({
      code: String(p.apiKey ?? ''), label: String(p.displayLabel ?? p.name ?? p.apiKey ?? ''), type: p.payCodeType ? String(p.payCodeType) : null,
    }));
    return { ...status, ok: true, reason: null, payCodes, requestId };
  } catch (error) {
    if (!(error instanceof EvereeError)) throw error;
    return { ...status, ok: false, reason: error.message, payCodes: [], requestId: error.requestId };
  }
};
