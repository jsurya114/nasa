import pool from '../../config/db.js';
import logger from '../../utils/logger.js';
import { getReceipts, sendMessages } from './expoPushClient.js';

// Sends one notification to a list of phones. It never throws, and callers never wait for it.

// Nothing is sent unless this is switched on, so a deployment that has not set up push does nothing.
export const isPushEnabled = () => process.env.PUSH_NOTIFICATIONS_ENABLED === 'true';

// Expo asks for receipts to be read at least 15 minutes after sending.
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

// The Expo service reports phones that can no longer receive messages (app removed, token expired).
// Those tokens are deleted so they are never tried again.
const forgetTokens = async (tokens, db) => {
  if (tokens.length === 0) return;
  await db.query('DELETE FROM device_tokens WHERE push_token = ANY($1::text[])', [tokens]);
};

// Best effort: the timer lives in memory, so a restart within the 15 minutes skips this check. A token that
// should have been removed is then removed the next time a message to it fails.
const defaultSchedule = (fn, delayMs) => {
  const timer = setTimeout(fn, delayMs);
  timer.unref?.();
};

const checkReceipts = async (ticketToToken, { receipts, db }) => {
  const found = await receipts([...ticketToToken.keys()]);
  const stale = Object.entries(found)
    .filter(([, receipt]) => receipt.status === 'error' && receipt.error === DEVICE_NOT_REGISTERED)
    .map(([id]) => ticketToToken.get(id));
  await forgetTokens(stale, db);
  if (stale.length > 0) logger.info('Push tokens removed after receipts', { count: stale.length });
};

// recipients: [{ pushToken, language }]. content(language) returns { title, body, screen }.
// `screen` is a name from the app's fixed list, never a URL.
export const deliver = async (recipients, content, deps = {}) => {
  const { send = sendMessages, receipts = getReceipts, db = pool, schedule = defaultSchedule } = deps;
  if (!isPushEnabled() || recipients.length === 0) return { sent: 0 };

  try {
    const messages = recipients.map(({ pushToken, language }) => {
      const { title, body, screen } = content(language);
      return { to: pushToken, title, body, sound: 'default', priority: 'high', channelId: 'default', data: { screen } };
    });
    const results = await send(messages);

    const stale = results.filter((r) => r.status === 'error' && r.error === DEVICE_NOT_REGISTERED).map((r) => r.token);
    await forgetTokens(stale, db);

    const accepted = results.filter((r) => r.status === 'ok');
    const failed = results.filter((r) => r.status === 'error' && r.error !== DEVICE_NOT_REGISTERED);
    logger.info('Push sent', { accepted: accepted.length, failed: failed.length, removed: stale.length });

    if (accepted.length > 0) {
      const ticketToToken = new Map(accepted.map((r) => [r.id, r.token]));
      schedule(() => {
        checkReceipts(ticketToToken, { receipts, db }).catch((error) => logger.warn('Push receipt check failed', error));
      }, RECEIPT_DELAY_MS);
    }
    return { sent: accepted.length };
  } catch (error) {
    logger.error('Push delivery failed', error);
    return { sent: 0 };
  }
};
