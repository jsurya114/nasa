import axios from "../../../redux/slice/axiosInstance";

// The Claims page's two reads. Both are read only: the claims of the admin's own cities (all of them for the super admin), and the cities to pick from.
export const listClaims = async (params, signal) => (await axios.get("/admin/claims", { params, signal })).data;
export const listCities = async () => (await axios.get("/admin/get-admin-cities")).data?.cities ?? [];

// What went wrong, in words for the person.
export const problemOf = (error) => (error?.response?.data?.message && typeof error.response.data.message === "string"
  ? error.response.data.message
  : "The claims could not be loaded. Check your connection and try again.");

// How each claim status reads, and where its colour comes from. Colour is never the only signal: every status has its own words.
export const CLAIM_STATUS = Object.freeze({
  chargeable: { label: "Chargeable", tone: "bg-green-100 text-green-800", hint: "Matched to a driver. It comes off the driver's pay when a pay run that includes it is finalized." },
  exempt: { label: "Exempt", tone: "bg-gray-100 text-gray-700", hint: "Matched to a driver, but nothing is taken off pay for this city and claim type." },
  unresolved: { label: "Waiting for delivery history", tone: "bg-amber-100 text-amber-800", hint: "NASA cannot match this claim to a driver yet. It is matched again when the delivery history arrives." },
  ambiguous: { label: "Not clear which driver", tone: "bg-red-100 text-red-800", hint: "More than one driver or city fits this claim, so it is not matched until it is clear." },
  review: { label: "Held for review", tone: "bg-blue-100 text-blue-800", hint: "Held, never deducted, because the same claim was already entered by hand." },
});
