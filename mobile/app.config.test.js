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

// The config object only says what is passed in; the native template and the development client add entries of their
// own. These tests generate the real iOS project (no install, no build) and read the Info.plist that comes out.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const generatedInfoPlist = (env) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nasa-prebuild-"));
  try {
    for (const entry of fs.readdirSync(__dirname)) {
      if (["node_modules", "ios", "android"].includes(entry)) continue;
      fs.cpSync(path.join(__dirname, entry), path.join(dir, entry), { recursive: true });
    }
    fs.symlinkSync(path.join(__dirname, "node_modules"), path.join(dir, "node_modules"));
    execFileSync("npx", ["expo", "prebuild", "--platform", "ios", "--no-install"], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const iosDir = path.join(dir, "ios");
    const project = fs.readdirSync(iosDir).find((name) => fs.existsSync(path.join(iosDir, name, "Info.plist")));
    return fs.readFileSync(path.join(iosDir, project, "Info.plist"), "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const LOCAL_NETWORK_KEYS = ["NSAllowsLocalNetworking", "NSLocalNetworkUsageDescription", "NSBonjourServices"];

test("the generated development Info.plist allows local networking", { timeout: 180000 }, () => {
  const plist = generatedInfoPlist({ APP_ENV: "development" });
  assert.match(plist, /NSAllowsLocalNetworking/);
});

for (const appEnv of ["preview", "production"]) {
  test(`the generated ${appEnv} Info.plist carries no local-network exception`, { timeout: 180000 }, () => {
    const plist = generatedInfoPlist({ APP_ENV: appEnv, ...HTTPS_ORIGINS });
    for (const key of LOCAL_NETWORK_KEYS) assert.doesNotMatch(plist, new RegExp(key), `${key} is in the ${appEnv} plist`);
    assert.match(plist, /NSAllowsArbitraryLoads<\/key>\s*<false\/>/);
  });
}
