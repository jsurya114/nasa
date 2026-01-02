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

// Async thunk to fetch analytics data
export const fetchAnalyticsData = createAsyncThunk(
  "analytics/fetchData",
  async ({ viewType, date, detailLevel }, { rejectWithValue }) => {
    try {
      // Build query parameters
      const params = new URLSearchParams({
        viewType,
        date,
        ...(detailLevel && { detailLevel }) // Only add if detailLevel exists
      });

      const response = await fetch(
        `${API_BASE_URL}/admin/analytics?${params.toString()}`,
        {
          method: "GET",
          headers: getAuthHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return rejectWithValue(error.message || "Failed to fetch analytics data");
      }

      const data = await response.json();
      return data.data; // Return the actual data array
    } catch (error) {
      return rejectWithValue(
        error.message || "Failed to fetch analytics data"
      );
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