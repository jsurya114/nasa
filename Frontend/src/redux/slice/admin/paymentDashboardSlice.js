// src/features/paymentDashboard/paymentDashboardSlice.js
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

// Async thunk to fetch data
export const fetchPaymentDashboard = createAsyncThunk(
  "paymentDashboard/fetch",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = getState().paymentDashboard;

      // Only call API if no data is present
      if (data.length > 0) {
        return { success: true, data }; // return cached data
      }

      const response = await fetch(`${API_BASE_URL}/admin/dashboard/paymentTable`, {
        method: "GET",
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        return rejectWithValue(error.message || "Failed to fetch payment dashboard");
      }

      const responseData = await response.json();
      return responseData; // { success: true, data: [...] }
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const paymentDashboardSlice = createSlice({
  name: "paymentDashboard",
  initialState: {
    data: [],
    loading: false,
    error: null,
  },
  reducers: {
    clearPaymentDashboard: (state) => {
      state.data = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPaymentDashboard.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPaymentDashboard.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload.data || [];
      })
      .addCase(fetchPaymentDashboard.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || action.error.message;
      });
  },
});

export const { clearPaymentDashboard } = paymentDashboardSlice.actions;
export default paymentDashboardSlice.reducer;