// redux/slice/driver/accessCodeSlice.js
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { API_BASE_URL } from "../../../config";
import { translateError } from "../../../hooks/backendI18n.js";

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

// Helper function to get auth headers for file uploads
const getAuthHeaders = (isFormData = false) => {
  const token = localStorage.getItem('driverToken');
  const lang = getCurrentLanguage();
  const headers = {};

  // Don't set Content-Type for FormData - browser will set it with boundary
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  // Add language header
  headers['X-Language'] = lang;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
};

// Fetch paginated access codes
export const fetchAccessCodes = createAsyncThunk(
  "driverAccessCodes/fetchAccessCodes",
  async ({ page = 1, limit = 10, search = '', zipCodeFilter = '' } = {}, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(search && { search }),
        ...(zipCodeFilter && { zip_code: zipCodeFilter })
      });

      const res = await fetch(`${API_BASE_URL}/driver/access-codes/list?${params}`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      return data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(error.message || translateError(lang, 'accessCode.failedToFetch'));
    }
  }
);

// Create an access code
export const createAccessCode = createAsyncThunk(
  "driverAccessCodes/createAccessCode",
  async (accessCodeData, { rejectWithValue, dispatch, getState }) => {
    try {
      const lang = getCurrentLanguage();
      let body;
      if (typeof FormData !== 'undefined' && accessCodeData instanceof FormData) {
        body = accessCodeData; // browser will set multipart boundaries
      } else {
        const form = new FormData();
        if (accessCodeData && typeof accessCodeData === 'object') {
          if (accessCodeData.zip_code) form.append('zip_code', accessCodeData.zip_code);
          if (accessCodeData.address) form.append('address', accessCodeData.address);
          if (accessCodeData.access_code) form.append('access_code', accessCodeData.access_code);
          const images = accessCodeData.images || [];
          images.slice(0, 3).forEach((f) => form.append('images', f));
        }
        body = form;
      }

      const res = await fetch(`${API_BASE_URL}/driver/access-codes`, {
        method: "POST",
        headers: getAuthHeaders(true), // true = FormData
        body,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || `HTTP ${res.status}: ${translateError(lang, 'accessCode.failedToCreate')}`);
      }

      const data = await res.json();

      // Refetch with current pagination settings
      const { currentPage, pageLimit, searchTerm, zipCodeFilter } = getState().driverAccessCodes;
      dispatch(fetchAccessCodes({
        page: currentPage,
        limit: pageLimit,
        search: searchTerm,
        zipCodeFilter
      }));

      return data.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(error.message || translateError(lang, 'accessCode.failedToCreate'));
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
      })
      // Create access code
      .addCase(createAccessCode.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(createAccessCode.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(createAccessCode.rejected, (state, action) => {
        state.status = "failed";
        const lang = getCurrentLanguage();
        state.error = action.payload || action.error.message || translateError(lang, 'accessCode.failedToCreate');
      });
  },
});

export const { clearError, resetStatus, setPage, setPageLimit, setSearchTerm, setZipCodeFilter } = driverAccessCodeSlice.actions;
export default driverAccessCodeSlice.reducer;