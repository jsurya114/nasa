import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installShell, removeShell, resetBrowser } from "../test/fakeShell";

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(() => vi.restoreAllMocks());

const load = () => import("./documents.js");

it("in a browser a file is downloaded exactly as before, and the shell is never asked", async () => {
  const { saveDocument } = await load();
  const clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() { clicks.push(this.download); });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  expect(await saveDocument({ bytes: new Uint8Array([37, 80, 68, 70]), fileName: "Invoice 1.pdf", mimeType: "application/pdf" })).toBe("downloaded");
  expect(clicks).toEqual(["Invoice 1.pdf"]);
});

it("in the app the file goes to the shell's share sheet as base64, with nothing downloaded", async () => {
  const shell = installShell({ "app.hello": { bridgeVersions: [1], capabilities: ["session", "files"] }, "file.share": { outcome: "closed" } });
  const { saveDocument } = await load();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
  expect(await saveDocument({ bytes: "a,b\n1,2\n", fileName: "statements.csv", mimeType: "text/csv" })).toBe("shared");
  const sent = shell.received.find((m) => m.action === "file.share");
  expect(sent.payload).toEqual({ name: "statements.csv", mimeType: "text/csv", data: btoa("a,b\n1,2\n") });
  expect(click).not.toHaveBeenCalled();
});

it("an older app without file support says to update instead of pretending to save", async () => {
  const shell = installShell({ "app.hello": { bridgeVersions: [1], capabilities: ["session"] } });
  const { saveDocument, saveProblem } = await load();
  const error = await saveDocument({ bytes: new Uint8Array([1]), fileName: "a.pdf", mimeType: "application/pdf" }).catch((e) => e);
  expect(error.code).toBe("update_app");
  expect(saveProblem(error)).toMatch(/Update the NASA app/);
  expect(shell.count("file.share")).toBe(0);
});

it("a file over the app's limit is refused before it is sent", async () => {
  const shell = installShell({ "app.hello": { bridgeVersions: [1], capabilities: ["files"] } });
  const { saveDocument, MAX_APP_FILE_BYTES } = await load();
  const error = await saveDocument({ bytes: new Uint8Array(MAX_APP_FILE_BYTES + 1), fileName: "a.pdf", mimeType: "application/pdf" }).catch((e) => e);
  expect(error.code).toBe("file_too_large");
  expect(shell.count("file.share")).toBe(0);
});

it("every export in the admin pages saves through saveDocument, so none of them is a dead button in the app", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (p) => readFileSync(p, "utf8");
  for (const p of ["src/components/Admin/invoice/buildInvoicePdf.js", "src/components/Admin/payRuns/desi/buildDesiDriversPdf.js", "src/components/Admin/CarrierStatements.jsx"]) {
    expect(read(p)).toMatch(/saveDocument\(/);
    expect(read(p)).not.toMatch(/link\.download\s*=/);
  }
  expect(read("src/components/Admin/invoice/buildInvoicePdf.js")).toMatch(/if \(isNativeShell\(\)\) return downloadInvoice\(invoice\)/);
  expect(read("src/components/Admin/invoice/InvoiceEditor.jsx")).toMatch(/action === "preview" && !isNativeShell\(\)/);
});
