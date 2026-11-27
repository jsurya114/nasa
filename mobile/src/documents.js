// Saving and sharing a document the NASA web page made (an invoice PDF, the Desi pay-run PDF, a CSV export). The page
// builds the file exactly as it does in a browser, with the same permission checks on the server; the shell only shows
// the phone's own share sheet for it (preview, Save to Files, AirDrop, Mail and so on). No pay figures are worked out here.
//
// Rules: two file types only; at most MAX_FILE_BYTES; a clean file name with the right extension; one file at a time;
// the copy in the app's cache is deleted as soon as the sheet closes, at sign-out and at the next start.
// No React Native imports: the file system and the share sheet are passed in, so these rules run in Node tests.

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_BYTES / 3) * 4;
const MAX_NAME_LENGTH = 120;
const TYPES = {
  "application/pdf": { extension: ".pdf", uti: "com.adobe.pdf" },
  "text/csv": { extension: ".csv", uti: "public.comma-separated-values-text" },
};
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SHARE_FOLDER = "nasa-share";

const fail = (code) => Object.assign(new Error(code), { code });

// A name the phone can show and save: letters, digits, spaces, dot, dash and underscore, with the type's extension.
const cleanName = (name, mimeType) => {
  const { extension } = TYPES[mimeType];
  const base = String(name ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, MAX_NAME_LENGTH - extension.length);
  return `${base || "nasa-document"}${extension}`;
};

const decodedSize = (base64) => Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);

// Payload rule for the bridge (protocol.js).
const isSharePayload = (p) =>
  Object.keys(p).every((key) => ["name", "mimeType", "data"].includes(key)) &&
  typeof p.name === "string" && p.name.length > 0 && p.name.length <= 200 &&
  Object.prototype.hasOwnProperty.call(TYPES, p.mimeType) &&
  typeof p.data === "string" && p.data.length > 0 && p.data.length <= MAX_BASE64_LENGTH && p.data.length % 4 === 0;

// files: { folder(name) => { create(), delete(), file(name) => { uri, write(base64), delete() } } }
// share: async (uri, { mimeType, UTI, dialogTitle }) resolves when the sheet closes. canShare: async () => boolean.
const createDocuments = ({ files, share, canShare }) => {
  let busy = false;

  const removeAll = async () => {
    try {
      await files.folder(SHARE_FOLDER).delete();
    } catch {
      // Nothing there, or already gone
    }
  };

  const shareFile = async ({ name, mimeType, data }) => {
    if (!TYPES[mimeType]) throw fail("bad_request");
    if (!BASE64.test(data) || decodedSize(data) > MAX_FILE_BYTES) throw fail("file_too_large");
    if (busy) throw fail("busy");
    if (!(await canShare())) throw fail("share_unavailable");
    busy = true;
    const folder = files.folder(SHARE_FOLDER);
    let file = null;
    try {
      await folder.create();
      file = folder.file(cleanName(name, mimeType));
      await file.write(data);
      await share(file.uri, { mimeType, UTI: TYPES[mimeType].uti, dialogTitle: "Save or share" });
      // The share sheet does not say whether the person saved, sent or cancelled: only that it closed.
      return { outcome: "closed" };
    } catch (error) {
      if (error?.code && /^[a-z_]{1,32}$/.test(error.code)) throw error;
      throw fail("share_failed");
    } finally {
      busy = false;
      try {
        await file?.delete();
      } catch {
        // removeAll at the next start or sign-out catches it
      }
    }
  };

  return { share: shareFile, removeAll };
};

module.exports = { MAX_BASE64_LENGTH, MAX_FILE_BYTES, SHARE_FOLDER, TYPES, cleanName, createDocuments, isSharePayload };
