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
