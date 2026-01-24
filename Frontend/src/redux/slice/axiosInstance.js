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

// Request interceptor - Add token to all requests
axios.interceptors.request.use(
  (config) => {
    // Check for admin or driver token
    const adminToken = localStorage.getItem('adminToken');
    const driverToken = localStorage.getItem('driverToken');

    const token = adminToken || driverToken;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle 401 errors and refresh tokens
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If error is 401 and it's not a retry and not a login/refresh request
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url.includes('/login') &&
      !originalRequest.url.includes('/refresh-token')
    ) {
      originalRequest._retry = true;

      try {
        const adminRefreshToken = localStorage.getItem('adminRefreshToken');
        const driverRefreshToken = localStorage.getItem('driverRefreshToken');

        const refreshToken = adminRefreshToken || driverRefreshToken;
        const role = adminRefreshToken ? 'admin' : 'driver';

        if (refreshToken) {
          const response = await refreshInstance.post(`/${role}/refresh-token`, { refreshToken });

          if (response.status === 200) {
            const { accessToken, refreshToken: newRefreshToken } = response.data;

            if (role === 'admin') {
              localStorage.setItem('adminToken', accessToken);
              localStorage.setItem('adminRefreshToken', newRefreshToken);
            } else {
              localStorage.setItem('driverToken', accessToken);
              localStorage.setItem('driverRefreshToken', newRefreshToken);
            }

            // Retry the original request with the new token
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return axios(originalRequest);
          }
        }
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);
        // If refresh fails, clear tokens and redirect to login
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminRefreshToken');
        localStorage.removeItem('driverToken');
        localStorage.removeItem('driverRefreshToken');

        if (window.location.pathname.startsWith('/admin')) {
          window.location.href = '/admin/login';
        } else if (window.location.pathname.startsWith('/driver')) {
          window.location.href = '/driver/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

export default axios;