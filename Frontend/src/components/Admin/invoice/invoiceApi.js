// The requests behind the Invoices page. Super admin only: the server checks the token and the role on every one.
import axios from "../../../redux/slice/axiosInstance";

const BASE = "/admin/invoices";

export const listVendors = async () => (await axios.get(`${BASE}/vendors`)).data.vendors;
export const createVendor = async (vendor) => (await axios.post(`${BASE}/vendors`, vendor)).data.vendor;
export const updateVendor = async (id, vendor) => (await axios.put(`${BASE}/vendors/${id}`, vendor)).data.vendor;

export const nextInvoiceNumber = async () => (await axios.get(`${BASE}/next-number`)).data.invoiceNumber;
export const listInvoices = async (params, signal) => (await axios.get(BASE, { params, signal })).data;
export const getInvoice = async (id) => (await axios.get(`${BASE}/${id}`)).data.invoice;
// requestId: the same key for every retry of one "Save", so a save that timed out but did reach the server never makes a second invoice.
export const createInvoice = async (body, requestId) => (await axios.post(BASE, { ...body, requestId })).data.invoice;
export const updateInvoice = async (id, body, version) => (await axios.put(`${BASE}/${id}`, { ...body, version })).data.invoice;
export const markPaymentReceived = async (id, payment) => (await axios.post(`${BASE}/${id}/payment`, payment)).data.invoice;

// What went wrong, in words for the person, plus the server's field errors when it refused the form (400).
export const problemOf = (error, fallback = "That did not work. Check your connection and try again.") => {
  const status = error?.response?.status;
  const data = error?.response?.data ?? {};
  if (status === 403) return { message: "Invoices are for the super admin only." };
  if ((status === 400 || status === 404 || status === 409) && typeof data.message === "string") return { message: data.message, errors: data.errors, code: data.code, status };
  return { message: fallback };
};

// A key for one save attempt (kept across retries of that save).
export const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));
