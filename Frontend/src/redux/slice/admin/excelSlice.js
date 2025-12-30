import { createSlice, createAsyncThunk } from "@reduxjs/toolkit"
import { API_BASE_URL } from "../../../config"

// Helper function to get auth headers for file uploads
const getAuthHeaders = (isFormData = false) => {
  const token = localStorage.getItem('adminToken');
  const headers = {};
  
  // Don't set Content-Type for FormData - browser will set it with boundary
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
};

// Async thunk for daily file upload
export const excelDailyFileUpload = createAsyncThunk(
  'admin/uploadExcel',
  async (formData, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/doubleStop/dailyFileUpload`, {
        method: 'POST',
        body: formData,
        headers: getAuthHeaders(true), // true = FormData, don't set Content-Type
      })
      const data = await res.json()
      console.log(data, 'excel file upload status')
      if (!res.ok) {
        return rejectWithValue(data.message || 'Excel file upload failed')
      }
      return data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

// Async thunk for weekly file upload
export const excelWeeklyFileUpload = createAsyncThunk(
  "excel/uploadWeekly",
  async (formData, { rejectWithValue }) => {
    try {
      console.log("File from React ", formData);
      const res = await fetch(`${API_BASE_URL}/admin/doubleStop/weekly-upload`, {
        method: "POST",
        body: formData,
        headers: getAuthHeaders(true), // true = FormData, don't set Content-Type
      });
      
      if (!res.ok) {
        const error = await res.json();
        return rejectWithValue(error.message || "Weekly upload failed");
      }
      
      let data = await res.json();
      console.log(data, "Data from backend for weekly")
      return data;
    } catch (error) {
      return rejectWithValue(error.message);
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
        console.log("Excel upload", action.payload);
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