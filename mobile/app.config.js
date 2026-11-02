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

module.exports = {
  expo: {
    name: appEnv === "production" ? "NASA Logistics" : `NASA Logistics (${appEnv})`,
    slug: "nasa-logistics",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: { supportsTablet: false, bundleIdentifier: appId },
    android: {
      package: appId,
      adaptiveIcon: {
        backgroundColor: "#4C2A85",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
    },
    plugins: ["expo-secure-store"],
    extra: { appEnv, webOrigin, apiOrigin },
  },
};
