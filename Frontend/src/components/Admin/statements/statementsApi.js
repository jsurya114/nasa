// The requests behind the carrier statements page (issue #252). Every call goes to /admin/finance/gofo-statements, which only the super admin may use.
import axios from "../../../redux/slice/axiosInstance";

const BASE = "/admin/finance/gofo-statements";

const withFile = (file) => {
  const form = new FormData();
  form.append("file", file);
  return form;
};

export const listStatements = async (signal) => (await axios.get(BASE, { signal })).data.statements;
export const previewStatement = async (file) => (await axios.post(`${BASE}/preview`, withFile(file))).data;
// 201 published, 200 already published, 409 older version and 422 rejected are all answers with a body to show, not failures.
export const publishStatement = async (file) => (await axios.post(`${BASE}/publish`, withFile(file), { validateStatus: (status) => [200, 201, 409, 422].includes(status) })).data;
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
