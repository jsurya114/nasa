const test = require("node:test");
const assert = require("node:assert/strict");
const { createSession, keyFor } = require("./session");

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: async (k) => data[k] ?? null, setItem: async (k, v) => { data[k] = v; }, deleteItem: async (k) => { delete data[k]; } };
};

// A fake server: refresh tokens are single use and rotate; logout needs a valid access token.
const fakeServer = () => {
  const log = [];
  const valid = new Set(["r1"]);
  let n = 1;
  const request = async (path, { token, body } = {}) => {
    log.push(path);
    if (path.endsWith("/refresh-token")) {
      if (!valid.has(body.refreshToken)) return { status: 401, data: {} };
      valid.delete(body.refreshToken);
      n += 1;
      valid.add(`r${n}`);
      return { status: 200, data: { accessToken: `a${n}`, refreshToken: `r${n}` } };
    }
    if (path.endsWith("/logout")) {
      if (!token) return { status: 401, data: {} };
      valid.delete(body.refreshToken);
      return { status: 200, data: {} };
    }
    return { status: 404, data: {} };
  };
  return { request, log, valid };
};

test("set keeps the refresh token in secure storage and the access token for get", async () => {
  const storage = memoryStorage();
  const s = createSession({ storage, request: fakeServer().request });
  await s.set("driver", { accessToken: "a1", refreshToken: "r1" });
  assert.equal(storage.data[keyFor("driver")], "r1");
  assert.equal(await s.get("driver"), "a1");
  assert.equal(await s.get("admin"), null);
});

test("get after a restart refreshes from the stored token", async () => {
  const storage = memoryStorage({ [keyFor("driver")]: "r1" });
  const server = fakeServer();
  const s = createSession({ storage, request: server.request });
  assert.equal(await s.get("driver"), "a2");
  assert.equal(storage.data[keyFor("driver")], "r2");
});

test("refresh rotates the stored token, and simultaneous calls share one", async () => {
  const storage = memoryStorage({ [keyFor("driver")]: "r1" });
  const server = fakeServer();
  const s = createSession({ storage, request: server.request });
  const results = await Promise.all([s.refresh("driver"), s.refresh("driver"), s.refresh("driver")]);
  assert.deepEqual(results, ["a2", "a2", "a2"]);
  assert.equal(server.log.length, 1);
});

test("a refused refresh token ends the session and wipes it", async () => {
  const storage = memoryStorage({ [keyFor("admin")]: "revoked" });
  const s = createSession({ storage, request: fakeServer().request });
  await assert.rejects(s.refresh("admin"), { code: "refresh_failed" });
  assert.equal(storage.data[keyFor("admin")], undefined);
  assert.equal(await s.get("admin"), null);
});

test("no connection keeps the session and does not sign anyone out", async () => {
  const storage = memoryStorage({ [keyFor("driver")]: "r1" });
  const s = createSession({ storage, request: async () => { throw new Error("offline"); } });
  await assert.rejects(s.refresh("driver"), { code: "network_error" });
  assert.equal(storage.data[keyFor("driver")], "r1");
  assert.equal(await s.get("driver"), null);
});

test("refresh without a stored session says so", async () => {
  const s = createSession({ storage: memoryStorage(), request: fakeServer().request });
  await assert.rejects(s.refresh("driver"), { code: "no_session" });
});

test("clear wipes storage before it talks to the server, and revokes the token", async () => {
  const storage = memoryStorage({ [keyFor("driver")]: "r1" });
  const server = fakeServer();
  let wipedBeforeNetwork = null;
  const request = async (path, opts) => { if (wipedBeforeNetwork === null) wipedBeforeNetwork = storage.data[keyFor("driver")] === undefined; return server.request(path, opts); };
  const s = createSession({ storage, request });
  const { revocation } = await s.clear("driver");
  assert.equal(storage.data[keyFor("driver")], undefined);
  assert.equal(await revocation, true);
  assert.equal(wipedBeforeNetwork, true);
  assert.equal(server.valid.has("r1"), false);
  assert.equal([...server.valid].length, 0);
});

test("clear still signs out when the server cannot be reached", async () => {
  const storage = memoryStorage({ [keyFor("driver")]: "r1" });
  const s = createSession({ storage, request: async () => { throw new Error("offline"); } });
  const { revocation } = await s.clear("driver");
  assert.equal(await revocation, false);
  assert.equal(storage.data[keyFor("driver")], undefined);
  assert.equal(await s.get("driver"), null);
});

test("signing out while a refresh is running drops its result", async () => {
  const storage = memoryStorage({ [keyFor("driver")]: "r1" });
  const server = fakeServer();
  let release;
  const gate = new Promise((r) => { release = r; });
  const request = async (path, opts) => { if (path.endsWith("/refresh-token") && !release.used) { release.used = true; await gate; } return server.request(path, opts); };
  const s = createSession({ storage, request });
  const pending = s.refresh("driver");
  await new Promise((r) => setImmediate(r));
  await s.clear("driver");
  release();
  await assert.rejects(pending, { code: "signed_out" });
  assert.equal(await s.get("driver"), null);
  assert.equal(storage.data[keyFor("driver")], undefined);
});

