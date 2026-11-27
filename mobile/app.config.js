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
const easProjectIdSetting = process.env.EAS_PROJECT_ID;

// Nothing with a placeholder identity or placeholder artwork may reach testers or the stores. The bundle ID cannot be
// changed after the first store release, so preview (TestFlight, internal) and production both need the real one.
// Production also needs the Expo project (push) and NASA's own icon and splash, not Expo's template images.
// NASA_ASSETS_DIR may point at a folder with NASA's approved artwork (same file names), instead of ./assets.
const assets = (process.env.NASA_ASSETS_DIR || "./assets").replace(/\/$/, "");
const PLACEHOLDER_ARTWORK = {
  "icon.png": "119462bb78eb240a65c869fc067ee599639b3cb5a41953f25c07b17d2a8c7e0f",
  "splash-icon.png": "5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8",
  "android-icon-foreground.png": "9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceb7240b391",
};
if (appEnv !== "development") {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/i.test(appId) || /^com\.example\./i.test(appId)) {
    throw new Error(`NASA_APP_ID must be NASA's real reverse-domain bundle ID for ${appEnv} builds, got "${appId}"`);
  }
}
if (appEnv === "production") {
  if (!easProjectIdSetting) throw new Error("EAS_PROJECT_ID must be set for production builds (push notifications need it)");
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const { isAbsolute, join } = require("node:path");
  for (const [file, placeholder] of Object.entries(PLACEHOLDER_ARTWORK)) {
    const hash = createHash("sha256").update(readFileSync(isAbsolute(assets) ? join(assets, file) : join(__dirname, assets, file))).digest("hex");
    if (hash === placeholder) throw new Error(`${assets}/${file} is still Expo's placeholder; production builds need NASA's approved artwork`);
  }
}

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

// The native iOS template itself ships NSAllowsLocalNetworking, and the development client adds its local-network
// and Bonjour entries, so leaving the setting out of `infoPlist` is not enough: the generated Info.plist keeps them.
// Outside development they are removed from the generated file, leaving iOS's default of refusing plain http.
const withoutLocalNetworkExceptions = (config) =>
  withInfoPlist(config, (c) => {
    if (c.modResults.NSAppTransportSecurity) delete c.modResults.NSAppTransportSecurity.NSAllowsLocalNetworking;
    delete c.modResults.NSLocalNetworkUsageDescription;
    delete c.modResults.NSBonjourServices;
    return c;
  });

// Push notifications need the Expo project that owns the push credentials. It is created by the owner's Expo account
// (`eas init`); until then push reports itself unavailable and everything else works. The Firebase file for Android
// push is passed as a path (an EAS secret file) and is never committed.
const easProjectId = easProjectIdSetting;
const googleServicesFile = process.env.GOOGLE_SERVICES_FILE;

module.exports = {
  expo: {
    name: appEnv === "production" ? "NASA Logistics" : `NASA Logistics (${appEnv})`,
    slug: "nasa-logistics",
    version: "0.1.0",
    orientation: "portrait",
    icon: `${assets}/icon.png`,
    userInterfaceStyle: "light",
    splash: { image: `${assets}/splash-icon.png`, resizeMode: "contain", backgroundColor: "#4C2A85" },
    ios: {
      supportsTablet: false,
      bundleIdentifier: appId,
      // The app has no tracking and no tracking domains. Required-reason API entries come from each SDK's own
      // privacy manifest, merged by the build; none are copied in by hand here.
      privacyManifests: { NSPrivacyTracking: false, NSPrivacyTrackingDomains: [] },
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
        foregroundImage: `${assets}/android-icon-foreground.png`,
        backgroundImage: `${assets}/android-icon-background.png`,
        monochromeImage: `${assets}/android-icon-monochrome.png`,
      },
    },
    plugins: [
      // No biometric unlock in the first release (decision of 2 Nov 2026), so no Face ID permission text either
      ["expo-secure-store", { faceIDPermission: false }],
      ["expo-notifications", { color: "#4C2A85" }],
      ["expo-build-properties", { android: { usesCleartextTraffic: isDevelopment } }],
      ...(isDevelopment ? [] : [withoutLocalNetworkExceptions]),
    ],
    extra: { appEnv, webOrigin, apiOrigin, ...(easProjectId ? { eas: { projectId: easProjectId } } : {}) },
  },
};
