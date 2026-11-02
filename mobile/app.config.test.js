const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const HTTPS_ORIGINS = { NASA_WEB_ORIGIN: "https://app.example.com", NASA_API_ORIGIN: "https://api.example.com" };

// app.config.js reads process.env when it loads, so each case runs it in a fresh process.
const loadConfig = (env) =>
  JSON.parse(
    execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(require('./app.config.js').expo))"], {
      cwd: __dirname,
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    }).toString()
  );

const cleartextSetting = (config) => {
  const plugin = config.plugins.find((p) => Array.isArray(p) && p[0] === "expo-build-properties");
  return plugin[1].android.usesCleartextTraffic;
};

test("development builds allow plain http to the local network on both platforms", () => {
  const config = loadConfig({ APP_ENV: "development" });
  assert.equal(cleartextSetting(config), true);
  assert.deepEqual(config.ios.infoPlist.NSAppTransportSecurity, { NSAllowsLocalNetworking: true });
});

for (const appEnv of ["preview", "production"]) {
  test(`${appEnv} builds refuse cleartext traffic on both platforms`, () => {
    const config = loadConfig({ APP_ENV: appEnv, ...HTTPS_ORIGINS });
    assert.equal(cleartextSetting(config), false);
    assert.equal(config.ios.infoPlist.NSAppTransportSecurity, undefined);
  });

  test(`${appEnv} builds stop on an http origin`, () => {
    assert.throws(() => loadConfig({ APP_ENV: appEnv, ...HTTPS_ORIGINS, NASA_WEB_ORIGIN: "http://app.example.com" }));
  });
}

test("an unknown APP_ENV stops the build", () => {
  assert.throws(() => loadConfig({ APP_ENV: "staging" }));
});

test("only production is named without its environment", () => {
  assert.equal(loadConfig({ APP_ENV: "production", ...HTTPS_ORIGINS }).name, "NASA Logistics");
  assert.equal(loadConfig({ APP_ENV: "preview", ...HTTPS_ORIGINS }).name, "NASA Logistics (preview)");
});

const pluginOptions = (config, name) => config.plugins.find((p) => Array.isArray(p) && p[0] === name)?.[1];

test("only the camera is requested, with a plain reason, and unused Android permissions are blocked", () => {
  for (const env of [{ APP_ENV: "development" }, { APP_ENV: "production", ...HTTPS_ORIGINS }]) {
    const config = loadConfig(env);
    assert.deepEqual(config.android.permissions, ["android.permission.CAMERA"]);
    assert.deepEqual(
      [...config.android.blockedPermissions].sort(),
      ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.WRITE_EXTERNAL_STORAGE"]
    );
    assert.match(config.ios.infoPlist.NSCameraUsageDescription, /camera/i);
    assert.deepEqual(Object.keys(config.ios.infoPlist).filter((k) => k.endsWith("UsageDescription")), ["NSCameraUsageDescription"]);
  }
});

test("there is no Face ID text, because biometric unlock is out of the first release", () => {
  for (const env of [{ APP_ENV: "development" }, { APP_ENV: "production", ...HTTPS_ORIGINS }]) {
    assert.equal(pluginOptions(loadConfig(env), "expo-secure-store").faceIDPermission, false);
  }
});

test("the development client's local-network entries are removed from preview and production builds only", () => {
  // Functions do not survive JSON, so the plugin list is read as the number of entries that were not arrays or strings
  const inline = (env) => execFileSync(process.execPath, ["-e", "const p=require('./app.config.js').expo.plugins;process.stdout.write(String(p.filter((x)=>typeof x==='function').length))"], { cwd: __dirname, env: { PATH: process.env.PATH, ...env } }).toString();
  assert.equal(inline({ APP_ENV: "development" }), "0");
  assert.equal(inline({ APP_ENV: "preview", ...HTTPS_ORIGINS }), "1");
  assert.equal(inline({ APP_ENV: "production", ...HTTPS_ORIGINS }), "1");
});
