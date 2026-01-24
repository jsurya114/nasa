import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

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

      const res = await axios.get(`/admin/dashboard/paymentTable`);
      return res.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to fetch payment dashboard");
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