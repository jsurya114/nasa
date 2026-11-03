import { createSlice, createAsyncThunk, isAnyOf } from "@reduxjs/toolkit"
import axios from "../axiosInstance"
import { accessAdminUser, adminLogin, adminLogout, manualLogout } from "./adminSlice"

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
  async (formData, { rejectWithValue, getState }) => {
    // Who started the upload. The answer holds role- and city-scoped data and is only ever shown to this administrator.
    const ownerAdminId = getState().admin?.admin?.id ?? null;
    try {
      const res = await axios.post(`/admin/doubleStop/weekly-upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return { ...res.data, ownerAdminId };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Weekly upload failed");
    }
  }
);

const emptyWeekly = () => ({ loading: false, success: null, message: null, error: null, data: null, result: null, ownerAdminId: null, activeRequestId: null });

const excelSlice = createSlice({
  name: "excel",
  initialState: {
    weekly: {
      loading: false,
      success: null,
      message: null,
      error: null,
      data: null,
      result: null, // the `data` of the answer: staging counts, assignmentHistory, claims
      ownerAdminId: null, // the administrator who started the upload the result belongs to
      activeRequestId: null, // only the answer to this request is accepted; any other is stale
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
      state.weekly = emptyWeekly();
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
      .addCase(excelWeeklyFileUpload.pending, (state, action) => {
        state.weekly.loading = true;
        state.weekly.error = null;
        state.weekly.success = false;
        state.weekly.result = null;
        state.weekly.ownerAdminId = null;
        state.weekly.activeRequestId = action.meta.requestId;
      })
      .addCase(excelWeeklyFileUpload.fulfilled, (state, action) => {
        // An answer that arrives after the session ended or changed, or after a newer upload began, is dropped.
        if (action.meta.requestId !== state.weekly.activeRequestId) return;
        state.weekly.activeRequestId = null;
        state.weekly.loading = false;
        state.weekly.success = action.payload.message;
        state.weekly.message = action.payload.message;
        state.weekly.data = action.payload.insertedData;
        state.weekly.result = action.payload.data ?? null;
        state.weekly.ownerAdminId = action.payload.ownerAdminId ?? null;
      })
      .addCase(excelWeeklyFileUpload.rejected, (state, action) => {
        if (action.meta.requestId !== state.weekly.activeRequestId) return;
        state.weekly.activeRequestId = null;
        state.weekly.loading = false;
        state.weekly.error = action.payload || "Error while Uploading";
      });

    // The session boundary. The weekly answer is role- and city-scoped, so it ends with the session that received it:
    // signing out (at its start, whatever its outcome), signing in, or the server ending the session. Resetting also
    // forgets the request in flight, so its late answer is dropped.
    const sessionEnded = isAnyOf(
      adminLogout.pending, adminLogout.fulfilled, adminLogout.rejected,
      manualLogout, adminLogin.pending, adminLogin.fulfilled
    );
    builder.addMatcher(sessionEnded, (state) => {
      state.weekly = emptyWeekly();
    });
    // A failed access check that is not just a lost connection means the session is gone.
    builder.addMatcher(
      (action) => accessAdminUser.rejected.match(action) && !action.payload?.transient,
      (state) => {
        state.weekly = emptyWeekly();
      }
    );
  },
});

// The weekly answer for the administrator who is signed in now, or null. Checked when it is read too, so a result is
// never shown to anyone but the administrator who started that upload, even if a boundary above were ever missed.
export const selectWeeklyResult = (state) => {
  const { result, ownerAdminId } = state.excel?.weekly ?? {};
  const current = state.admin;
  if (!result || !current?.isAuthenticated || ownerAdminId === null || current.admin?.id !== ownerAdminId) return null;
  return result;
};

export const { clearDailyState, clearWeeklyState } = excelSlice.actions
export default excelSlice.reducer;