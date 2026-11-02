import logger from '../../utils/logger.js';

// Thin client for Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/).
// It never throws: a failed request becomes an error result for every message in it, so a problem with the
// push service can never reach the code that asked for a notification.

const DEFAULT_API = 'https://exp.host/--/api/v2/push';
export const MAX_MESSAGES_PER_REQUEST = 100;
const REQUEST_TIMEOUT_MS = 10_000;

const apiBase = () => process.env.EXPO_PUSH_API_URL || DEFAULT_API;

const headers = () => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  // Only needed when "enhanced security" is switched on for the Expo project
  ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
});

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const post = async (path, payload, fetchImpl) => {
  const response = await fetchImpl(`${apiBase()}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Expo push service answered ${response.status}`);
  return response.json();
};

// Sends messages in groups of at most 100. Returns one result per message, in the same order:
//   { token, status: 'ok', id }  or  { token, status: 'error', error }
// `error` is Expo's code (for example DeviceNotRegistered) or 'RequestFailed'.
export const sendMessages = async (messages, fetchImpl = fetch) => {
  const results = [];
  for (const group of chunk(messages, MAX_MESSAGES_PER_REQUEST)) {
    try {
      const body = await post('/send', group, fetchImpl);
      const tickets = Array.isArray(body?.data) ? body.data : [];
      group.forEach((message, i) => {
        const ticket = tickets[i];
        if (ticket?.status === 'ok') results.push({ token: message.to, status: 'ok', id: ticket.id });
        else results.push({ token: message.to, status: 'error', error: ticket?.details?.error || 'RequestFailed' });
      });
    } catch (error) {
      logger.warn('Push request failed', { reason: error.name === 'TimeoutError' ? 'timeout' : error.message });
      group.forEach((message) => results.push({ token: message.to, status: 'error', error: 'RequestFailed' }));
    }
  }
  return results;
};

// Delivery receipts for earlier tickets. Returns { ticketId: { status, error? } }, or {} when the request fails.
export const getReceipts = async (ticketIds, fetchImpl = fetch) => {
  const receipts = {};
  for (const group of chunk(ticketIds, MAX_MESSAGES_PER_REQUEST)) {
    try {
      const body = await post('/getReceipts', { ids: group }, fetchImpl);
      for (const [id, receipt] of Object.entries(body?.data ?? {})) {
        receipts[id] = { status: receipt?.status, error: receipt?.details?.error };
      }
    } catch (error) {
      logger.warn('Push receipts request failed', { reason: error.name === 'TimeoutError' ? 'timeout' : error.message });
    }
  }
  return receipts;
};
