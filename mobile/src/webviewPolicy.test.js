const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// The WebView shows only NASA's own pages, but a page must still never be able to start the camera or microphone by
// itself (for example after a cross-site scripting mistake). The file picker's "take a photo" choice is separate and
// does not depend on these settings. These checks keep the controls from being removed by accident.
const app = readFileSync(join(__dirname, "..", "App.js"), "utf8");

test("iOS denies every camera and microphone request from a page", () => {
  assert.match(app, /mediaCapturePermissionGrantType="deny"/);
});

test("the app never declares the Android camera or microphone permission, so a page cannot be granted them", () => {
  const config = readFileSync(join(__dirname, "..", "app.config.js"), "utf8");
  assert.doesNotMatch(config, /android\.permission\.(CAMERA|RECORD_AUDIO)"\s*[\],]/);
  assert.doesNotMatch(config, /permissions:\s*\[/);
});
