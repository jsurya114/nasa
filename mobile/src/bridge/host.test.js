const test = require("node:test");
const assert = require("node:assert/strict");
const { createBridgeHost } = require("./host");

const WEB = "https://app.example.com";
const NONCE = "k".repeat(32);
const fakePush = (calls) => ({
  status: async () => { calls.push(["push.status"]); return { available: true, permission: "undetermined", canAskAgain: true }; },
  requestPermission: async () => { calls.push(["push.requestPermission"]); return { available: true, permission: "granted", canAskAgain: true }; },
  getToken: async () => { calls.push(["push.getToken"]); return { token: "ExponentPushToken[abc]", platform: "ios" }; },
  openSettings: async () => { calls.push(["push.openSettings"]); },
  takePendingTap: () => { calls.push(["push.takePendingTap"]); return { screen: "agreement" }; },
});
const setup = (over = {}) => {
  const calls = [];
  const session = {
    get: async (a) => { calls.push(["get", a]); return "access-1"; },
    set: async (a, t) => { calls.push(["set", a, t.refreshToken]); },
    refresh: async (a) => { calls.push(["refresh", a]); return "access-2"; },
    clear: async (a) => { calls.push(["clear", a]); return {}; },
    ...over.session,
  };
  const opened = [];
  const handle = createBridgeHost({ info: { shellVersion: "0.1.0", platform: "ios" }, session, openExternal: async (u) => { opened.push(u); }, webOrigin: WEB, nonce: NONCE, push: over.push === false ? undefined : over.push ?? undefined });
  let n = 0;
  const send = (action, payload, page = `${WEB}/driver/login`) => handle(JSON.stringify({ v: 1, id: `id${++n}`, nonce: NONCE, action, payload }), page);
  return { send, calls, opened, handle };
};

