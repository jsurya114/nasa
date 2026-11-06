import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { translateError } from "../../../hooks/backendI18n.js";

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

// Fetch paginated access codes
export const fetchAccessCodes = createAsyncThunk(
  "driverAccessCodes/fetchAccessCodes",
  async ({ page = 1, limit = 10, search = '', zipCodeFilter = '' } = {}, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const res = await axios.get(`/driver/access-codes/list`, {
        params: { page, limit, search, zip_code: zipCodeFilter },
        headers: { 'X-Language': lang }
      });
      return res.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(error.response?.data?.message || error.message || translateError(lang, 'accessCode.failedToFetch'));
    }
  }
);

const driverAccessCodeSlice = createSlice({
  name: "driverAccessCodes",
  initialState: {
    accessCodes: [],
    status: "idle",
    error: null,
    currentPage: 1,
    pageLimit: 10,
    totalPages: 0,
    totalItems: 0,
    hasMore: false,
    searchTerm: '',
    zipCodeFilter: '',
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    resetStatus: (state) => {
      state.status = "idle";
    },
    setPage: (state, action) => {
      state.currentPage = action.payload;
    },
    setPageLimit: (state, action) => {
      state.pageLimit = action.payload;
      state.currentPage = 1;
    },
    setSearchTerm: (state, action) => {
      state.searchTerm = action.payload;
      state.currentPage = 1;
    },
    setZipCodeFilter: (state, action) => {
      state.zipCodeFilter = action.payload;
      state.currentPage = 1;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch access codes
      .addCase(fetchAccessCodes.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchAccessCodes.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.accessCodes = action.payload.data || [];
        state.totalPages = action.payload.pagination?.totalPages || 0;
        state.totalItems = action.payload.pagination?.total || 0;
        state.hasMore = action.payload.pagination?.hasMore || false;
        state.error = null;
      })
      .addCase(fetchAccessCodes.rejected, (state, action) => {
        state.status = "failed";
        const lang = getCurrentLanguage();
        state.error = action.payload || action.error.message || translateError(lang, 'accessCode.failedToFetch');
      });
  },
});

export const { clearError, resetStatus, setPage, setPageLimit, setSearchTerm, setZipCodeFilter } = driverAccessCodeSlice.actions;
export default driverAccessCodeSlice.reducer;