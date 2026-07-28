import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

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
      console.log("🌍 Detected timezone:", timezone);

      const res = await axios.post(`/driver/login`, {
        ...credentials,
        timezone // ADD TIMEZONE TO REQUEST
      });

      const data = res.data;

      if (!data.driver) {
        return rejectWithValue({ message: "Invalid response from server" });
      }

      // Store tokens and timezone in localStorage
      if (data.accessToken) {
        localStorage.setItem('driverToken', data.accessToken);
        localStorage.setItem('driverTimezone', timezone);
        localStorage.setItem('lastActivity', Date.now().toString());
      }
      if (data.refreshToken) {
        localStorage.setItem('driverRefreshToken', data.refreshToken);
      }

      return data;
    } catch (error) {
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
        localStorage.removeItem('driverToken');
        localStorage.removeItem('driverRefreshToken');
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
      const res = await axios.post(`/driver/logout`);
      // Cleanup tokens after successful logout request
      localStorage.removeItem('driverToken');
      localStorage.removeItem('driverRefreshToken');
      localStorage.removeItem('driverTimezone');
      localStorage.removeItem('lastActivity');
      return res.data;
    } catch (error) {
      // Ensure tokens are removed even on error
      localStorage.removeItem('driverToken');
      localStorage.removeItem('driverRefreshToken');
      localStorage.removeItem('driverTimezone');
      localStorage.removeItem('lastActivity');
      return rejectWithValue({ message: error.response?.data?.message || error.message || "Network error" });
    }
  }
);

export const submitDriverAgreement = createAsyncThunk(
  "driver/submit-agreement",
  async (agreementData, { rejectWithValue, getState }) => {
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
      localStorage.removeItem('driverToken');
      localStorage.removeItem('driverRefreshToken');
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
        // Clear token and timezone on rejection
        localStorage.removeItem('driverToken');
        localStorage.removeItem('driverRefreshToken');
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