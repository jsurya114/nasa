import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { isNativeShell } from "../../../native/bridge";
import { clearBrowserTokens, clearSession, getRefreshToken, saveSession } from "../../../native/sessionStore";

const DEVICE_SIGN_IN_ERROR = "Could not sign in on this device. Please try again.";

const initialState = {
  driver: null,
  loading: false,
  error: null,
  isAuthenticated: null,
};

export const driverLogin = createAsyncThunk(
  "driver/login",
  async (credentials, { rejectWithValue }) => {
    try {
      // AUTO-DETECT TIMEZONE
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const res = await axios.post(`/driver/login`, {
        ...credentials,
        timezone // ADD TIMEZONE TO REQUEST
      });

      const data = res.data;

      if (!data.driver) {
        return rejectWithValue({ message: "Invalid response from server" });
      }

      // Store the tokens (in the mobile app the shell keeps the refresh token) and the timezone
      if (data.accessToken) {
        await saveSession('driver', { accessToken: data.accessToken, refreshToken: data.refreshToken });
        localStorage.setItem('driverTimezone', timezone);
        localStorage.setItem('lastActivity', Date.now().toString());
      }

      return data;
    } catch (error) {
      if (error.name === "BridgeError") return rejectWithValue({ message: DEVICE_SIGN_IN_ERROR });
      return rejectWithValue(error.response?.data || { message: error.message || "Network error" });
    }
  }
);

export const accessDriver = createAsyncThunk(
  "driver/access-driver",
  async (_, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/driver/access-driver`);
      const data = res.data;

      if (!data.driver) {
        return rejectWithValue({ message: "Invalid response from server" });
      }

      return data;
    } catch (error) {
      // If blocked or unauthorized, remove token
      if (error.response?.status === 401 || error.response?.status === 403) {
        await clearSession('driver');
        localStorage.removeItem('driverTimezone');
      }
      return rejectWithValue({
        message: error.response?.data?.message || "Unable to get Driver",
        status: error.response?.status,
      });
    }
  }
);

export const driverLogout = createAsyncThunk(
  "driver/logout",
  async (_, { rejectWithValue }) => {
    try {
      // In the mobile app the shell revokes the refresh token on the server and clears its copy.
      if (isNativeShell()) {
        await clearSession('driver');
        localStorage.removeItem('driverTimezone');
        localStorage.removeItem('lastActivity');
        return {};
      }
      // Send the refresh token too, so the server can revoke it.
      const refreshToken = getRefreshToken('driver');
      const res = await axios.post(`/driver/logout`, { refreshToken });
      // Cleanup tokens after successful logout request
      await clearSession('driver');
      localStorage.removeItem('driverTimezone');
      localStorage.removeItem('lastActivity');
      return res.data;
    } catch (error) {
      // Ensure tokens are removed even on error
      await clearSession('driver');
      localStorage.removeItem('driverTimezone');
      localStorage.removeItem('lastActivity');
      return rejectWithValue({ message: error.response?.data?.message || error.message || "Network error" });
    }
  }
);

export const submitDriverAgreement = createAsyncThunk(
  "driver/submit-agreement",
  async (agreementData, { rejectWithValue }) => {
    try {
      const res = await axios.post(`/driver/agreement`, agreementData);
      return res.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: error.message || "Network error" });
    }
  }
);

const driverSlice = createSlice({
  name: "driver",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    logout: (state) => {
      state.driver = null;
      state.isAuthenticated = false;
      state.error = null;
      clearSession('driver');
      localStorage.removeItem('driverTimezone');
    },
    setDriver: (state, action) => {
      state.driver = action.payload;
      state.isAuthenticated = true;
    },
  },
  extraReducers: (builder) => {
    // ===== Driver Login =====
    builder
      .addCase(driverLogin.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(driverLogin.fulfilled, (state, action) => {
        state.loading = false;
        state.driver = action.payload.driver;
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(driverLogin.rejected, (state, action) => {
        state.loading = false;
        state.isAuthenticated = false;
        state.driver = null;

        if (action.payload?.errors) {
          state.error = null;
        } else {
          state.error = action.payload?.message || "Login Failed";
        }
      })

      // ===== Driver Logout =====
      .addCase(driverLogout.pending, (state) => {
        state.loading = true;
        state.isAuthenticated = false;
        state.driver = null;
        state.error = null;
      })
      .addCase(driverLogout.fulfilled, (state) => {
        state.loading = false;
        state.isAuthenticated = false;
        state.driver = null;
        state.error = null;
      })
      .addCase(driverLogout.rejected, (state, action) => {
        state.loading = false;
        state.isAuthenticated = false;
        state.driver = null;
        state.error = action.payload?.message || "Logout failed";
      })

      // ===== Access Driver =====
      .addCase(accessDriver.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(accessDriver.fulfilled, (state, action) => {
        state.loading = false;
        state.isAuthenticated = true;
        state.driver = action.payload.driver;
        state.error = null;
      })
      .addCase(accessDriver.rejected, (state, action) => {
        state.loading = false;
        state.isAuthenticated = false;
        state.driver = null;
        // Clear token and timezone on rejection (in the mobile app only a 401 or 403 signs out, above)
        clearBrowserTokens('driver');
        localStorage.removeItem('driverTimezone');

        const isUnauthorized = action.payload?.status === 401 ||
          action.payload === "UNAUTHORIZED";

        if (isUnauthorized) {
          state.error = null;
        } else {
          state.error = action.payload?.message || "Access denied";
        }
      })

      // ===== Submit Agreement =====
      .addCase(submitDriverAgreement.fulfilled, (state) => {
        if (state.driver) {
          state.driver.agreement_signed = true;
        }
      });
  },
});

export const { clearError, logout, setDriver } = driverSlice.actions;
export default driverSlice.reducer;