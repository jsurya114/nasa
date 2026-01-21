import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

import { API_BASE_URL } from '../../config';

// Load driver's preferred language from backend
export const loadDriverLanguage = createAsyncThunk(
  'language/loadDriverLanguage',
  async (driverId, { rejectWithValue }) => {
    if (!driverId) {
  throw new Error("Driver ID missing");
}


    try {
    const token = localStorage.getItem('driverToken');
if (!token) {
  return rejectWithValue("Authentication token missing");
}
      const response = await axios.get(`${API_BASE_URL}/driver/language/${driverId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.preferredLanguage || 'en';
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to load language');
    }
  }
);

// Save driver's language preference to backend
export const saveDriverLanguage = createAsyncThunk(
  'language/saveDriverLanguage',
  async ({ driverId, language }, { rejectWithValue }) => {
    if (!driverId) {
  throw new Error("Driver ID missing");
}


    try {
   const token = localStorage.getItem('driverToken');
if (!token) {
  return rejectWithValue("Authentication token missing");
}
      await axios.put(
        `${API_BASE_URL}/driver/language`,
        { driverId, language },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return language;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to save language');
    }
  }
);

const initialState = {
  currentLanguage: 'en', // Default before driver logs in
  loading: false,
  error: null,
};

const languageSlice = createSlice({
  name: 'language',
  initialState,
  reducers: {
    setLanguageLocal: (state, action) => {
      state.currentLanguage = action.payload;
    },
    resetLanguage: (state) => {
      state.currentLanguage = 'en';
      state.loading = false;
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

export const { setLanguageLocal, resetLanguage } = languageSlice.actions;
export default languageSlice.reducer;
