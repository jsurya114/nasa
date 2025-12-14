import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { API_BASE_URL } from "../../../config";

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('driverToken');
  return {
    "Content-Type": "application/json",
    ...(token && { "Authorization": `Bearer ${token}` })
  };
};

const initialState = {
  driver: null,
  loading: false,
  error: null,
  isAuthenticated: false,
};

export const driverLogin = createAsyncThunk(
  "driver/login",
  async (credentials, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/driver/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });

      const data = await res.json();

      if (!res.ok) {
        return rejectWithValue(data);
      }

      if (!data.driver) {
        return rejectWithValue({ message: "Invalid response from server" });
      }

      // Store token in localStorage
      if (data.token) {
        localStorage.setItem('driverToken', data.token);
      }

      return data;
    } catch (error) {
      return rejectWithValue({ message: error.message || "Network error" });
    }
  }
);

export const accessDriver = createAsyncThunk(
  "driver/access-driver",
  async (_, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/driver/access-driver`, {
        method: "GET",
        headers: getAuthHeaders(),
      });

      const data = await res.json();

      if (!res.ok) {
        // If blocked or unauthorized, remove token
        if (data.reason === "Account has been disabled") {
          localStorage.removeItem('driverToken');
        }
        return rejectWithValue({
          message: data.message || "Unable to get Driver",
          status: res.status,
        });
      }

      if (!data.driver) {
        return rejectWithValue({ message: "Invalid response from server" });
      }

      return data;
    } catch (error) {
      return rejectWithValue({ message: error.message || "Network error" });
    }
  }
);

export const driverLogout = createAsyncThunk(
  "driver/logout",
  async (_, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/driver/logout`, {
        method: "POST",
        headers: getAuthHeaders(),
      });

      const data = await res.json();

      if (!res.ok) {
        return rejectWithValue({
          message: data.message || "Logout Error",
        });
      }

      // Always remove token from localStorage
      localStorage.removeItem('driverToken');

      return data;
    } catch (error) {
      // Even if logout fails, remove token
      localStorage.removeItem('driverToken');
      return rejectWithValue({ message: error.message || "Network error" });
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
        // Clear token on rejection
        localStorage.removeItem('driverToken');

        const isUnauthorized = action.payload?.status === 401 ||
          action.payload === "UNAUTHORIZED";

        if (isUnauthorized) {
          state.error = null;
        } else {
          state.error = action.payload?.message || "Access denied";
        }
      });
  },
});

export const { clearError, logout, setDriver } = driverSlice.actions;
export default driverSlice.reducer;