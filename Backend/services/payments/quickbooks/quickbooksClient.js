import logger from '../../../utils/logger.js';
import { AUTH_URL, MINOR_VERSION, SCOPE, TOKEN_URL } from './quickbooksConfig.js';

// A thin client for the QuickBooks Online Accounting API. It adds the bearer token and the minor version, applies a time limit and turns a failure
// into a QuickbooksError that carries Intuit's transaction id (for support) but never a token or a driver's tax ID. Which company and how the
// access token is kept fresh is decided by `auth` (connectionStore.js), not here.

const REQUEST_TIMEOUT_MS = 20_000;
const VENDOR_PAGE_SIZE = 1000; // the most QuickBooks returns for one query
const VENDOR_PAGE_LIMIT = 20; // up to 20,000 vendors are searched

export class QuickbooksError extends Error {
  constructor(message, { status = null, code = null, requestId = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'QuickbooksError';
    this.status = status;
    this.code = code;
    this.requestId = requestId; // intuit_tid
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const explain = (status) => {
  if (status === 401) return 'QuickBooks refused the connection (it may have expired; reconnect QuickBooks)';
  if (status === 403) return 'QuickBooks says this connection is not allowed to do that';
  if (status === 404) return 'QuickBooks did not find what was asked for';
  if (status === 429) return 'QuickBooks is limiting requests; try again in a moment';
  return `QuickBooks answered ${status}`;
};

// A QuickBooks query string uses single quotes; a quote or backslash in a value must be escaped with a backslash.
export const quoteValue = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const basic = (config) => `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
const form = (fields) => new URLSearchParams(fields).toString();

// The address the admin is sent to, to sign in to QuickBooks and approve this app.
export const authorizationUrl = (config, state) => `${AUTH_URL}?${form({ client_id: config.clientId, response_type: 'code', scope: SCOPE, redirect_uri: config.redirectUri, state })}`;

// Token calls. The answer holds access_token, refresh_token, expires_in and x_refresh_token_expires_in (seconds). QuickBooks may return a NEW refresh
// token on every refresh; the caller must keep the latest one.
const tokenCall = async (config, fields, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  let response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: basic(config), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(fields),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    logger.warn('QuickBooks token request did not complete', { reason: error.name === 'TimeoutError' ? 'timeout' : 'network' });
    throw new QuickbooksError(error.name === 'TimeoutError' ? 'QuickBooks did not answer in time' : 'QuickBooks could not be reached');
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    logger.warn('QuickBooks refused a token request', { status: response.status, error: payload?.error });
    throw new QuickbooksError(payload?.error === 'invalid_grant' ? 'the QuickBooks connection has expired or was revoked; reconnect QuickBooks' : explain(response.status),
      { status: response.status, code: payload?.error ?? null, requestId: response.headers?.get?.('intuit_tid') ?? null });
  }
  if (!payload?.access_token || !payload?.refresh_token) throw new QuickbooksError('QuickBooks sent an unexpected token answer', { status: response.status });
  return payload;
};

export const exchangeCode = (config, code, deps) => tokenCall(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }, deps);
export const refreshTokens = (config, refreshToken, deps) => tokenCall(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, deps);

// `auth()` answers { accessToken, realmId } and is called once per request, so a refreshed token is always the one used.
export const createQuickbooksClient = (config, auth, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  // `realm` pins the call to one QuickBooks company: if the connection was replaced by another company in the meantime, nothing is sent.
  const request = async (method, path, { body, params = {}, requestId, realm } = {}) => {
    const { accessToken, realmId } = await auth();
    if (realm && String(realmId) !== String(realm)) throw new QuickbooksError('The QuickBooks company changed while this was running; nothing was changed. Try again');
    const query = new URLSearchParams({ minorversion: String(MINOR_VERSION), ...params, ...(requestId && { requestid: requestId }) });
    const url = `${config.apiBase}/v3/company/${encodeURIComponent(realmId)}${path}?${query}`;
    const loggedPath = path; // never the query: it can hold an email address
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      logger.warn('QuickBooks request did not complete', { method, path: loggedPath, reason: error.name === 'TimeoutError' ? 'timeout' : 'network' });
      throw new QuickbooksError(error.name === 'TimeoutError' ? 'QuickBooks did not answer in time' : 'QuickBooks could not be reached');
    }
    const requestIdOut = response.headers?.get?.('intuit_tid') ?? null;
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      logger.warn('QuickBooks refused a request', { method, path: loggedPath, status: response.status, requestId: requestIdOut });
      const fault = payload?.Fault?.Error?.[0];
      const detail = typeof fault?.Detail === 'string' ? fault.Detail.slice(0, 200) : typeof fault?.Message === 'string' ? fault.Message.slice(0, 200) : null;
      const retry = Number(response.headers?.get?.('retry-after'));
      throw new QuickbooksError(detail && response.status >= 400 && response.status < 500 && response.status !== 401 ? `${explain(response.status)}: ${detail}` : explain(response.status), {
        status: response.status, code: fault?.code ?? null, requestId: requestIdOut, retryAfterSeconds: Number.isFinite(retry) ? retry : null });
    }
    return { status: response.status, data: payload, requestId: requestIdOut };
  };

  const query = async (sql) => (await request('GET', '/query', { params: { query: sql } })).data?.QueryResponse ?? {};
  // A query whose answer must be a readable QueryResponse (an empty one is `{}`). A missing or unreadable body is an error, never "no rows": the vendor
  // search must not take a broken page for the end of the list.
  const queryStrict = async (sql, realm) => {
    const answer = (await request('GET', '/query', { params: { query: sql }, realm })).data?.QueryResponse;
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new QuickbooksError('QuickBooks sent an answer that could not be read');
    return answer;
  };
  const countActiveVendors = async (realm) => {
    const { totalCount } = await queryStrict('select count(*) from Vendor where Active = true', realm);
    if (!Number.isInteger(totalCount) || totalCount < 0) throw new QuickbooksError('QuickBooks sent an answer that could not be read');
    return totalCount;
  };

  return {
    // The company's name: a read-only call that proves the connection works.
    getCompanyInfo: async () => (await request('GET', `/companyinfo/${encodeURIComponent((await auth()).realmId)}`)).data?.CompanyInfo ?? null,
    // Vendors with exactly this email (read-only). A match is only ever used with the driver's own verified email, never the name.
    // QuickBooks cannot filter vendors by email ("PrimaryEmailAddr is not queryable"), so the active vendors are read page by page and compared here.
    // The answer is trusted only when the whole list was read from ONE company and is consistent: every page readable, no vendor twice, and the number
    // read equal to the company's count before and after. Anything else throws, because a false "none found" would let a second vendor be made and split
    // the driver's 1099 total. The array returned carries `realmId`, the company it was read from: a link or a new vendor must be made in that company.
    findVendorsByEmail: async (email, { realm } = {}) => {
      const wanted = String(email).trim().toLowerCase();
      const realmId = realm ?? (await auth()).realmId;
      const total = await countActiveVendors(realmId);
      if (total > VENDOR_PAGE_LIMIT * VENDOR_PAGE_SIZE) throw new QuickbooksError('QuickBooks has too many vendors to search by email; link the vendor by hand or ask support');
      const seen = new Set();
      const found = [];
      for (let page = 0; page < VENDOR_PAGE_LIMIT; page += 1) {
        const answer = await queryStrict(`select Id, DisplayName, Active, Vendor1099, PrimaryEmailAddr from Vendor where Active = true orderby Id startposition ${page * VENDOR_PAGE_SIZE + 1} maxresults ${VENDOR_PAGE_SIZE}`, realmId);
        if (answer.Vendor !== undefined && !Array.isArray(answer.Vendor)) throw new QuickbooksError('QuickBooks sent an answer that could not be read');
        const rows = answer.Vendor ?? [];
        for (const v of rows) {
          if (v?.Id === undefined || v?.Id === null || seen.has(String(v.Id))) throw new QuickbooksError('QuickBooks vendors changed while they were being read; try again');
          seen.add(String(v.Id));
        }
        found.push(...rows.filter((v) => String(v.PrimaryEmailAddr?.Address ?? '').trim().toLowerCase() === wanted));
        if (rows.length < VENDOR_PAGE_SIZE) break;
      }
      if (seen.size !== total || (await countActiveVendors(realmId)) !== total) throw new QuickbooksError('QuickBooks vendors changed while they were being read; try again');
      return Object.assign(found, { realmId: String(realmId) });
    },
    getVendor: async (id) => (await request('GET', `/vendor/${encodeURIComponent(id)}`)).data?.Vendor ?? null,
    // A 1099 contractor vendor. TaxIdentifier is write-only at QuickBooks and is never kept or logged by NASA. `requestId` makes a retry safe.
    createVendor: async (body, requestId, { realm } = {}) => (await request('POST', '/vendor', { body, requestId, realm })).data?.Vendor,
    // The accounts a bill and its payment need (read-only), so an admin can choose the expense and bank account once.
    listAccounts: async (type) => (await query(`select Id, Name, AccountType, Active from Account where AccountType = ${quoteValue(type)} and Active = true maxresults 200`)).Account ?? [],
    // A bill owed to a vendor, and the payment that settles it. The same requestId again returns the first answer instead of making a second record.
    createBill: async (body, requestId) => (await request('POST', '/bill', { body, requestId })).data?.Bill,
    createBillPayment: async (body, requestId) => (await request('POST', '/billpayment', { body, requestId })).data?.BillPayment,
    // The bill with this document number (the idempotency key), if one exists. Read-only.
    findBillsByDocNumber: async (docNumber) => (await query(`select Id, DocNumber, TotalAmt, Balance, VendorRef from Bill where DocNumber = ${quoteValue(docNumber)} maxresults 5`)).Bill ?? [],
    getBill: async (id) => (await request('GET', `/bill/${encodeURIComponent(id)}`)).data?.Bill ?? null,
  };
};
