import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

// Async thunk to fetch analytics data
export const fetchAnalyticsData = createAsyncThunk(
  "analytics/fetchData",
  async ({ viewType, date, detailLevel }, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/analytics`, {
        params: { viewType, date, detailLevel }
      });
      return res.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to fetch analytics data");
    }
  }
);

const analyticsSlice = createSlice({
  name: "analytics",
  initialState: {
    data: [],
    loading: false,
    error: null,
  },
  reducers: {
    clearAnalytics: (state) => {
      state.data = [];
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAnalyticsData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAnalyticsData.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchAnalyticsData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearAnalytics } = analyticsSlice.actions;
export default analyticsSlice.reducer;