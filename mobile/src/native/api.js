import { API_ORIGIN } from "../config";
import { REFRESH_TIMEOUT_MS } from "../session";

// POSTs JSON to the NASA backend. Resolves with { status, data } for any HTTP answer, and rejects only when
// there is no connection or the request times out. Tokens are never written to logs.
export const request = async (path, { token, body } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      // An answer with no JSON body (for example a gateway page) is still an answer
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
};
