// The shell's push notification support (docs/MOBILE_APP_DESIGN.md, section 10). No React Native imports:
// expo-notifications, the device check and the settings opener are passed in, so these rules run in Node tests.

// Where a notification may send the person. The server names one of these; a tap never carries a URL. The web app
// maps the name to its own route and its sign-in and role checks decide whether it is shown.
const SCREENS = ["availability", "deliveries", "agreement", "access-codes"];

// The server puts this channel id on every message. Android needs the channel to exist before a message arrives.
const ANDROID_CHANNEL = "default";

const PERMISSIONS = ["granted", "denied", "undetermined"];

const fail = (code) => Object.assign(new Error(code), { code });

const permissionOf = (response) => ({
  permission: PERMISSIONS.includes(response?.status) ? response.status : "undetermined",
  canAskAgain: response?.canAskAgain !== false,
});

// The screen name in a tapped notification, or null if it is missing or not on the list.
const screenFromResponse = (response) => {
  const screen = response?.notification?.request?.content?.data?.screen;
  return typeof screen === "string" && SCREENS.includes(screen) ? screen : null;
};

// notifications: expo-notifications. isDevice: false on a simulator or emulator, which cannot get a push token.
// projectId: the Expo project that owns the push credentials (EAS). platform: "ios" or "android".
const createPush = ({ notifications, isDevice, projectId, platform, openSettings }) => {
  const available = Boolean(isDevice && projectId);
  let token = null;
  let pendingScreen = null;

  const permission = async () => permissionOf(await notifications.getPermissionsAsync());

  const status = async () => ({ available, ...(await permission()) });

  // Asks the system for permission, once. If the person already said no and the system will not ask again, this just
  // reports the state; the app stays usable and the person can open the phone's settings instead.
  const requestPermission = async () => {
    const current = await permission();
    if (current.permission === "undetermined" || (current.permission === "denied" && current.canAskAgain)) {
      const answer = permissionOf(
        await notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } })
      );
      return { available, ...answer };
    }
    return { available, ...current };
  };

  // The Expo push token of this phone. Needs permission, a real device and an Expo project.
  const getToken = async () => {
    if (!available) throw fail("push_unavailable");
    if ((await permission()).permission !== "granted") throw fail("permission_denied");
    try {
      if (platform === "android") {
        await notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
          name: "NASA Logistics",
          importance: notifications.AndroidImportance.HIGH,
        });
      }
      const result = await notifications.getExpoPushTokenAsync({ projectId });
      if (typeof result?.data !== "string" || result.data.length === 0) throw new Error("no token");
      token = result.data;
      return { token, platform };
    } catch (error) {
      if (error?.code === "push_unavailable") throw error;
      throw fail("token_failed");
    }
  };

  // Remembers which screen a tapped notification asked for. The web app collects it with takePendingTap, so the
  // answer travels through the checked bridge like every other action.
  const recordTap = (response) => {
    const screen = screenFromResponse(response);
    if (screen) pendingScreen = screen;
    return screen;
  };

  const takePendingTap = () => {
    const screen = pendingScreen;
    pendingScreen = null;
    return { screen };
  };

  return {
    available,
    status,
    requestPermission,
    getToken,
    recordTap,
    takePendingTap,
    openSettings: async () => openSettings(),
    lastToken: () => token,
  };
};

module.exports = { ANDROID_CHANNEL, SCREENS, createPush, screenFromResponse };
