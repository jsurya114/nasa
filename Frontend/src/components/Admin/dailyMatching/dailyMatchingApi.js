import axios from "../../../redux/slice/axiosInstance";

// The remembered choices of the daily upload that finds drivers by name. The server checks the admin's cities.
const BASE = "/admin/daily-matching";
const messageOf = (error, fallback) => error.response?.data?.message ?? fallback;

export const listDailyCities = async () => (await axios.get(BASE)).data.cities ?? [];
export const loadCityChoices = async (cityId) => (await axios.get(BASE, { params: { cityId } })).data;
export const saveNameMatch = (body) => axios.put(`${BASE}/names`, body).catch((e) => { throw new Error(messageOf(e, "The name match could not be saved.")); });
export const saveSubRoute = (body) => axios.put(`${BASE}/subroutes`, body).catch((e) => { throw new Error(messageOf(e, "The sub-route could not be saved.")); });
export const undoChoice = (kind, id) => axios.delete(`${BASE}/${kind}/${id}`).catch((e) => { throw new Error(messageOf(e, "It could not be undone.")); });

// "DFW 053 A-1:B" belongs to the main route "DFW 053 A-1".
export const mainRoutesWithSubs = (routes) => {
  const byCode = new Map(routes.map((r) => [r.code, r]));
  const out = new Map();
  for (const r of routes) {
    if (!r.code.includes(":")) continue;
    const main = byCode.get(r.code.split(":")[0]);
    if (!main) continue;
    out.set(main.id, { main, subs: [...(out.get(main.id)?.subs ?? []), r] });
  }
  return [...out.values()].sort((a, b) => a.main.code.localeCompare(b.main.code));
};
