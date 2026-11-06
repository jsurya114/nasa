// How the backend is set up to talk to Everee (issue #31). Read from the environment only; no value is ever written to the
// repository, logged or sent to the browser.
//
// Everee uses ONE web address for sandbox and production. Nothing in the address says which one a request goes to: the token and
// the tenant ID do. So this refuses a production token unless EVEREE_ENVIRONMENT is set to "production" on purpose, which keeps a
// production token pasted into a test setup from ever being used.

const DEFAULT_BASE_URL = 'https://api.everee.com';
export const ENVIRONMENTS = Object.freeze(['sandbox', 'production']);
const TOKEN_ENVIRONMENT = Object.freeze({ tsk_test_: 'sandbox', tsk_prod_: 'production' });
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/;

const environmentOfToken = (token) => {
  const prefix = Object.keys(TOKEN_ENVIRONMENT).find((p) => token.startsWith(p));
  return prefix ? TOKEN_ENVIRONMENT[prefix] : null;
};

// Returns { configured, environment, baseUrl, tenantId, token, problems }. `problems` says in words what is missing or wrong; it never
// contains the token. `configured` is true only when there are no problems.
export const readEvereeConfig = (env = process.env) => {
  const problems = [];
  const token = String(env.EVEREE_API_TOKEN ?? '').trim();
  const tenantId = String(env.EVEREE_TENANT_ID ?? '').trim();
  const baseUrl = String(env.EVEREE_API_BASE_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
  const wanted = String(env.EVEREE_ENVIRONMENT ?? 'sandbox').trim().toLowerCase();

  if (!ENVIRONMENTS.includes(wanted)) problems.push('EVEREE_ENVIRONMENT must be "sandbox" or "production"');
  if (!token) problems.push('EVEREE_API_TOKEN is not set');
  if (!/^\d{1,12}$/.test(tenantId)) problems.push(tenantId ? 'EVEREE_TENANT_ID must be the numeric tenant ID' : 'EVEREE_TENANT_ID is not set');
  if (!baseUrl.startsWith('https://') && !LOCAL_URL.test(baseUrl)) problems.push('EVEREE_API_BASE_URL must be an https address');

  let environment = ENVIRONMENTS.includes(wanted) ? wanted : null;
  if (token) {
    const tokenEnvironment = environmentOfToken(token);
    if (!tokenEnvironment) problems.push('EVEREE_API_TOKEN must start with tsk_test_ (sandbox) or tsk_prod_ (production)');
    else if (environment && tokenEnvironment !== environment) {
      problems.push(`the token is for ${tokenEnvironment} but EVEREE_ENVIRONMENT is ${environment}; they must match`);
    }
  }

  return { configured: problems.length === 0, environment, baseUrl, tenantId, token, problems };
};

// What the browser may be told: whether it is set up, for which environment, and what is wrong. Never the token.
export const describeConfig = (config) => ({
  configured: config.configured,
  environment: config.environment,
  tenantId: config.tenantId || null,
  problems: config.problems,
});

// Whether payments may be sent to Everee at all (issue #31). Off unless EVEREE_PAYMENTS_ENABLED is exactly "true", so setting up the connection,
// linking workers and previewing a batch never makes a payment possible by accident. Production is a separate, deliberate step: it needs
// a production token AND EVEREE_ENVIRONMENT=production (see readEvereeConfig) and, until Jasil approves going live, is not switched on.
export const paymentsGate = (config, env = process.env) => {
  if (!config.configured) return { enabled: false, reason: 'Everee is not set up in the backend settings' };
  if (String(env.EVEREE_PAYMENTS_ENABLED ?? '').trim().toLowerCase() !== 'true') {
    return { enabled: false, reason: 'sending payments to Everee is switched off (EVEREE_PAYMENTS_ENABLED is not "true")' };
  }
  // Production is a separate decision: it needs its own explicit approval setting, set only after Jasil approves going live.
  if (config.environment === 'production' && env.EVEREE_PRODUCTION_PAYMENTS_APPROVED !== 'true') {
    return { enabled: false, reason: 'live payments are not approved yet (EVEREE_PRODUCTION_PAYMENTS_APPROVED is not "true")' };
  }
  return { enabled: true, reason: null };
};

// Whether drivers may start Everee onboarding from NASA (issue #242). Off unless EVEREE_DRIVER_ONBOARDING_ENABLED is exactly "true", so the routes and the
// tables can ship and be tested while nobody is asked to onboard. Switching it on for production is a separate approval by the owners.
export const driverOnboardingGate = (config, env = process.env) => {
  if (!config.configured) return { enabled: false, reason: 'Everee is not set up in the backend settings' };
  if (String(env.EVEREE_DRIVER_ONBOARDING_ENABLED ?? '').trim().toLowerCase() !== 'true') {
    return { enabled: false, reason: 'driver onboarding is switched off (EVEREE_DRIVER_ONBOARDING_ENABLED is not "true")' };
  }
  return { enabled: true, reason: null };
};
