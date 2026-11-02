const test = require("node:test");
const assert = require("node:assert/strict");
const { ANDROID_CHANNEL, SCREENS, createPush, screenFromResponse } = require("./push");

const tapOn = (screen) => ({ notification: { request: { content: { data: { screen } } } } });

const setup = (over = {}) => {
  const calls = [];
  const permissionState = { status: "undetermined", canAskAgain: true, ...over.permission };
  const notifications = {
    AndroidImportance: { HIGH: 4 },
    getPermissionsAsync: async () => ({ ...permissionState }),
    requestPermissionsAsync: async (options) => {
      calls.push(["request", options]);
      Object.assign(permissionState, over.answer ?? { status: "granted", canAskAgain: true });
      return { ...permissionState };
    },
    setNotificationChannelAsync: async (id, channel) => { calls.push(["channel", id, channel.name]); },
    getExpoPushTokenAsync: async (options) => {
      calls.push(["token", options]);
      if (over.tokenError) throw over.tokenError;
      return { type: "expo", data: over.tokenData ?? "ExponentPushToken[abcdefghij]" };
    },
  };
  const push = createPush({
    notifications,
    isDevice: over.isDevice ?? true,
    projectId: "projectId" in over ? over.projectId : "project-1",
    platform: over.platform ?? "ios",
    openSettings: async () => { calls.push(["settings"]); },
  });
  return { push, calls };
};

test("status reports permission and whether this phone can get a token at all", async () => {
  assert.deepEqual(await setup().push.status(), { available: true, permission: "undetermined", canAskAgain: true });
  assert.equal((await setup({ isDevice: false }).push.status()).available, false);
  assert.equal((await setup({ projectId: undefined }).push.status()).available, false);
  assert.equal((await setup({ permission: { status: "weird" } }).push.status()).permission, "undetermined");
});

test("the system prompt is shown only when permission has not been decided", async () => {
  const fresh = setup();
  assert.equal((await fresh.push.requestPermission()).permission, "granted");
  assert.equal(fresh.calls.filter((c) => c[0] === "request").length, 1);
  assert.deepEqual(fresh.calls[0][1], { ios: { allowAlert: true, allowBadge: false, allowSound: true } });

  const already = setup({ permission: { status: "granted" } });
  assert.equal((await already.push.requestPermission()).permission, "granted");
  assert.equal(already.calls.length, 0, "no prompt when already granted");

  const refused = setup({ permission: { status: "denied", canAskAgain: false } });
  assert.deepEqual(await refused.push.requestPermission(), { available: true, permission: "denied", canAskAgain: false });
  assert.equal(refused.calls.length, 0, "no prompt when the system will not ask again");

  const retry = setup({ permission: { status: "denied", canAskAgain: true }, answer: { status: "denied", canAskAgain: false } });
  assert.equal((await retry.push.requestPermission()).canAskAgain, false);
  assert.equal(retry.calls.filter((c) => c[0] === "request").length, 1);
});

test("a token needs a real device, an Expo project and granted permission", async () => {
  await assert.rejects(setup({ isDevice: false, permission: { status: "granted" } }).push.getToken(), { code: "push_unavailable" });
  await assert.rejects(setup({ projectId: "", permission: { status: "granted" } }).push.getToken(), { code: "push_unavailable" });
  await assert.rejects(setup({ permission: { status: "denied" } }).push.getToken(), { code: "permission_denied" });
  await assert.rejects(setup({ permission: { status: "undetermined" } }).push.getToken(), { code: "permission_denied" });
});

test("the token comes from the configured project, and Android gets its channel first", async () => {
  const android = setup({ permission: { status: "granted" }, platform: "android" });
  assert.deepEqual(await android.push.getToken(), { token: "ExponentPushToken[abcdefghij]", platform: "android" });
  assert.deepEqual(android.calls.map((c) => c[0]), ["channel", "token"]);
  assert.equal(android.calls[0][1], ANDROID_CHANNEL);
  assert.deepEqual(android.calls[1][1], { projectId: "project-1" });
  assert.equal(android.push.lastToken(), "ExponentPushToken[abcdefghij]");

  const ios = setup({ permission: { status: "granted" }, platform: "ios" });
  await ios.push.getToken();
  assert.deepEqual(ios.calls.map((c) => c[0]), ["token"], "no channel on iOS");
});

test("a failing token request or an empty token becomes one short code with no detail", async () => {
  const broken = setup({ permission: { status: "granted" }, tokenError: new Error("FCM said: secret detail") });
  await assert.rejects(broken.push.getToken(), (e) => e.code === "token_failed" && e.message === "token_failed");
  await assert.rejects(setup({ permission: { status: "granted" }, tokenData: "" }).push.getToken(), { code: "token_failed" });
});

test("only a screen on the fixed list is accepted from a tapped notification", () => {
  for (const screen of SCREENS) assert.equal(screenFromResponse(tapOn(screen)), screen);
  for (const bad of ["https://evil.example.com", "/admin/dashboard", "../../x", "Availability", "", 5, null, undefined, ["agreement"], { a: 1 }]) {
    assert.equal(screenFromResponse(tapOn(bad)), null, String(bad));
  }
  for (const odd of [undefined, null, {}, { notification: null }, { notification: { request: {} } }]) {
    assert.equal(screenFromResponse(odd), null);
  }
});

test("a tap is kept until the page collects it, once", () => {
  const { push } = setup();
  assert.deepEqual(push.takePendingTap(), { screen: null });
  assert.equal(push.recordTap(tapOn("deliveries")), "deliveries");
  assert.equal(push.recordTap(tapOn("https://evil.example.com")), null, "a bad tap does not replace anything");
  assert.deepEqual(push.takePendingTap(), { screen: "deliveries" });
  assert.deepEqual(push.takePendingTap(), { screen: null }, "collected only once");
});

test("opening settings goes to the phone's settings", async () => {
  const { push, calls } = setup();
  await push.openSettings();
  assert.deepEqual(calls, [["settings"]]);
});
