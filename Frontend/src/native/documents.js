// Saving a file the page made (invoice PDF, Desi pay-run PDF, CSV export).
// In a browser: the usual download, exactly as before. Inside the NASA app: the phone's share sheet through the shell
// (preview, Save to Files, share), because a browser download does nothing in the app. The file is made the same way in
// both, by the same code, after the same server checks; only the last step differs.

import { BridgeError, callNative, hasCapability, isNativeShell } from "./bridge";

export const MAX_APP_FILE_BYTES = 8 * 1024 * 1024;
const SHARE_TIMEOUT_MS = 10 * 60 * 1000; // the person may take a while in the share sheet

const toBase64 = (bytes) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
};

const browserDownload = (bytes, fileName, mimeType) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

// bytes: Uint8Array or a string (CSV). Resolves to "downloaded" (browser) or "shared" (the app's sheet closed).
// Rejects with BridgeError "update_app" inside an older app that cannot save files, "file_too_large", or the
// shell's own short code. Nothing here says the file was saved: the share sheet only reports that it closed.
export const saveDocument = async ({ bytes, fileName, mimeType }) => {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  if (!isNativeShell()) {
    browserDownload(data, fileName, mimeType);
    return "downloaded";
  }
  if (!(await hasCapability("files"))) throw new BridgeError("update_app");
  if (data.byteLength > MAX_APP_FILE_BYTES) throw new BridgeError("file_too_large");
  await callNative("file.share", { name: fileName, mimeType, data: toBase64(data) }, { timeoutMs: SHARE_TIMEOUT_MS });
  return "shared";
};

// A sentence for the person when saving failed.
export const saveProblem = (error) => {
  if (error?.code === "update_app") return "Update the NASA app to save files on this phone.";
  if (error?.code === "file_too_large") return "This file is too large to save in the app. Use NASA in a browser instead.";
  if (error?.code === "busy") return "Another file is still open. Close it and try again.";
  return "The file could not be saved. Try again.";
};
