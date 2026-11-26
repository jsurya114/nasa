const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_FILE_BYTES, SHARE_FOLDER, cleanName, createDocuments } = require("./documents");

// A fake file system that records what exists, and a fake share sheet.
const fakeFiles = () => {
  const present = new Set();
  const log = [];
  return {
    present,
    log,
    folder: (name) => ({
      create: async () => { log.push(["mkdir", name]); },
      delete: async () => { log.push(["rmdir", name]); for (const p of [...present]) if (p.startsWith(`${name}/`)) present.delete(p); },
      file: (file) => ({
        uri: `file:///cache/${name}/${file}`,
        write: async (data) => { log.push(["write", file, data.length]); present.add(`${name}/${file}`); },
        delete: async () => { present.delete(`${name}/${file}`); },
      }),
    }),
  };
};
const PDF = Buffer.from("%PDF-1.7 made up").toString("base64");

test("file names are cleaned and always carry the type's own extension", () => {
  assert.equal(cleanName("Invoice NASA-0042.pdf", "application/pdf"), "Invoice NASA-0042.pdf");
  assert.equal(cleanName("../../etc/passwd", "application/pdf"), "etc-passwd.pdf");
  assert.equal(cleanName("report.exe", "text/csv"), "report.csv");
  assert.equal(cleanName("", "application/pdf"), "nasa-document.pdf");
  assert.ok(cleanName("x".repeat(500), "application/pdf").length <= 120);
});

test("a PDF is written to the app's cache, shown in the share sheet, and deleted when the sheet closes", async () => {
  const files = fakeFiles();
  const shared = [];
  const docs = createDocuments({ files, canShare: async () => true, share: async (uri, opts) => { shared.push([uri, opts]); assert.equal(files.present.size, 1); } });
  assert.deepEqual(await docs.share({ name: "Invoice 7.pdf", mimeType: "application/pdf", data: PDF }), { outcome: "closed" });
  assert.equal(shared[0][0], `file:///cache/${SHARE_FOLDER}/Invoice 7.pdf`);
  assert.equal(shared[0][1].UTI, "com.adobe.pdf");
  assert.equal(files.present.size, 0, "the copy is gone");
});

test("a failed or cancelled share still deletes the copy and reports only a short code", async () => {
  const files = fakeFiles();
  const docs = createDocuments({ files, canShare: async () => true, share: async () => { throw new Error("User did something /private/var/path"); } });
  await assert.rejects(docs.share({ name: "a.pdf", mimeType: "application/pdf", data: PDF }), { code: "share_failed" });
  assert.equal(files.present.size, 0);
});

test("one file at a time; too large, wrong type and no share sheet are refused before anything is written", async () => {
  const files = fakeFiles();
  let release;
  const docs = createDocuments({ files, canShare: async () => true, share: () => new Promise((r) => { release = r; }) });
  const first = docs.share({ name: "a.pdf", mimeType: "application/pdf", data: PDF });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(docs.share({ name: "b.pdf", mimeType: "application/pdf", data: PDF }), { code: "busy" });
  release();
  await first;

  const huge = "A".repeat(Math.ceil((MAX_FILE_BYTES + 3) / 3) * 4);
  await assert.rejects(docs.share({ name: "a.pdf", mimeType: "application/pdf", data: huge }), { code: "file_too_large" });
  await assert.rejects(docs.share({ name: "a.html", mimeType: "text/html", data: PDF }), { code: "bad_request" });
  await assert.rejects(docs.share({ name: "a.pdf", mimeType: "application/pdf", data: "not base64!" }), { code: "file_too_large" });
  const none = createDocuments({ files, canShare: async () => false, share: async () => {} });
  await assert.rejects(none.share({ name: "a.pdf", mimeType: "application/pdf", data: PDF }), { code: "share_unavailable" });
  assert.equal(files.log.filter(([op]) => op === "write").length, 1, "only the first file was ever written");
});

test("removeAll empties the share folder (at sign-out and at start) and never throws", async () => {
  const files = fakeFiles();
  files.present.add(`${SHARE_FOLDER}/left.pdf`);
  const docs = createDocuments({ files, canShare: async () => true, share: async () => {} });
  await docs.removeAll();
  assert.equal(files.present.size, 0);
  const broken = createDocuments({ files: { folder: () => ({ delete: async () => { throw new Error("gone"); } }) }, canShare: async () => true, share: async () => {} });
  await broken.removeAll();
});

test("the bridge offers files only when the build has documents, and passes the file on unchanged", async () => {
  const { createBridgeHost } = require("./bridge/host");
  const WEB = "https://app.example.com";
  const nonce = "z".repeat(32);
  const got = [];
  const make = (documents) => createBridgeHost({ info: { shellVersion: "0", platform: "ios" }, session: {}, openExternal: async () => {}, webOrigin: WEB, nonce, documents });
  let n = 0;
  const send = (h, action, payload, page = `${WEB}/admin/invoices`) => h(JSON.stringify({ v: 1, id: `f${++n}`, nonce, action, payload }), page);
  const h = make({ share: async (p) => { got.push(p); return { outcome: "closed" }; } });
  assert.ok((await send(h, "app.hello", {})).data.capabilities.includes("files"));
  const payload = { name: "a.pdf", mimeType: "application/pdf", data: PDF };
  assert.deepEqual((await send(h, "file.share", payload)).data, { outcome: "closed" });
  assert.deepEqual(got, [payload]);
  assert.equal(await send(h, "file.share", payload, "https://evil.example/"), null, "another site gets no answer");
  assert.ok(!(await send(make(undefined), "app.hello", {})).data.capabilities.includes("files"));
});
