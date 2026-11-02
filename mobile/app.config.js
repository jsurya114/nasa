const { withInfoPlist } = require("expo/config-plugins");

// Build configuration. Everything that differs between development, preview (staging) and production
// comes from environment variables set by the EAS build profile. No secrets live here.

const ENVIRONMENTS = ["development", "preview", "production"];
const appEnv = process.env.APP_ENV || "development";

if (!ENVIRONMENTS.includes(appEnv)) {
  throw new Error(`APP_ENV must be one of ${ENVIRONMENTS.join(", ")}, got "${appEnv}"`);
}

const webOrigin = process.env.NASA_WEB_ORIGIN || "http://localhost:5173";
const apiOrigin = process.env.NASA_API_ORIGIN || "http://localhost:5001";

// Preview and production builds must talk to HTTPS origins only. Plain http is for local development.
if (appEnv !== "development") {
  for (const [name, value] of [["NASA_WEB_ORIGIN", webOrigin], ["NASA_API_ORIGIN", apiOrigin]]) {
    if (!/^https:\/\/[^/]+$/.test(value)) {
      throw new Error(`${name} must be an https origin without a path for ${appEnv} builds, got "${value}"`);
    }
  }
}

const appId = process.env.NASA_APP_ID || "com.example.nasalogistics";

// Plain http to a computer on the local network is allowed in development builds only. Preview and production
// builds keep both platforms' default of refusing it.
const isDevelopment = appEnv === "development";

// Only what a shipped feature needs (docs/MOBILE_APP_DESIGN.md section 7). iOS needs the camera reason text for the
// "Take Photo" choice in the web form's file picker. Android is deliberately given NO camera permission: the picker
// hands the photo to the system camera app, which needs none, and an app that holds CAMERA would let a page in the
// WebView start the camera by itself (react-native-webview grants a page's request when the app has the permission).
// The storage and overlay permissions below are added by default but nothing here uses them; the vibration permission
// stays because notifications use it.
const CAMERA_REASON = "NASA Logistics uses the camera only when you choose to take a photo of an access code or gate for a delivery.";
const UNUSED_ANDROID_PERMISSIONS = [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
];

// The development client adds local-network entries to the iOS settings. Release builds have no use for them and an
// app review would ask why they are there, so they are removed outside development.
const withoutDevelopmentOnlyEntries = (config) =>
  withInfoPlist(config, (c) => {
    delete c.modResults.NSLocalNetworkUsageDescription;
    delete c.modResults.NSBonjourServices;
    return c;
  });

// Push notifications need the Expo project that owns the push credentials. It is created by the owner's Expo account
// (`eas init`); until then push reports itself unavailable and everything else works. The Firebase file for Android
// push is passed as a path (an EAS secret file) and is never committed.
const easProjectId = process.env.EAS_PROJECT_ID;
const googleServicesFile = process.env.GOOGLE_SERVICES_FILE;

module.exports = {
  expo: {
    name: appEnv === "production" ? "NASA Logistics" : `NASA Logistics (${appEnv})`,
    slug: "nasa-logistics",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: false,
      bundleIdentifier: appId,
      infoPlist: {
        NSCameraUsageDescription: CAMERA_REASON,
        ...(isDevelopment ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
      },
    },
    android: {
      package: appId,
      blockedPermissions: UNUSED_ANDROID_PERMISSIONS,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      adaptiveIcon: {
        backgroundColor: "#4C2A85",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
    },
    plugins: [
      // No biometric unlock in the first release (decision of 2 Nov 2026), so no Face ID permission text either
      ["expo-secure-store", { faceIDPermission: false }],
      ["expo-notifications", { color: "#4C2A85" }],
      ["expo-build-properties", { android: { usesCleartextTraffic: isDevelopment } }],
      ...(isDevelopment ? [] : [withoutDevelopmentOnlyEntries]),
    ],
    extra: { appEnv, webOrigin, apiOrigin, ...(easProjectId ? { eas: { projectId: easProjectId } } : {}) },
  },
};
