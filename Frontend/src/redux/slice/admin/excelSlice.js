import { createSlice, createAsyncThunk } from "@reduxjs/toolkit"
import axios from "../axiosInstance"

// Async thunk for daily file upload
export const excelDailyFileUpload = createAsyncThunk(
  'admin/uploadExcel',
  async (formData, { rejectWithValue }) => {
    try {
      const res = await axios.post(`/admin/doubleStop/dailyFileUpload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return res.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Excel file upload failed');
    }
  }
)

// Async thunk for weekly file upload
export const excelWeeklyFileUpload = createAsyncThunk(
  "excel/uploadWeekly",
  async (formData, { rejectWithValue }) => {
    try {
      const res = await axios.post(`/admin/doubleStop/weekly-upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return res.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Weekly upload failed");
    }
  }
);

const excelSlice = createSlice({
  name: "excel",
  initialState: {
    weekly: {
      loading: false,
      success: null,
      message: null,
      error: null,
      data: null,
    },
    daily: {
      loading: false,
      success: false,
      error: null,
      data: null,
    }
  },
  reducers: {
    clearWeeklyState: (state) => {
      state.weekly = { loading: false, success: false, error: null, data: null, message: null };
    },
    clearDailyState: (state) => {
      state.daily = { loading: false, success: false, error: null, data: null };
    },
  },
  extraReducers: (builder) => {
    // Daily Upload
    builder
      .addCase(excelDailyFileUpload.pending, (state) => {
        state.daily.loading = true;
        state.daily.error = null;
        state.daily.success = false;
      })
      .addCase(excelDailyFileUpload.fulfilled, (state) => {
        state.daily.loading = false;
        state.daily.success = true;
      })
      .addCase(excelDailyFileUpload.rejected, (state, action) => {
        state.daily.loading = false;
        state.daily.error = action.payload || "Upload failed";
      });

    // Weekly Upload
    builder
      .addCase(excelWeeklyFileUpload.pending, (state) => {
        state.weekly.loading = true;
        state.weekly.error = null;
        state.weekly.success = false;
      })
      .addCase(excelWeeklyFileUpload.fulfilled, (state, action) => {
        state.weekly.loading = false;
        state.weekly.success = action.payload.message;
        state.weekly.message = action.payload.message;
        state.weekly.data = action.payload.insertedData;
      })
      .addCase(excelWeeklyFileUpload.rejected, (state, action) => {
        state.weekly.loading = false;
        state.weekly.error = action.payload || "Error while Uploading";
      });
  },
});

export const { clearDailyState, clearWeeklyState } = excelSlice.actions
export default excelSlice.reducer;