// How the backend is set up to talk to QuickBooks Online (Desi 1099 drivers). Read from the environment only; no value is ever written to the
// repository, logged or sent to the browser.
//
// Intuit has separate sandbox and production API hosts and separate app keys, so EVEREE-style prefix checks are not possible; the environment is
// set explicitly and the redirect address must be https (or localhost for development).

export const QB_ENVIRONMENTS = Object.freeze(['sandbox', 'production']);
const API_HOSTS = Object.freeze({ sandbox: 'https://sandbox-quickbooks.api.intuit.com', production: 'https://quickbooks.api.intuit.com' });
export const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const SCOPE = 'com.intuit.quickbooks.accounting';
export const MINOR_VERSION = 75;
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/;
const flag = (value) => String(value ?? '').trim().toLowerCase() === 'true';

// Returns { configured, environment, apiBase, clientId, clientSecret, redirectUri, tokenKey, problems }. `problems` says in words what is missing; it never
// contains a secret. `configured` is true only when there are none.
export const readQuickbooksConfig = (env = process.env) => {
  const problems = [];
  const environment = String(env.QUICKBOOKS_ENVIRONMENT ?? 'sandbox').trim().toLowerCase();
  const clientId = String(env.QUICKBOOKS_CLIENT_ID ?? '').trim();
  const clientSecret = String(env.QUICKBOOKS_CLIENT_SECRET ?? '').trim();
  const redirectUri = String(env.QUICKBOOKS_REDIRECT_URI ?? '').trim();
  const tokenKey = String(env.QUICKBOOKS_TOKEN_KEY ?? '').trim();
  if (!QB_ENVIRONMENTS.includes(environment)) problems.push('QUICKBOOKS_ENVIRONMENT must be "sandbox" or "production"');
  if (!clientId) problems.push('QUICKBOOKS_CLIENT_ID is not set');
  if (!clientSecret) problems.push('QUICKBOOKS_CLIENT_SECRET is not set');
  if (!redirectUri) problems.push('QUICKBOOKS_REDIRECT_URI is not set');
  else if (!redirectUri.startsWith('https://') && !LOCAL_URL.test(redirectUri)) problems.push('QUICKBOOKS_REDIRECT_URI must be an https address');
  if (!/^[0-9a-f]{64}$/i.test(tokenKey)) problems.push('QUICKBOOKS_TOKEN_KEY must be 64 hex characters (a 32-byte key)');
  const valid = QB_ENVIRONMENTS.includes(environment);
  return { configured: problems.length === 0, environment: valid ? environment : null, apiBase: valid ? API_HOSTS[environment] : null, clientId, clientSecret, redirectUri, tokenKey, problems };
};

export const describeQuickbooksConfig = (config) => ({ configured: config.configured, environment: config.environment, problems: config.problems });

// Off unless QUICKBOOKS_ENABLED is exactly "true", so the tables and routes can ship while nothing talks to QuickBooks.
export const quickbooksGate = (config, env = process.env) => {
  if (!config.configured) return { enabled: false, reason: 'QuickBooks is not set up in the backend settings' };
  if (!flag(env.QUICKBOOKS_ENABLED)) return { enabled: false, reason: 'QuickBooks is switched off (QUICKBOOKS_ENABLED is not "true")' };
  // Production is a separate, deliberate approval.
  if (config.environment === 'production' && !flag(env.QUICKBOOKS_PRODUCTION_APPROVED)) return { enabled: false, reason: 'live QuickBooks is not approved yet (QUICKBOOKS_PRODUCTION_APPROVED is not "true")' };
  return { enabled: true, reason: null };
};

// Whether payments may be recorded in QuickBooks at all. Off unless QUICKBOOKS_PAYMENTS_ENABLED is exactly "true" (on top of the connection gate), so connecting and
// linking never makes a payment record possible by accident. While it is on, Desi drivers are no longer recorded as Cash in Hand (see driverPaymentRules.js).
export const quickbooksPaymentsGate = (config, env = process.env) => {
  const gate = quickbooksGate(config, env);
  if (!gate.enabled) return gate;
  if (!flag(env.QUICKBOOKS_PAYMENTS_ENABLED)) return { enabled: false, reason: 'recording payments in QuickBooks is switched off (QUICKBOOKS_PAYMENTS_ENABLED is not "true")' };
  return { enabled: true, reason: null };
};
export const quickbooksPaymentsOn = (env = process.env) => flag(env.QUICKBOOKS_PAYMENTS_ENABLED) && flag(env.QUICKBOOKS_ENABLED);

// Whether a new Desi driver may set up QuickBooks from the driver portal. Off unless QUICKBOOKS_DRIVER_ONBOARDING_ENABLED is exactly "true" (on top of the connection gate).
export const quickbooksDriverOnboardingGate = (config, env = process.env) => {
  const gate = quickbooksGate(config, env);
  if (!gate.enabled) return gate;
  if (!flag(env.QUICKBOOKS_DRIVER_ONBOARDING_ENABLED)) return { enabled: false, reason: 'driver onboarding for QuickBooks is switched off (QUICKBOOKS_DRIVER_ONBOARDING_ENABLED is not "true")' };
  return { enabled: true, reason: null };
};
// The hard hold: a Desi driver with no QuickBooks vendor cannot work or be paid. Needs the onboarding switch AND QUICKBOOKS_ONBOARDING_ENFORCED. Turn it on only after every
// existing Desi driver has been linked to their vendor (see docs/QUICKBOOKS_DESI.md), because an unlinked driver is held until an admin links them.
export const quickbooksOnboardingEnforced = (env = process.env) => flag(env.QUICKBOOKS_ENABLED) && flag(env.QUICKBOOKS_DRIVER_ONBOARDING_ENABLED) && flag(env.QUICKBOOKS_ONBOARDING_ENFORCED);
