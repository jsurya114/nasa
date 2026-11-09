import { createSlice, createAsyncThunk, isAnyOf } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { toast } from "react-toastify";
import { accessAdminUser, adminLogin, adminLogout, manualLogout } from "./adminSlice";

// Everything on this page belongs to the administrator who asked for it: the table, the summary and the dropdowns are scoped to that
// person's role and cities. Each read is recorded when it starts (with who asked), and its answer is used only if that record still exists.
// Ending the session clears the records (see the session boundary below), so an answer still on its way from an earlier session is
// dropped when it arrives, and the next person to sign in on this tab can never be shown the previous person's data.
const withAsker = {
  getPendingMeta: (_, { getState }) => ({ adminId: getState().admin?.admin?.id ?? null }),
};
// The record of the read this answer belongs to (and forgets it), or null when its session has ended.
const settle = (state, action) => {
  const asked = state.inFlight[action.meta.requestId] ?? null;
  delete state.inFlight[action.meta.requestId];
  return asked;
};

export const fetchDashboardData = createAsyncThunk(
  "dashboard/fetchDashboardData",
  async (_, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/dashboard/data`);
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  },
  withAsker
);

// ✅ Fetch drivers filtered by city
export const fetchDriversByCity = createAsyncThunk(
  "dashboard/fetchDriversByCity",
  async (cityJob, { rejectWithValue }) => {
    try {
      const params = cityJob && cityJob !== "All" ? { cityJob } : {};
      const res = await axios.get(`/admin/dashboard/drivers-by-city`, { params });
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  },
  withAsker
);

// ✅ NEW: Fetch routes filtered by city
export const fetchRoutesByCity = createAsyncThunk(
  "dashboard/fetchRoutesByCity",
  async (cityJob, { rejectWithValue }) => {
    try {
      const params = cityJob && cityJob !== "All" ? { cityJob } : {};
      const res = await axios.get(`/admin/dashboard/routes-by-city`, { params });
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  },
  withAsker
);

export const fetchSummaryData = createAsyncThunk(
  "dashboard/fetchSummaryData",
  async (filters, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/dashboard/summary`, { params: filters });
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  },
  withAsker
);

