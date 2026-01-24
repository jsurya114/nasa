import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { API_BASE_URL } from "../../../config";
import { toast } from "react-toastify";

const getAuthHeaders = () => {
  const token = localStorage.getItem('adminToken');
  return {
    ...(token && { "Authorization": `Bearer ${token}` })
  };
};

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

// ✅ Fetch drivers filtered by city
export const fetchDriversByCity = createAsyncThunk(
  "dashboard/fetchDriversByCity",
  async (cityJob, { rejectWithValue }) => {
    try {
      const params = cityJob && cityJob !== "All" ? { cityJob } : {};
      const res = await axios.get(`${API_BASE_URL}/admin/dashboard/drivers-by-city`, {
        params,
        headers: getAuthHeaders()
      });
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

export const fetchSummaryData = createAsyncThunk(
  "dashboard/fetchSummaryData",
  async (filters, { rejectWithValue }) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/dashboard/summary`, {
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

export const fetchFilteredPaymentData = createAsyncThunk(
  "dashboard/fetchFilteredPaymentData",
  async (filters, { rejectWithValue }) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/dashboard/paymentTable`, {
        params: filters,
        headers: getAuthHeaders()
      });
      if (!res.data.success) throw new Error(res.data.message);
      return { 
        data: res.data.data, 
        pagination: res.data.pagination,
        filters 
      };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

// ✅ NEW: Fetch today's payment data (default view)
export const fetchTodayPaymentData = createAsyncThunk(
  "dashboard/fetchTodayPaymentData",
  async ({ page = 1, limit = 10 }, { rejectWithValue }) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/dashboard/paymentTable`, {
        params: { 
          defaultToday: "true",
          page,
          limit
        },
        headers: getAuthHeaders()
      });
      if (!res.data.success) throw new Error(res.data.message);
      return { 
        data: res.data.data, 
        pagination: res.data.pagination,
        filters: { defaultToday: true }
      };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  }
);

export const fetchAllPaymentData = createAsyncThunk(
  "dashboard/fetchAllPaymentData",
  async (filters, { rejectWithValue }) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/dashboard/paymentTableAll`, {
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
    allPaymentData: [],
    summaryData: null,
    filters: {},
    selectedDataType: "all",
    pagination: {
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1
    },
    loading: false,
    paymentLoading: false,
    allPaymentLoading: false,
    summaryLoading: false,
    paymentProcessing: false,
    error: null,
    paymentError: null,
    summaryError: null,
    isFiltered: false,
    showTodayOnly: false, // ✅ NEW: Track if showing only today's data
  },
  reducers: {
    clearFilteredData: (state) => {
      state.filteredPaymentData = [];
      state.isFiltered = false;
      state.filters = {};
      state.selectedDataType = "all";
      state.summaryData = null;
      state.showTodayOnly = false; // ✅ Reset today view flag
      state.pagination = {
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1
      };
    },
    setDataType: (state, action) => {
      state.selectedDataType = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
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
      // Handle driver filter by city
      .addCase(fetchDriversByCity.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDriversByCity.fulfilled, (state, action) => {
        state.loading = false;
        state.drivers = action.payload || [];
      })
      .addCase(fetchDriversByCity.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchSummaryData.pending, (state) => {
        state.summaryLoading = true;
        state.summaryError = null;
      })
      .addCase(fetchSummaryData.fulfilled, (state, action) => {
        state.summaryLoading = false;
        state.summaryData = action.payload;
      })
      .addCase(fetchSummaryData.rejected, (state, action) => {
        state.summaryLoading = false;
        state.summaryError = action.payload;
      })
      .addCase(fetchFilteredPaymentData.pending, (state) => {
        state.paymentLoading = true;
        state.paymentError = null;
      })
      .addCase(fetchFilteredPaymentData.fulfilled, (state, action) => {
        state.paymentLoading = false;
        state.filteredPaymentData = action.payload.data;
        state.pagination = action.payload.pagination;
        state.filters = action.payload.filters;
        state.isFiltered = true;
        state.showTodayOnly = false; // ✅ Not showing today-only view
      })
      .addCase(fetchFilteredPaymentData.rejected, (state, action) => {
        state.paymentLoading = false;
        state.paymentError = action.payload;
        state.isFiltered = true;
        state.showTodayOnly = false;
      })
      // ✅ NEW: Handle today's payment data
      .addCase(fetchTodayPaymentData.pending, (state) => {
        state.paymentLoading = true;
        state.paymentError = null;
      })
      .addCase(fetchTodayPaymentData.fulfilled, (state, action) => {
        state.paymentLoading = false;
        state.filteredPaymentData = action.payload.data;
        state.pagination = action.payload.pagination;
        state.filters = action.payload.filters;
        state.isFiltered = true;
        state.showTodayOnly = true; // ✅ Mark as showing today's data
      })
      .addCase(fetchTodayPaymentData.rejected, (state, action) => {
        state.paymentLoading = false;
        state.paymentError = action.payload;
        state.isFiltered = false;
        state.showTodayOnly = false;
      })
      .addCase(fetchAllPaymentData.pending, (state) => {
        state.allPaymentLoading = true;
        state.paymentError = null;
      })
      .addCase(fetchAllPaymentData.fulfilled, (state, action) => {
        state.allPaymentLoading = false;
        state.allPaymentData = action.payload;
      })
      .addCase(fetchAllPaymentData.rejected, (state, action) => {
        state.allPaymentLoading = false;
        state.paymentError = action.payload;
      })
      .addCase(payDriver.pending, (state) => {
        state.paymentProcessing = true;
      })
      .addCase(payDriver.fulfilled, (state) => {
        state.paymentProcessing = false;
      })
      .addCase(payDriver.rejected, (state) => {
        state.paymentProcessing = false;
      });
  },
});

export const { clearFilteredData, setDataType } = dashboardSlice.actions;
export default dashboardSlice.reducer;