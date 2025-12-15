import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { API_BASE_URL } from "../../../config";
import { toast } from "react-toastify";

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('adminToken');
  return {
    ...(token && { "Authorization": `Bearer ${token}` })
  };
};

// Async thunk to fetch dashboard data (cities, drivers, routes)
export const fetchDashboardData = createAsyncThunk(
  "dashboard/fetchDashboardData",
  async (_, { rejectWithValue }) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/dashboard/data`, {
        headers: getAuthHeaders()
      });
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

// Async thunk to fetch filtered payment table data
export const fetchFilteredPaymentData = createAsyncThunk(
  "dashboard/fetchFilteredPaymentData",
  async (filters, { rejectWithValue }) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/dashboard/paymentTable`, {
        params: filters,
        headers: getAuthHeaders()
      });
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

// Async thunk to mark driver as paid
export const payDriver = createAsyncThunk(
  "dashboard/payDriver",
  async ({ driverName, startDate, endDate }, { rejectWithValue }) => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/admin/dashboard/payDriver`,
        { driverName, startDate, endDate },
        { headers: getAuthHeaders() }
      );
      if (!res.data.success) throw new Error(res.data.message);
      toast.success(res.data.message);
      return res.data;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      toast.error(errorMsg);
      return rejectWithValue(errorMsg);
    }
  }
);

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState: {
    cities: [],
    drivers: [],
    routes: [],
    filteredPaymentData: [],
    loading: false,
    paymentLoading: false,
    paymentProcessing: false,
    error: null,
    paymentError: null,
    isFiltered: false,
  },
  reducers: {
    clearFilteredData: (state) => {
      state.filteredPaymentData = [];
      state.isFiltered = false;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch dashboard data (cities, drivers, routes)
      .addCase(fetchDashboardData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDashboardData.fulfilled, (state, action) => {
        state.loading = false;
        state.cities = action.payload.cities || [];
        state.drivers = action.payload.drivers || [];
        state.routes = action.payload.routes || [];
      })
      .addCase(fetchDashboardData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch filtered payment data
      .addCase(fetchFilteredPaymentData.pending, (state) => {
        state.paymentLoading = true;
        state.paymentError = null;
      })
      .addCase(fetchFilteredPaymentData.fulfilled, (state, action) => {
        state.paymentLoading = false;
        state.filteredPaymentData = action.payload;
        state.isFiltered = true;
      })
      .addCase(fetchFilteredPaymentData.rejected, (state, action) => {
        state.paymentLoading = false;
        state.paymentError = action.payload;
        state.isFiltered = true;
      })
      // Pay driver
      .addCase(payDriver.pending, (state) => {
        state.paymentProcessing = true;
      })
      .addCase(payDriver.fulfilled, (state) => {
        state.paymentProcessing = false;
        // Don't update the state here - let the refetch handle it
        // The new fetch will have the correct paid status from the database
      })
      .addCase(payDriver.rejected, (state) => {
        state.paymentProcessing = false;
      });
  },
});

export const { clearFilteredData } = dashboardSlice.actions;
export default dashboardSlice.reducer;