export const fetchFilteredPaymentData = createAsyncThunk(
  "dashboard/fetchFilteredPaymentData",
  async (filters, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/dashboard/paymentTable`, { params: filters });
      if (!res.data.success) throw new Error(res.data.message);
      return {
        data: res.data.data,
        pagination: res.data.pagination,
        filters
      };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  },
  withAsker
);

// ✅ NEW: Fetch today's payment data (default view)
export const fetchTodayPaymentData = createAsyncThunk(
  "dashboard/fetchTodayPaymentData",
  async ({ page = 1, limit = 10 }, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/dashboard/paymentTable`, {
        params: {
          defaultToday: "true",
          today: new Date().toLocaleDateString("en-CA"),
          page,
          limit
        }
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
  },
  withAsker
);

export const fetchAllPaymentData = createAsyncThunk(
  "dashboard/fetchAllPaymentData",
  async (filters, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/dashboard/paymentTableAll`, { params: filters });
      if (!res.data.success) throw new Error(res.data.message);
      return res.data.data;
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || err.message);
    }
  },
  withAsker
);

export const payDriver = createAsyncThunk(
  "dashboard/payDriver",
  async ({ driverName, startDate, endDate, dataType, job }, { rejectWithValue }) => {
    try {
      const res = await axios.post(`/admin/dashboard/payDriver`, { driverName, startDate, endDate, dataType, job, today: new Date().toLocaleDateString("en-CA") });
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

const initialState = {
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
  // Choosing a city reloads its drivers and routes. That must not blank the whole page, so it has its own flags apart from `loading`
  // (the first load of the dropdowns), and only the answer to the latest request is used.
  driversLoading: false,
  routesLoading: false,
  driversRequestId: null,
  routesRequestId: null,
  paymentLoading: false,
  allPaymentLoading: false,
  summaryLoading: false,
  paymentProcessing: false,
  error: null,
  paymentError: null,
  summaryError: null,
  isFiltered: false,
  showTodayOnly: false, // ✅ NEW: Track if showing only today's data
  // Reads on their way, by request ID, each with who asked; and who asked for the table that is held now.
  inFlight: {},
  tableOwnerId: null,
};

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState,
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
        const asked = settle(state, action);
        if (!asked) return;
        state.loading = false;
        state.cities = action.payload.cities || [];
        state.drivers = action.payload.drivers || [];
        state.routes = action.payload.routes || [];
      })
      .addCase(fetchDashboardData.rejected, (state, action) => {
        const asked = settle(state, action);
        if (!asked) return;
        state.loading = false;
        state.error = action.payload;
      })
      // Handle driver filter by city
      .addCase(fetchDriversByCity.pending, (state, action) => {
        state.driversLoading = true;
        state.driversRequestId = action.meta.requestId;
        state.drivers = []; // never leave the previous city's drivers to choose from
        state.error = null;
      })
      .addCase(fetchDriversByCity.fulfilled, (state, action) => {
        const asked = settle(state, action);
        if (!asked || state.driversRequestId !== action.meta.requestId) return;
        state.driversLoading = false;
        state.drivers = action.payload || [];
      })
      .addCase(fetchDriversByCity.rejected, (state, action) => {
        const asked = settle(state, action);
        if (!asked || state.driversRequestId !== action.meta.requestId) return;
        state.driversLoading = false;
        state.error = action.payload;
      })
      // ✅ NEW: Handle route filter by city
      .addCase(fetchRoutesByCity.pending, (state, action) => {
        state.routesLoading = true;
        state.routesRequestId = action.meta.requestId;
        state.routes = [];
        state.error = null;
      })
      .addCase(fetchRoutesByCity.fulfilled, (state, action) => {
        const asked = settle(state, action);
        if (!asked || state.routesRequestId !== action.meta.requestId) return;
        state.routesLoading = false;
        state.routes = action.payload || [];
      })
      .addCase(fetchRoutesByCity.rejected, (state, action) => {
        const asked = settle(state, action);
        if (!asked || state.routesRequestId !== action.meta.requestId) return;
        state.routesLoading = false;
        state.error = action.payload;
      })
      .addCase(fetchSummaryData.pending, (state) => {
        state.summaryLoading = true;
        state.summaryError = null;
      })
      .addCase(fetchSummaryData.fulfilled, (state, action) => {
        const asked = settle(state, action);
        if (!asked) return;
        state.summaryLoading = false;
        state.summaryData = action.payload;
      })
      .addCase(fetchSummaryData.rejected, (state, action) => {
        const asked = settle(state, action);
        if (!asked) return;
        state.summaryLoading = false;
        state.summaryError = action.payload;
      })
      .addCase(fetchFilteredPaymentData.pending, (state) => {
        state.paymentLoading = true;
        state.paymentError = null;
      })
      .addCase(fetchFilteredPaymentData.fulfilled, (state, action) => {
        const asked = settle(state, action);
        if (!asked) return;
        state.tableOwnerId = asked.adminId;
        state.paymentLoading = false;
        state.filteredPaymentData = action.payload.data;
        state.pagination = action.payload.pagination;
        state.filters = action.payload.filters;
        state.isFiltered = true;
        state.showTodayOnly = false; // ✅ Not showing today-only view
      })
      .addCase(fetchFilteredPaymentData.rejected, (state, action) => {
        const asked = settle(state, action);
        if (!asked) return;
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
        const asked = settle(state, action);
        if (!asked) return;
        state.tableOwnerId = asked.adminId;
        state.paymentLoading = false;
        state.filteredPaymentData = action.payload.data;
        state.pagination = action.payload.pagination;
        state.filters = action.payload.filters;
        state.isFiltered = true;
        state.showTodayOnly = true; // ✅ Mark as showing today's data
      })
      .addCase(fetchTodayPaymentData.rejected, (state, action) => {
        const asked = settle(state, action);
        if (!asked) return;
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
        const asked = settle(state, action);
        if (!asked) return;
        state.allPaymentLoading = false;
        state.allPaymentData = action.payload;
      })
      .addCase(fetchAllPaymentData.rejected, (state, action) => {
        const asked = settle(state, action);
        if (!asked) return;
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

    // A read is recorded when it starts.
    builder.addMatcher(
      isAnyOf(
        fetchDashboardData.pending, fetchDriversByCity.pending, fetchRoutesByCity.pending, fetchSummaryData.pending,
        fetchFilteredPaymentData.pending, fetchTodayPaymentData.pending, fetchAllPaymentData.pending
      ),
      (state, action) => {
        state.inFlight[action.meta.requestId] = { adminId: action.meta.adminId };
      }
    );

    // The session boundary: signing out (at its start, whatever its outcome), signing in, or the server ending the session. Everything held
    // here ends with the session that received it, and the epoch moves on so an answer still on its way is dropped when it arrives.
    builder.addMatcher(
      isAnyOf(adminLogout.pending, adminLogout.fulfilled, adminLogout.rejected, manualLogout, adminLogin.pending, adminLogin.fulfilled),
      () => ({ ...initialState, inFlight: {} })
    );
    // A failed access check that is not just a lost connection means the session is gone.
    builder.addMatcher(
      (action) => accessAdminUser.rejected.match(action) && !action.payload?.transient,
      () => ({ ...initialState, inFlight: {} })
    );
  },
});

export const { clearFilteredData, setDataType } = dashboardSlice.actions;
export default dashboardSlice.reducer;