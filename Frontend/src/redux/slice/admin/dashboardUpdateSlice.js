import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { toast } from "react-toastify";

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
  async (_, { rejectWithValue }) => {
    try {
      const res = await axios.post(`/admin/doubleStop/update-weekly-excel-to-dashboard`, {});
      console.log("Data after updating data in dashboard ", res.data);
      return res.data;
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
    loading: false,
    error: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
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
      .addCase(updateWeeklyExcelToDashboard.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.revenue = null;
      })
      .addCase(updateWeeklyExcelToDashboard.fulfilled, (state, action) => {
        state.loading = false;
        state.data = null;
        state.revenue = action.payload?.revenue ?? null;
      })
      .addCase(updateWeeklyExcelToDashboard.rejected, (state, action) => {
        state.loading = false;
        console.log(action.payload);
        state.error = action.payload;
        state.message = action.payload.message;
      });
  },
});

export default driverPaymentSlice.reducer;