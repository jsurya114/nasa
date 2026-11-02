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
      infoPlist: isDevelopment ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {},
    },
    android: {
      package: appId,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      adaptiveIcon: {
        backgroundColor: "#4C2A85",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
    },
    plugins: [
      "expo-secure-store",
      ["expo-notifications", { color: "#4C2A85" }],
      ["expo-build-properties", { android: { usesCleartextTraffic: isDevelopment } }],
      ...(isDevelopment ? [] : [withoutLocalNetworkExceptions]),
    ],
    extra: { appEnv, webOrigin, apiOrigin, ...(easProjectId ? { eas: { projectId: easProjectId } } : {}) },
  },
};
