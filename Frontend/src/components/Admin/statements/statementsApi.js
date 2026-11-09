// The requests behind the GOFO import history page (issue #252). Every call goes to /admin/finance/gofo-statements, which only the super admin may use.
import axios from "../../../redux/slice/axiosInstance";

const BASE = "/admin/finance/gofo-statements";

export const listStatements = async (signal) => (await axios.get(BASE, { signal })).data.statements;
// The weekly uploads waiting for the owner. The file was saved when it was uploaded under File Upload, so reviewing one never asks for the file again.
export const listImports = async (signal) => (await axios.get(`${BASE}/imports`, { signal })).data.imports;
// 201 published, 200 already imported, 409 needs the correction confirmed (or is no longer open), 422 still fails its checks and 404 are answers with a body to show, not failures.
export const publishImport = async (id, replacesStatementId = null) => (await axios.post(`${BASE}/imports/${id}/publish`, { replacesStatementId }, { validateStatus: (status) => [200, 201, 404, 409, 422].includes(status) })).data;
export const dismissImport = async (id, reason) => (await axios.post(`${BASE}/imports/${id}/dismiss`, { reason })).data;
export const listUnallocated = async (id) => (await axios.get(`${BASE}/${id}/unallocated`)).data.unallocated;
export const rematchStatement = async (id) => (await axios.post(`${BASE}/${id}/rematch`)).data.matched;
export const voidStatement = async (id, reason) => (await axios.post(`${BASE}/${id}/void`, { reason })).data;

// The CSV as text; the page turns it into a download.
export const exportStatementsCsv = async () => (await axios.get(`${BASE}/export.csv`, { responseType: "text" })).data;

// A message for the person, from a failed request: the server's own words for a refused question, otherwise a plain sentence.
export const messageFor = (error) => {
  const status = error?.response?.status;
  const server = error?.response?.data?.message;
  if ((status === 400 || status === 409) && typeof server === "string") return server;
  if (status === 403) return "Carrier statements are for the super admin only.";
  return "The carrier statements could not be reached. Check your connection and try again.";
};
