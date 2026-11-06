const test = require("node:test");
const assert = require("node:assert/strict");
const { EVENT_HANDLER_NAME, isEvereeUrl, readEvent, shouldLoad } = require("./policy");
const { parseMessage, IdTracker } = require("../bridge/protocol");
const { createBridgeHost } = require("../bridge/host");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("only https addresses on everee.com can be shown in the Everee window", () => {
  for (const ok of ["https://embed.everee.com/s/abc", "https://everee.com/x", "https://a.b.everee.com:443/y?q=1"]) {
    assert.equal(isEvereeUrl(ok), true, ok);
    assert.equal(shouldLoad(ok), true, ok);
  }
  for (const bad of ["http://embed.everee.com/s", "https://everee.com.evil.com/s", "https://noteveree.com/s", "https://evil.com/?https://embed.everee.com", "https://user@embed.everee.com/s", "javascript:alert(1)", "file:///etc/passwd", "intent://x#Intent;end", "mailto:a@b.c", "", null, undefined, 5]) {
    assert.equal(isEvereeUrl(bad), false, String(bad));
    assert.equal(shouldLoad(bad), false, String(bad));
  }
});

test("a message from the Everee page closes the window only when it is a known event with this handler name", () => {
  const msg = (o) => JSON.stringify({ eventHandlerName: EVENT_HANDLER_NAME, ...o });
  assert.equal(readEvent(msg({ eventType: "WORKER_ONBOARDING_COMPLETE" })), "finished");
  assert.equal(readEvent(msg({ eventType: "DISMISS" })), "finished");
  assert.equal(readEvent(msg({ eventType: "DISMISS", error: true, errorCode: "EMB-101" })), "error");
  assert.equal(readEvent(msg({ eventType: "MESSAGE_PORT_REGISTERED" })), "ignore");
  assert.equal(readEvent(JSON.stringify({ eventType: "DISMISS" })), "finished", "no handler name sent is accepted: it is only a close");
  for (const raw of [msg({ eventType: "PAY_NOW" }), msg({ eventType: "DISMISS", eventHandlerName: "other" }), "not json", "[]", "null", '"DISMISS"', "", null, 5, "x".repeat(5000), JSON.stringify({ eventType: 5 })]) {
    assert.equal(readEvent(raw), "ignore", String(raw).slice(0, 30));
  }
});

test("the bridge accepts everee.open only with an https Everee address and nothing else in the payload", () => {
  const nonce = "n".repeat(32);
  const parse = (payload) => parseMessage(JSON.stringify({ v: 1, id: `i${Math.random().toString(36).slice(2)}`, nonce, action: "everee.open", payload }), new IdTracker(), nonce);
  assert.equal(parse({ url: "https://embed.everee.com/s/abc" }).ok, true);
  for (const payload of [{ url: "https://evil.com/s" }, { url: "http://embed.everee.com/s" }, { url: "https://embed.everee.com/s", extra: 1 }, {}, { url: 5 }, { url: "javascript:1" }]) {
    assert.equal(parse(payload).ok, false, JSON.stringify(payload));
  }
});

test("the shell opens the Everee window for the NASA page only, answers with how it ended, and offers the capability only when it can", async () => {
  const WEB = "https://app.example.com";
  const nonce = "k".repeat(32);
  const opened = [];
  const make = (everee) => createBridgeHost({ info: { shellVersion: "0.1.0", platform: "ios" }, session: {}, openExternal: async () => {}, webOrigin: WEB, nonce, everee });
  let n = 0;
  const send = (handle, action, payload, page = `${WEB}/driver/payment-setup`) => handle(JSON.stringify({ v: 1, id: `id${++n}`, nonce, action, payload }), page);

  const withEveree = make({ open: async (url) => { opened.push(url); return { outcome: "finished" }; } });
  assert.deepEqual((await send(withEveree, "app.hello", {})).data.capabilities, ["session", "openExternal", "everee"]);
  assert.deepEqual((await send(withEveree, "everee.open", { url: "https://embed.everee.com/s/abc" })).data, { outcome: "finished" });
  assert.deepEqual(opened, ["https://embed.everee.com/s/abc"]);
  assert.equal(await send(withEveree, "everee.open", { url: "https://embed.everee.com/s/abc" }, "https://evil.com/"), null, "another site gets no answer");
  assert.equal((await send(withEveree, "everee.open", { url: "https://evil.com/s" })).error, "bad_request");
  assert.equal(opened.length, 1);

  const without = make(undefined);
  assert.deepEqual((await send(without, "app.hello", {})).data.capabilities, ["session", "openExternal"]);
  assert.equal((await send(without, "everee.open", { url: "https://embed.everee.com/s/abc" })).error, "unsupported_action");

  const busy = make({ open: async () => { throw Object.assign(new Error("busy"), { code: "busy" }); } });
  assert.equal((await send(busy, "everee.open", { url: "https://embed.everee.com/s/abc" })).error, "busy");
});

test("the Everee window has no bridge, no nonce, no token and no injected script, and the NASA WebView keeps its protections", () => {
  const modal = readFileSync(join(__dirname, "EvereeModal.js"), "utf8");
  for (const forbidden of [/nonce/i, /injectedJavaScript/, /createBridgeHost|bridge\//, /secureStorage|session/, /Linking/]) {
    assert.doesNotMatch(modal.replace(/\/\/.*$/gm, ""), forbidden, String(forbidden));
  }
  assert.match(modal, /onShouldStartLoadWithRequest=\{\(req\) => shouldLoad\(req\.url\)\}/);
  assert.match(modal, /incognito/);
  assert.match(modal, /setSupportMultipleWindows=\{false\}/);
  const app = readFileSync(join(__dirname, "..", "..", "App.js"), "utf8");
  assert.match(app, /onShouldStartLoadWithRequest=\{onShouldStartLoadWithRequest\}/);
  assert.match(app, /injectedJavaScriptBeforeContentLoadedForMainFrameOnly/);
  assert.match(app, /originWhitelist=\{\[WEB_ORIGIN\]\}/);
});
