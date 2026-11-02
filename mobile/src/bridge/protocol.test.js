// Run with: npm test  (uses Node's built-in test runner, no extra packages)
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IdTracker,
  SUPPORTED_ACTIONS,
  errorReply,
  isHttpsUrl,
  isTrustedOrigin,
  okReply,
  parseMessage,
  replyScript,
} = require("./protocol");

const NONCE = "n".repeat(32);
const message = (over = {}) => JSON.stringify({ v: 1, id: "abc123", nonce: NONCE, action: "session.get", payload: { area: "driver" }, ...over });
const parse = (raw, tracker) => parseMessage(raw, tracker, NONCE);

test("accepts a valid message", () => {
  const result = parse(message(), new IdTracker());
  assert.equal(result.ok, true);
  assert.equal(result.message.action, "session.get");
});

test("refuses malformed input", () => {
  const t = new IdTracker();
  for (const raw of [undefined, "", "not json", "[]", "null", "x".repeat(20001), JSON.stringify({ v: 1 })]) {
    assert.equal(parse(raw, t).ok, false, String(raw).slice(0, 20));
  }
});

test("refuses a bad or missing request id", () => {
  const t = new IdTracker();
  for (const id of [undefined, 5, "", "has space", "a".repeat(65), "<script>"]) {
    assert.equal(parse(message({ id }), t).error, "bad_request");
  }
});

test("refuses other bridge versions", () => {
  assert.equal(parse(message({ v: 2 }), new IdTracker()).error, "unsupported_version");
  assert.equal(parse(message({ v: "1" }), new IdTracker()).error, "unsupported_version");
});

test("refuses actions that are unknown or not implemented in this shell", () => {
  const t = new IdTracker();
  for (const action of ["shell.exec", "eval", "file.share", "media.pickImages", "", 5]) {
    assert.equal(parse(message({ action, id: `id${String(action).length}x${Math.random().toString(36).slice(2)}` }), t).error, "unsupported_action");
  }
});

test("checks every payload", () => {
  const t = new IdTracker();
  const cases = [
    ["session.get", { area: "root" }],
    ["session.get", { area: "driver", extra: 1 }],
    ["session.get", []],
    ["session.set", { area: "admin", accessToken: "a" }],
    ["session.set", { area: "admin", accessToken: "a", refreshToken: "b".repeat(4097) }],
    ["session.set", { area: "admin", accessToken: 5, refreshToken: "b" }],
    ["link.openExternal", { url: "http://example.com" }],
    ["link.openExternal", { url: "javascript:alert(1)" }],
    ["link.openExternal", { url: "https://user@evil.com" }],
    ["app.hello", { bridgeVersions: ["1"] }],
  ];
  cases.forEach(([action, payload], i) => {
    assert.equal(parse(message({ action, payload, id: `case${i}` }), t).error, "bad_request", `${action} ${JSON.stringify(payload)}`);
  });
});

test("accepts good payloads for each implemented action", () => {
  const t = new IdTracker();
  const good = {
    "app.hello": { bridgeVersions: [1] },
    "session.get": { area: "admin" },
    "session.set": { area: "driver", accessToken: "a.b.c", refreshToken: "d.e.f" },
    "session.refresh": { area: "driver" },
    "session.clear": { area: "admin" },
    "link.openExternal": { url: "https://example.com/help" },
  };
  assert.deepEqual(Object.keys(good).sort(), [...SUPPORTED_ACTIONS].sort());
  Object.entries(good).forEach(([action, payload], i) => {
    assert.equal(parse(message({ action, payload, id: `good${i}` }), t).ok, true, action);
  });
});

test("refuses a reused request id", () => {
  const t = new IdTracker();
  assert.equal(parse(message(), t).ok, true);
  assert.equal(parse(message(), t).error, "replayed_id");
});

test("the id memory is bounded", () => {
  const t = new IdTracker(3);
  ["a", "b", "c", "d"].forEach((id) => t.remember(id));
  assert.equal(t.ids.size, 3);
  assert.equal(t.remember("a"), true);
});

test("trusted origin must match exactly", () => {
  const web = "https://app.example.com";
  assert.equal(isTrustedOrigin("https://app.example.com/driver/login?x=1", web), true);
  assert.equal(isTrustedOrigin("HTTPS://APP.EXAMPLE.COM", web), true);
  for (const url of ["http://app.example.com/", "https://app.example.com.evil.com/", "https://evil.com/https://app.example.com", "https://user@app.example.com/", "https://app.example.com:8443/", "about:blank", "", undefined]) {
    assert.equal(isTrustedOrigin(url, web), false, String(url));
  }
});

test("https url check", () => {
  assert.equal(isHttpsUrl("https://example.com"), true);
  assert.equal(isHttpsUrl("http://example.com"), false);
  assert.equal(isHttpsUrl("mailto:a@b.c"), false);
});

test("reply script cannot be broken out of", () => {
  const hostile = errorReply("id1", '"); alert(1); ("');
  const script = replyScript(hostile);
  const detail = script.slice(script.indexOf("detail: ") + 8, script.lastIndexOf(" }"));
  assert.deepEqual(JSON.parse(JSON.parse(detail)), hostile);
  assert.equal(JSON.parse(JSON.parse(detail)).error, '"); alert(1); ("');
  assert.ok(script.endsWith("true;"));
  assert.deepEqual(okReply("x", { a: 1 }), { v: 1, id: "x", ok: true, data: { a: 1 } });
});

test("a message without the page-load nonce gets no answer, whatever it asks", () => {
  const t = new IdTracker();
  for (const nonce of [undefined, "", "wrong", "n".repeat(31), "x".repeat(32), 5, null]) {
    const result = parse(message({ nonce }), t);
    assert.equal(result.ok, false);
    assert.equal(result.error, "untrusted_frame");
    assert.equal(result.id, undefined);
  }
});

test("with no nonce configured every message is refused", () => {
  for (const expected of [undefined, "", "short"]) {
    assert.equal(parseMessage(message(), new IdTracker(), expected).error, "untrusted_frame");
  }
});
