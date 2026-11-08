import { createSlice, createAsyncThunk, isAnyOf } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { toast } from "react-toastify";
import { excelWeeklyFileUpload } from "./excelSlice.js";
import { accessAdminUser, adminLogin, adminLogout, manualLogout } from "./adminSlice";

// Async thunk to fetch driver payment data for specific date
export const fetchDriverPayment = createAsyncThunk(
  "driverPayment/fetchDriverPayment",
  async (date = null, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/doubleStop/calculatePayment`, {
        params: date ? { date } : {}
      });
      return res.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || "Something went wrong");
    }
  }
);

export const updateWeeklyExcelToDashboard = createAsyncThunk(
  "driverPayment/update-weekly-excel-to-dashboard",
  async (_, { rejectWithValue, getState }) => {
    try {
      const { id, role } = getState().admin?.admin ?? {};
      const res = await axios.post(`/admin/doubleStop/update-weekly-excel-to-dashboard`, {});
      return { ...res.data, revenueAdminId: id, revenueAdminRole: role };
    } catch (error) {
      return rejectWithValue(error.response?.data || "Something went wrong");
    }
  }
);

const driverPaymentSlice = createSlice({
  name: "driverPayment",
  initialState: {
    message: true,
    data: null,
    revenue: null, // what became of the GOFO revenue in the file that was just added (issue #252)
    revenueRequestId: null,
    revenueAdminId: null,
    revenueAdminRole: null,
    loading: false,
    error: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(excelWeeklyFileUpload.pending, (state) => {
        state.revenue = null;
        state.revenueRequestId = null;
      })
      .addCase(fetchDriverPayment.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDriverPayment.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
        toast.success(action.payload.message || "Driver payment calculated successfully!");
      })
      .addCase(fetchDriverPayment.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        toast.error(`Error: ${action.payload}`);
      })
      .addCase(updateWeeklyExcelToDashboard.pending, (state, action) => {
        state.loading = true;
        state.error = null;
        state.revenue = null;
        state.revenueRequestId = action.meta.requestId;
      })
      .addCase(updateWeeklyExcelToDashboard.fulfilled, (state, action) => {
        state.loading = false;
        state.data = null;
        if (state.revenueRequestId === action.meta.requestId) {
          state.revenue = action.payload?.revenue ?? null;
          state.revenueAdminId = action.payload?.revenueAdminId ?? null;
          state.revenueAdminRole = action.payload?.revenueAdminRole ?? null;
          state.revenueRequestId = null;
        }
      })
      .addCase(updateWeeklyExcelToDashboard.rejected, (state, action) => {
        state.loading = false;
        console.log(action.payload);
        state.error = action.payload;
        state.message = action.payload.message;
        if (state.revenueRequestId === action.meta.requestId) state.revenueRequestId = null;
      })
      .addMatcher(isAnyOf(adminLogout.pending, adminLogout.fulfilled, adminLogout.rejected, manualLogout, adminLogin.pending, adminLogin.fulfilled), (state) => {
        state.revenue = null;
        state.revenueRequestId = null;
      })
      .addMatcher((action) => accessAdminUser.rejected.match(action) && !action.payload?.transient, (state) => {
        state.revenue = null;
        state.revenueRequestId = null;
      });
  },
});

export const selectAppliedRevenue = (state) => {
  const { revenue, revenueAdminId, revenueAdminRole } = state.dashboard ?? {};
  const auth = state.admin;
  return auth?.isAuthenticated && auth.admin?.id != null && auth.admin.id === revenueAdminId && auth.admin.role === revenueAdminRole ? revenue : null;
};

export default driverPaymentSlice.reducer;