test("hello lists only what this shell can do", async () => {
  const { send } = setup();
  const r = await send("app.hello", { bridgeVersions: [1] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.bridgeVersions, [1]);
  assert.deepEqual(r.data.capabilities, ["session", "openExternal"]);
});

test("session actions reach the session and return only what the page needs", async () => {
  const { send, calls } = setup();
  assert.deepEqual((await send("session.get", { area: "admin" })).data, { accessToken: "access-1" });
  assert.deepEqual((await send("session.refresh", { area: "driver" })).data, { accessToken: "access-2" });
  assert.equal((await send("session.set", { area: "driver", accessToken: "a", refreshToken: "r" })).ok, true);
  assert.equal((await send("session.clear", { area: "driver" })).ok, true);
  assert.deepEqual(calls.map((c) => c[0]), ["get", "refresh", "set", "clear"]);
});

test("a page from another origin gets no answer and nothing runs", async () => {
  const { send, calls } = setup();
  for (const page of ["https://evil.com/", "https://app.example.com.evil.com/", "http://app.example.com/", "about:blank", null, ""]) {
    assert.equal(await send("session.get", { area: "driver" }, page), null);
  }
  assert.equal(calls.length, 0);
});

test("unsupported actions and bad payloads are refused without running anything", async () => {
  const { send, calls } = setup();
  assert.equal((await send("shell.exec", {})).error, "unsupported_action");
  assert.equal((await send("file.share", { path: "/etc/passwd" })).error, "unsupported_action");
  assert.equal((await send("session.get", { area: "root" })).error, "bad_request");
  assert.equal((await send("link.openExternal", { url: "javascript:alert(1)" })).error, "bad_request");
  assert.equal(calls.length, 0);
});

test("the same request id cannot be used twice", async () => {
  const { handle, calls } = setup();
  const raw = JSON.stringify({ v: 1, id: "same", nonce: NONCE, action: "session.get", payload: { area: "driver" } });
  assert.equal((await handle(raw, `${WEB}/`)).ok, true);
  assert.equal((await handle(raw, `${WEB}/`)).error, "replayed_id");
  assert.equal(calls.length, 1);
});

test("errors from the session return a short code, never the message", async () => {
  const boom = Object.assign(new Error("token abc.def.ghi leaked"), { code: "refresh_failed" });
  const odd = new Error("secret https://x/?token=1");
  const { send } = setup({ session: { refresh: async () => { throw boom; }, get: async () => { throw odd; } } });
  assert.deepEqual(await send("session.refresh", { area: "driver" }), { v: 1, id: "id1", ok: false, error: "refresh_failed" });
  const r = await send("session.get", { area: "driver" });
  assert.equal(r.error, "native_error");
  assert.ok(!JSON.stringify(r).includes("secret"));
});

test("external links go to the opener, https only", async () => {
  const { send, opened } = setup();
  assert.equal((await send("link.openExternal", { url: "https://example.com/help" })).ok, true);
  assert.equal((await send("link.openExternal", { url: "http://example.com" })).error, "bad_request");
  assert.deepEqual(opened, ["https://example.com/help"]);
});

test("garbage with no usable id gets no reply", async () => {
  const { handle } = setup();
  assert.equal(await handle("not json", `${WEB}/`), null);
  assert.equal(await handle(JSON.stringify({ v: 1, nonce: NONCE, action: "session.get" }), `${WEB}/`), null);
});

test("a message from a frame that cannot read the nonce is ignored, even on the NASA origin", async () => {
  const { handle, calls } = setup();
  const noNonce = JSON.stringify({ v: 1, id: "f1", action: "session.clear", payload: { area: "driver" } });
  const wrong = JSON.stringify({ v: 1, id: "f2", nonce: "z".repeat(32), action: "session.set", payload: { area: "driver", accessToken: "a", refreshToken: "attacker" } });
  assert.equal(await handle(noNonce, `${WEB}/`), null);
  assert.equal(await handle(wrong, `${WEB}/`), null);
  assert.equal(calls.length, 0);
});

test("push is offered only when the build has it, and its actions are refused otherwise", async () => {
  const without = setup();
  assert.deepEqual((await without.send("app.hello", {})).data.capabilities, ["session", "openExternal"]);
  for (const action of ["push.status", "push.requestPermission", "push.getToken", "push.openSettings", "push.takePendingTap"]) {
    const r = await without.send(action, {});
    assert.deepEqual([r.ok, r.error], [false, "unsupported_action"], action);
  }
  const calls = [];
  const withPush = setup({ push: fakePush(calls) });
  assert.deepEqual((await withPush.send("app.hello", {})).data.capabilities, ["session", "openExternal", "push"]);
});

test("push actions reach the push support and return only what the page needs", async () => {
  const calls = [];
  const { send } = setup({ push: fakePush(calls) });
  assert.deepEqual((await send("push.status", {})).data, { available: true, permission: "undetermined", canAskAgain: true });
  assert.deepEqual((await send("push.requestPermission", {})).data.permission, "granted");
  assert.deepEqual((await send("push.getToken", {})).data, { token: "ExponentPushToken[abc]", platform: "ios" });
  assert.deepEqual((await send("push.takePendingTap", {})).data, { screen: "agreement" });
  assert.deepEqual((await send("push.openSettings", {})).data, {});
  assert.deepEqual(calls.map((c) => c[0]), ["push.status", "push.requestPermission", "push.getToken", "push.takePendingTap", "push.openSettings"]);
});

test("push actions from another origin or without the nonce run nothing", async () => {
  const calls = [];
  const { send, handle } = setup({ push: fakePush(calls) });
  assert.equal(await send("push.getToken", {}, "https://evil.example.com/page"), null);
  assert.equal(await handle(JSON.stringify({ v: 1, id: "no-nonce", action: "push.getToken", payload: {} }), `${WEB}/driver/login`), null);
  assert.deepEqual(calls, []);
});

test("a push failure sends back only a short code", async () => {
  const push = { ...fakePush([]), getToken: async () => { throw Object.assign(new Error("ExponentPushToken[secret] failed at /secret/path"), { code: "permission_denied" }); } };
  const { send } = setup({ push });
  const r = await send("push.getToken", {});
  assert.deepEqual([r.ok, r.error], [false, "permission_denied"]);
  const broken = setup({ push: { ...fakePush([]), status: async () => { throw new Error("leaky message with a token"); } } });
  assert.deepEqual([(await broken.send("push.status", {})).error], ["native_error"]);
});
