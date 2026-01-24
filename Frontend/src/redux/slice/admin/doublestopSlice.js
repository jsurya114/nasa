import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

// Async thunk to fetch dashboard data (daily) with pagination
export const fetchDashboardData = createAsyncThunk(
  "dashboard/fetchDashboardData",
  async ({ selectedDate, page = 1, limit = 10 }, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/doubleStop/tempDashboardData`, {
        params: { date: selectedDate, page, limit }
      });
      return res.data; // API returns { success: true, data: [...], pagination: {...} }
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

// Async thunk to fetch weekly temp data (role-based filtering on backend)
export const fetchWeeklyTempData = createAsyncThunk(
  "dashboard/fetchWeeklyTempData",
  async ({ page = 1, limit = 10 }, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/doubleStop/fetchWeeklyTempData`, {
        params: { page, limit }
      });
      return res.data; // API returns { success: true, data: [...] }
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState: {
    data: { weeklyData: [], dailyData: [] },
    pagination: {
      currentPage: 1,
      totalPages: 1,
      totalItems: 0,
      itemsPerPage: 10
    },
    loading: false,
    error: null,
  },
  reducers: {
    clearData: (state) => {
      state.data = { weeklyData: [], dailyData: [] };
      state.pagination = {
        currentPage: 1,
        totalPages: 1,
        totalItems: 0,
        itemsPerPage: 10
      };
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
        state.data.dailyData = action.payload.data;
        state.pagination = action.payload.pagination;
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
        state.data.weeklyData = action.payload.data.data;
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchWeeklyTempData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed to fetch data";
      })
  },
});

export const { clearData } = dashboardSlice.actions;
export default dashboardSlice.reducer;