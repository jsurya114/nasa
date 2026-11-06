// Proves the real shape of Everee's embedded-onboarding API with ONE synthetic sandbox worker (issue #242, PR A). Nothing real is used: the worker, email,
// phone and address below are invented. It only ever runs against the Everee SANDBOX, and it prints names and types of fields, never the session link,
// tokens or the worker's details.
//
//   node scripts/evereeEmbedProbe.js          dry run: says what it would do, sends nothing
//   node scripts/evereeEmbedProbe.js --go     creates (or reuses) the synthetic worker and opens one ONBOARDING session
//
// Run it from the Backend folder, so the .env file is found. YOU run it: it makes calls to Everee.
import 'dotenv/config';
import { createEvereeClient, EvereeError } from '../services/payments/everee/evereeClient.js';
import { readEvereeConfig } from '../services/payments/everee/evereeConfig.js';

const go = process.argv.includes('--go');
const EXTERNAL = 'nasa-embed-probe-1';
const WORKER = {
  externalWorkerId: EXTERNAL,
  firstName: 'Probe',
  lastName: 'Contractor',
  email: 'nasa-embed-probe-1@example.com',
  phoneNumber: '5550100001',
  startDate: '2026-09-01',
  homeAddress: { line1: '1 Test Street', city: 'Austin', state: 'TX', postalCode: '78701' },
};
const shape = (value) => Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v]));

const config = readEvereeConfig(process.env);
if (!config.configured) { console.error('Everee is not set up:', config.problems.join('; ')); process.exit(1); }
if (config.environment !== 'sandbox') { console.error('Stopping: this probe runs only against the sandbox.'); process.exit(1); }
console.log(`Environment: sandbox, tenant ${config.tenantId}. ${go ? 'LIVE (sandbox) run.' : 'DRY RUN: nothing will be sent. Add --go to run.'}`);
if (!go) process.exit(0);

const client = createEvereeClient(config);
const say = (label, value) => console.log(`${label}:`, JSON.stringify(value));
try {
  let worker = null;
  try { ({ data: worker } = await client.getWorker(EXTERNAL)); say('worker already existed, reused; fields', shape(worker)); } catch (error) {
    if (!(error instanceof EvereeError) || error.status !== 404) throw error;
  }
  if (!worker) {
    ({ data: worker } = await client.createEmbeddedContractor(WORKER));
    say('worker created; fields', shape(worker));
  }
  say('worker.id present', Boolean(worker?.id));
  say('worker.externalWorkerId echoed', worker?.externalWorkerId === EXTERNAL);
  say('worker.onboardingComplete', worker?.onboardingComplete);

  const { data: session, status } = await client.createEmbeddedSession({ workerId: String(worker.id), experience: 'ONBOARDING', experienceVersion: 'V2_0', eventHandlerName: 'nasaEvereeEmbed' });
  say('session http status', status);
  say('session fields', shape(session));
  let host = null;
  try { host = new URL(session?.url).hostname; } catch { /* not a link */ }
  say('session link host (the link itself is not printed)', host);
  say('session origin field', session?.origin ?? null);
  say('expiresInMs', session?.expiresInMs ?? null);
} catch (error) {
  console.error('Failed:', error instanceof EvereeError ? `${error.message} (status ${error.status}${error.requestId ? `, Everee request ${error.requestId}` : ''})` : error.message);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