test("an unknown area is refused", async () => {
  const s = createSession({ storage: memoryStorage(), request: fakeServer().request });
  await assert.rejects(s.get("root"), { code: "bad_request" });
});

// ---- Ordering across the asynchronous secure-storage boundary (Jasil's review of #127)

// Storage whose writes and deletes can be held back and released by hand, to force the bad orderings.
const controlledStorage = (initial = {}) => {
  const data = { ...initial };
  const holds = { setItem: null, deleteItem: null };
  const gate = (op) => {
    const hold = holds[op];
    if (!hold) return Promise.resolve();
    return new Promise((resolve) => { hold.waiting.push(resolve); hold.started?.(); });
  };
  return {
    data,
    // hold the next call(s) of an operation; returns { release(), started } controls
    hold(op) {
      let signal;
      const started = new Promise((r) => { signal = r; });
      holds[op] = { waiting: [], started: signal };
      return {
        started,
        release() { const h = holds[op]; holds[op] = null; h.waiting.forEach((r) => r()); },
      };
    },
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => { await gate("setItem"); data[k] = v; },
    deleteItem: async (k) => { await gate("deleteItem"); delete data[k]; },
  };
};

const settle = () => new Promise((r) => setImmediate(r));

test("a refresh write that finishes after sign-out cannot bring the session back", async () => {
  const storage = controlledStorage({ [keyFor("driver")]: "r1" });
  const s = createSession({ storage, request: fakeServer().request });
  const held = storage.hold("setItem");
  const refreshing = s.refresh("driver");
  const outcome = refreshing.then(() => "resolved", (e) => e.code);
  await held.started; // the rotated token is being written
  const clearing = s.clear("driver");
  await settle();
  held.release();
  await clearing;
  assert.equal(await outcome, "signed_out");
  assert.equal(storage.data[keyFor("driver")], undefined);
  assert.equal(await s.get("driver"), null);
});

test("a sign-in write that finishes after sign-out cannot bring the session back", async () => {
  const storage = controlledStorage();
  const s = createSession({ storage, request: fakeServer().request });
  const held = storage.hold("setItem");
  const signingIn = s.set("driver", { accessToken: "a1", refreshToken: "r1" });
  await held.started;
  const clearing = s.clear("driver");
  await settle();
  held.release();
  await signingIn;
  await clearing;
  assert.equal(storage.data[keyFor("driver")], undefined);
  assert.equal(await s.get("driver"), null);
});

test("a later sign-in survives a slow earlier sign-out", async () => {
  const storage = controlledStorage({ [keyFor("driver")]: "r1" });
  const s = createSession({ storage, request: fakeServer().request });
  const held = storage.hold("deleteItem");
  const clearing = s.clear("driver");
  await held.started; // the old token is being deleted
  const signingIn = s.set("driver", { accessToken: "new-access", refreshToken: "new-refresh" });
  await settle();
  held.release();
  await clearing;
  await signingIn;
  assert.equal(storage.data[keyFor("driver")], "new-refresh");
  assert.equal(await s.get("driver"), "new-access");
});

test("two quick sign-ins end with the newer one, however the writes finish", async () => {
  const storage = controlledStorage();
  const s = createSession({ storage, request: fakeServer().request });
  const held = storage.hold("setItem");
  const first = s.set("driver", { accessToken: "a-old", refreshToken: "r-old" });
  await held.started;
  const second = s.set("driver", { accessToken: "a-new", refreshToken: "r-new" });
  await settle();
  held.release();
  await first;
  await second;
  assert.equal(storage.data[keyFor("driver")], "r-new");
  assert.equal(await s.get("driver"), "a-new");
});

test("one area's slow write does not hold up or disturb the other area", async () => {
  const storage = controlledStorage();
  const s = createSession({ storage, request: fakeServer().request });
  const held = storage.hold("setItem");
  const driver = s.set("driver", { accessToken: "da", refreshToken: "dr" });
  await held.started;
  const admin = s.set("admin", { accessToken: "aa", refreshToken: "ar" });
  await settle();
  held.release();
  await Promise.all([driver, admin]);
  assert.equal(storage.data[keyFor("driver")], "dr");
  assert.equal(storage.data[keyFor("admin")], "ar");
});

test("a refused-token cleanup that runs after a new sign-in is dropped", async () => {
  const storage = controlledStorage({ [keyFor("driver")]: "revoked" });
  const s = createSession({ storage, request: fakeServer().request });
  const held = storage.hold("deleteItem");
  const refreshing = s.refresh("driver");
  const outcome = refreshing.then(() => "resolved", (e) => e.code);
  await held.started; // cleaning up the refused token
  const signingIn = s.set("driver", { accessToken: "a-new", refreshToken: "r-new" });
  await settle();
  held.release();
  await signingIn;
  await outcome;
  assert.equal(storage.data[keyFor("driver")], "r-new");
});
