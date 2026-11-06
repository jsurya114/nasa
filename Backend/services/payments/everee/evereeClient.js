import logger from '../../../utils/logger.js';

// A thin client for Everee's REST API (https://developer.everee.com). It adds the two headers every request needs, applies a
// time limit, and turns a failure into an EvereeError that carries Everee's request ID (for support) but never the token.
// Whether to use sandbox or production is not decided here: the configuration (evereeConfig.js) holds the token and tenant ID.

const REQUEST_TIMEOUT_MS = 15_000;

export class EvereeError extends Error {
  constructor(message, { status = null, code = null, requestId = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'EvereeError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds; // from RateLimit-Reset on a 429
  }
}

// Everee's own words for the cases an admin can act on; anything else gets a plain message with the status.
const explain = (status) => {
  if (status === 401) return 'Everee refused the token (it may be wrong, rotated or for another environment)';
  if (status === 403) return 'Everee says this token is not allowed to do that';
  if (status === 404) return 'Everee did not find what was asked for';
  if (status === 429) return 'Everee is limiting requests; try again in a moment';
  return `Everee answered ${status}`;
};

const authorization = (token) => `Basic ${Buffer.from(`${token}:`).toString('base64')}`;

export const createEvereeClient = (config, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  const request = async (method, path, body) => {
    // The query string can hold a driver's email or phone (the worker search), so only the path before it is ever logged.
    const loggedPath = path.split('?')[0];
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: authorization(config.token),
          'x-everee-tenant-id': config.tenantId,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      logger.warn('Everee request did not complete', { method, path: loggedPath, reason: error.name === 'TimeoutError' ? 'timeout' : 'network' });
      throw new EvereeError(error.name === 'TimeoutError' ? 'Everee did not answer in time' : 'Everee could not be reached');
    }

    const requestId = response.headers?.get?.('x-request-id') ?? null;
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null; // an empty or non-JSON answer
    }
    if (!response.ok) {
      logger.warn('Everee refused a request', { method, path: loggedPath, status: response.status, requestId });
      const detail = typeof payload?.errorMessage === 'string' ? payload.errorMessage.slice(0, 200) : null;
      throw new EvereeError(detail && response.status >= 400 && response.status < 500 && response.status !== 401 ? `${explain(response.status)}: ${detail}` : explain(response.status), {
        status: response.status, code: payload?.errorCode ?? null, requestId,
        retryAfterSeconds: Number.isFinite(Number(response.headers?.get?.('ratelimit-reset'))) ? Number(response.headers.get('ratelimit-reset')) : null,
      });
    }
    return { status: response.status, data: payload, requestId };
  };

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    // The configured pay codes of the company: a read-only call that proves the token and tenant ID work together.
    listPayCodes: () => request('GET', '/integration/v1/pay-codes'),
    // Loose text search over names, email, phone and IDs (at least 3 characters, at most 10 results). Read-only.
    searchWorkers: (term) => request('GET', `/integration/v1/workers/search?term=${encodeURIComponent(term)}`),
    // One worker by the external worker ID if there is one, else Everee's own ID. Read-only.
    getWorker: (id) => request('GET', `/integration/v1/workers/${encodeURIComponent(id)}`),
    // Creates a 1099 contractor with the complete record (sandbox test workers only; see workerStore.js).
    createContractor: (body) => request('POST', '/integration/v1/workers/contractor', body),
    // Embedded onboarding (issue #242). Creates a 1099 contractor from the few fields a driver can give (name, email, 10-digit phone, start date, home
    // address); Everee collects the tax and bank details itself inside the embedded screens. The answer is the Worker, with Everee's own `id`.
    createEmbeddedContractor: (body) => request('POST', '/integration/v1/embedded/workers/contractor', body),
    // A short-lived, single-use link to one Everee screen (experience) for one worker. The answer holds `url`, `origin` and `expiresInMs`. It is a
    // bearer credential: callers must not log it or keep it.
    createEmbeddedSession: (body) => request('POST', '/integration/v1/embedded/session', body),
    // A payable item: an amount owed to a worker. The same externalId again updates the item while it is unpaid (that is what makes a retry safe).
    createPayable: (body) => request('POST', '/integration/v1/payables', body),
    // Asks Everee to turn the named unpaid payables into payments (contractors are paid only after this). Limited to the given external IDs.
    requestPayout: (externalIds) => request('POST', '/integration/v1/payables/payment-request', { externalIds }),
    // One payable by its external ID: what Everee knows about it (paymentStatus, paymentId). Read-only.
    getPayable: (externalId) => request('GET', `/integration/v1/payables/${encodeURIComponent(externalId)}`),
    // One payment of a worker by its payment ID. Everee answers 404 until the payment has been processed for deposit. Read-only. Its answer
    // says the pay date, the worker and the amounts, but not whether the bank deposit has settled (it has no payout statuses).
    getPaymentHistoryItem: (paymentId) => request('GET', `/integration/v1/workers/payment-history/${encodeURIComponent(paymentId)}`),
    // Everee's Payment Data API: the payments of one pay date (YYYY-MM-DD), each with its `netPayouts` and their statuses PENDING, PAID or
    // FAILED, 1000 at most per page; `after` is the previous page's nextCursor. Only paid payments are listed. Read-only.
    getPaymentData: (payDate, after) => request('GET', `/integration/v1/payment-data?pay-date=${encodeURIComponent(payDate)}&limit=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`),
  };
};
