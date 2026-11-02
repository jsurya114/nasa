import Constants from "expo-constants";

// Set per build profile in app.config.js (APP_ENV, NASA_WEB_ORIGIN, NASA_API_ORIGIN). Never read from the page.
const extra = Constants.expoConfig?.extra ?? {};

export const APP_ENV = extra.appEnv ?? "development";
export const WEB_ORIGIN = extra.webOrigin;
export const API_ORIGIN = extra.apiOrigin;
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
