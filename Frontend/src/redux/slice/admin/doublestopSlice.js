import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { API_BASE_URL } from "../../../config";

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('adminToken');
  return {
    "Content-Type": "application/json",
    ...(token && { "Authorization": `Bearer ${token}` })
  };
};

// Async thunk to fetch dashboard data (daily)
export const fetchDashboardData = createAsyncThunk(
  "dashboard/fetchDashboardData",
  async (_, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/doubleStop/tempDashboardData`, {
        method: "GET",
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const error = await res.json();
        return rejectWithValue(error.message || "Failed to fetch dashboard data");
      }

      const data = await res.json();
      return data.data; // API returns { success: true, data: [...] }
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

// Async thunk to fetch weekly temp data
export const fetchWeeklyTempData = createAsyncThunk(
  "dashboard/fetchWeeklyTempData",
  async (_, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/doubleStop/fetchWeeklyTempData`, {
        method: "GET",
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const error = await res.json();
        return rejectWithValue(error.message || "Failed to fetch weekly data");
      }

      const data = await res.json();
      return data.data; // API returns { success: true, data: [...] }
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState: {
    data: { weeklyData: [], dailyData: [] },
    loading: false,
    error: null,
  },
  reducers: {
    clearData: (state) => {
      state.data = { weeklyData: [], dailyData: [] };
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDashboardData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDashboardData.fulfilled, (state, action) => {
        state.loading = false;
        state.data.dailyData = action.payload;
      })
      .addCase(fetchDashboardData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to fetch data";
      })
      .addCase(fetchWeeklyTempData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWeeklyTempData.fulfilled, (state, action) => {
        state.loading = false;
        state.data.weeklyData = action.payload.data;
      })
      .addCase(fetchWeeklyTempData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to fetch data";
      })
  },
});

export const { clearData } = dashboardSlice.actions;
export default dashboardSlice.reducer;