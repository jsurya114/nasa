import { PayrollError, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import { describeQuickbooksConfig, quickbooksGate, quickbooksPaymentsGate, readQuickbooksConfig } from './quickbooksConfig.js';
import { authorizationUrl, createQuickbooksClient, QuickbooksError } from './quickbooksClient.js';
import { completeConnect, connectionSummary, consumeConnectState, createConnectState, getAuth } from './connectionStore.js';

// What the admin screens ask about the QuickBooks connection. Super admin only: it shows how payments are connected.

const requireSuperAdmin = (admin) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can see or change the QuickBooks connection');
};
const requireEnabled = (env) => {
  const config = readQuickbooksConfig(env);
  const gate = quickbooksGate(config, env);
  if (!gate.enabled) throw new PayrollError(409, gate.reason);
  return config;
};

export const getQuickbooksStatus = async (db, admin, { env = process.env, now = new Date() } = {}) => {
  requireSuperAdmin(admin);
  const config = readQuickbooksConfig(env);
  const gate = quickbooksGate(config, env);
  const payments = quickbooksPaymentsGate(config, env);
  return { ...describeQuickbooksConfig(config), enabled: gate.enabled, disabledReason: gate.reason, paymentsEnabled: payments.enabled, connection: config.configured ? await connectionSummary(db, config, now) : { connected: false } };
};

// Step 1: the address to send the admin to, to sign in to QuickBooks and approve NASA.
export const startConnect = async (db, admin, { env = process.env } = {}) => {
  requireSuperAdmin(admin);
  const config = requireEnabled(env);
  const state = await createConnectState(db, { adminId: admin.id, environment: config.environment });
  return { url: authorizationUrl(config, state) };
};

// Step 2: QuickBooks sends the admin's browser back with a code, the state and the company ID. The state must be unused and recent. The return is a plain page visit that
// carries no login header, so the callback route has no signed-in admin (`admin` is null): the admin is the one who made the state, and must still be an active super admin
// in the database. When an admin is given, the state must also have been made by that same admin.
export const finishConnect = async (db, admin, { code, state, realmId }, { env = process.env, fetchImpl, now = new Date() } = {}) => {
  if (admin) requireSuperAdmin(admin);
  const config = requireEnabled(env);
  const started = await consumeConnectState(db, state, now);
  if (!started || (admin && started.adminId !== admin.id) || started.environment !== config.environment) throw new PayrollError(400, 'this QuickBooks sign-in is not valid or has expired; start the connection again');
  if (!admin) {
    const { rows } = await db.query("SELECT id FROM admin WHERE id = $1 AND role = 'superadmin' AND is_active IS TRUE", [started.adminId]);
    if (rows.length === 0) throw new PayrollError(403, 'only an active super admin can connect QuickBooks');
  }
  if (typeof code !== 'string' || !code || code.length > 2000) throw new PayrollError(400, 'QuickBooks did not send an approval code');
  try {
    return await completeConnect(db, config, { code, realmId, adminId: started.adminId }, { fetchImpl, now });
  } catch (error) {
    if (error instanceof QuickbooksError) throw new PayrollError(502, error.message);
    throw error;
  }
};

// A read-only call that proves the saved connection works. Moves no money and changes nothing in QuickBooks.
export const checkQuickbooks = async (db, admin, { env = process.env, fetchImpl } = {}) => {
  requireSuperAdmin(admin);
  const config = readQuickbooksConfig(env);
  const status = describeQuickbooksConfig(config);
  if (!config.configured) return { ...status, ok: false, reason: 'QuickBooks is not set up in the backend settings', companyName: null, requestId: null };
  try {
    const client = createQuickbooksClient(config, () => getAuth(db, config, { fetchImpl }), fetchImpl ? { fetchImpl } : {});
    const info = await client.getCompanyInfo();
    return { ...status, ok: true, reason: null, companyName: info?.CompanyName ?? null, requestId: null };
  } catch (error) {
    if (!(error instanceof QuickbooksError)) throw error;
    return { ...status, ok: false, reason: error.message, companyName: null, requestId: error.requestId };
  }
};
