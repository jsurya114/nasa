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
  assert.deepEqual(config.ios.infoPlist, { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } });
});

for (const appEnv of ["preview", "production"]) {
  test(`${appEnv} builds refuse cleartext traffic on both platforms`, () => {
    const config = loadConfig({ APP_ENV: appEnv, ...HTTPS_ORIGINS });
    assert.equal(cleartextSetting(config), false);
    assert.deepEqual(config.ios.infoPlist, {});
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
