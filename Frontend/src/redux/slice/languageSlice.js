import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from './axiosInstance';
import { translateError } from "../../hooks/backendI18n.js"

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

// Load driver's preferred language from backend
export const loadDriverLanguage = createAsyncThunk(
  'language/loadDriverLanguage',
  async (driverId, { rejectWithValue }) => {
    if (!driverId) {
      const lang = getCurrentLanguage();
      return rejectWithValue(translateError(lang, 'driver.driverIdMissing'));
    }

    try {
      const lang = getCurrentLanguage();
      const response = await axios.get(`/driver/language/${driverId}`, {
        headers: { 'X-Language': lang }
      });

      const preferredLanguage = response.data.preferredLanguage || 'en';

      // Store in localStorage for immediate access
      localStorage.setItem('preferredLanguage', preferredLanguage);

      return preferredLanguage;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'language.failedToLoad'));
    }
  }
);

// Save driver's language preference to backend
export const saveDriverLanguage = createAsyncThunk(
  'language/saveDriverLanguage',
  async ({ driverId, language }, { rejectWithValue }) => {
    if (!driverId) {
      const lang = getCurrentLanguage();
      return rejectWithValue(translateError(lang, 'driver.driverIdMissing'));
    }

    try {
      const currentLang = getCurrentLanguage();
      await axios.put(`/driver/language`,
        { driverId, language },
        { headers: { 'X-Language': currentLang } }
      );

      // Store in localStorage for immediate access
      localStorage.setItem('preferredLanguage', language);

      return language;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'language.failedToSave'));
    }
  }
);

const initialState = {
  currentLanguage: getCurrentLanguage(), // Load from localStorage on init
  loading: false,
  error: null,
};

const languageSlice = createSlice({
  name: 'language',
  initialState,
  reducers: {
    // Set language locally (for immediate UI updates)
    setLanguageLocal: (state, action) => {
      state.currentLanguage = action.payload;
      localStorage.setItem('preferredLanguage', action.payload);
    },
    // Reset language to default
    resetLanguage: (state) => {
      state.currentLanguage = 'en';
      state.loading = false;
      state.error = null;
      localStorage.setItem('preferredLanguage', 'en');
    },
    // Clear error
    clearLanguageError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Load driver language
      .addCase(loadDriverLanguage.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadDriverLanguage.fulfilled, (state, action) => {
        state.currentLanguage = action.payload;
        state.loading = false;
      })
      .addCase(loadDriverLanguage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.currentLanguage = 'en'; // Fallback to English on error
        localStorage.setItem('preferredLanguage', 'en');
      })
      // Save driver language
      .addCase(saveDriverLanguage.pending, (state) => {
        state.loading = true;
      })
      .addCase(saveDriverLanguage.fulfilled, (state, action) => {
        state.currentLanguage = action.payload;
        state.loading = false;
      })
      .addCase(saveDriverLanguage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { setLanguageLocal, resetLanguage, clearLanguageError } = languageSlice.actions;
export default languageSlice.reducer;