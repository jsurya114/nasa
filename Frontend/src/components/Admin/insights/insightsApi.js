// The requests behind the Insights page (#227). Read only: every call is a GET to /admin/insights, which only the super admin may use.
import axios from "../../../redux/slice/axiosInstance";

// The filters as the server wants them. Dates are required; cities and source are left out when they mean "all".
export const paramsFor = ({ range, cityIds, source }) => ({
  start_date: range.start,
  end_date: range.end,
  ...(cityIds.length > 0 && { city_ids: cityIds.join(",") }),
  ...(source && { source }),
});

export const getInsights = async (path, params, signal) => {
  const { data } = await axios.get(`/admin/insights/${path}`, { params, signal });
  return data;
};

// A message for the person, from a failed request. The server's own words when it refused the question (400), otherwise a plain sentence.
export const messageFor = (error) => {
  const status = error?.response?.status;
  const server = error?.response?.data?.message;
  if (status === 400 && typeof server === "string") return server;
  if (status === 403) return "Insights is for the super admin only.";
  if (status === 504) return "This question took too long to answer. Try a shorter period or fewer cities.";
  return "Insights could not be loaded. Check your connection and try again.";
};
