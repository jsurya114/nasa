import axios from "axios";
import { API_BASE_URL } from "../../config";

// Create a separate instance for refresh token requests to avoid interceptor loops
const refreshInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Set base URL for global axios
axios.defaults.baseURL = API_BASE_URL;

// The app has two separate sign-ins: admin and driver. A browser can hold both
// at once, so every request must use the tokens of its own area, never "whichever exists".
const AREAS = ['admin', 'driver'];

// Which area a request belongs to: from its URL ("/admin/..." or "/driver/..."),
// otherwise from the page the user is on. Returns null when neither tells.
const getArea = (url = '') => {
  const path = String(url).replace(/^https?:\/\/[^/]+/i, '');
  const fromUrl = AREAS.find((a) => path === `/${a}` || path.startsWith(`/${a}/`));
  if (fromUrl) return fromUrl;

  const page = typeof window !== 'undefined' ? window.location.pathname : '';
  return AREAS.find((a) => page === `/${a}` || page.startsWith(`/${a}/`)) || null;
};

// Request interceptor - Add the token of the request's own area
axios.interceptors.request.use(
  (config) => {
    const area = getArea(config.url);
    const token = area ? localStorage.getItem(`${area}Token`) : null;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle 401 errors and refresh the area's own tokens
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const area = originalRequest ? getArea(originalRequest.url) : null;

    // If error is 401 and it's not a retry and not a login/refresh request
    if (
      area &&
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url.includes('/login') &&
      !originalRequest.url.includes('/refresh-token')
    ) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem(`${area}RefreshToken`);

        if (refreshToken) {
          const response = await refreshInstance.post(`/${area}/refresh-token`, { refreshToken });

          if (response.status === 200) {
            const { accessToken, refreshToken: newRefreshToken } = response.data;

            localStorage.setItem(`${area}Token`, accessToken);
            localStorage.setItem(`${area}RefreshToken`, newRefreshToken);

            // Retry the original request with the new token
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return axios(originalRequest);
          }
        }
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError.message);
        // If refresh fails, sign out of this area only. The other area keeps its session.
        localStorage.removeItem(`${area}Token`);
        localStorage.removeItem(`${area}RefreshToken`);
        if (area === 'driver') {
          localStorage.removeItem('driverTimezone');
        }

        if (window.location.pathname.startsWith(`/${area}`)) {
          window.location.href = `/${area}/login`;
        }
      }
    }

    return Promise.reject(error);
  }
);

export default axios;