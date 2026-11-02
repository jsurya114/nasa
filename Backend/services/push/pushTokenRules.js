// What a phone may send when it registers or removes a push token. Pure checks, no database.

export const PLATFORMS = ['ios', 'android'];
const MAX_APP_VERSION_LENGTH = 32;
const MAX_TOKEN_LENGTH = 200;

// Expo push tokens look like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] (newer ones: ExpoPushToken[...]).
const EXPO_PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/;

export const isExpoPushToken = (value) =>
  typeof value === 'string' && value.length <= MAX_TOKEN_LENGTH && EXPO_PUSH_TOKEN.test(value);

// Returns { token, platform, appVersion } or { error } (a short message safe to show the app).
export const parseRegistration = (body) => {
  const { token, platform, appVersion } = body ?? {};
  if (!isExpoPushToken(token)) return { error: 'A valid push token is required' };
  if (!PLATFORMS.includes(platform)) return { error: 'Platform must be ios or android' };
  if (appVersion !== undefined && appVersion !== null) {
    if (typeof appVersion !== 'string' || appVersion.length > MAX_APP_VERSION_LENGTH) {
      return { error: 'App version is not valid' };
    }
  }
  return { token, platform, appVersion: appVersion ?? null };
};

export const parseRemoval = (body) => {
  const { token } = body ?? {};
  if (!isExpoPushToken(token)) return { error: 'A valid push token is required' };
  return { token };
};
