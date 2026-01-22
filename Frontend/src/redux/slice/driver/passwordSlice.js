// redux/slice/driver/passwordSlice.js
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { API_BASE_URL } from "../../../config";
import { translateError } from "../../../hooks/backendI18n.js";

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('driverToken');
  const lang = getCurrentLanguage();
  return {
    "Content-Type": "application/json",
    "X-Language": lang, // Add language header
    ...(token && { "Authorization": `Bearer ${token}` })
  };
};

/**
 * Update driver password
 * @param {Object} passwordData - { oldPassword, newPassword, confirmPassword }
 */
export const updatePassword = createAsyncThunk(
  "password/updatePassword",
  async (passwordData, { rejectWithValue }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/driver/update-password`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(passwordData),
      });

      const data = await response.json();

      if (!response.ok) {
        // Return validation errors or error message
        return rejectWithValue(data);
      }

      return data;
    } catch (error) {
      const lang = getCurrentLanguage();
      console.error("updatePassword error:", error);
      return rejectWithValue({
        success: false,
        message: error.message || translateError(lang, 'auth.networkError'),
      });
    }
  }
);

const initialState = {
  status: "idle", // idle | loading | succeeded | failed
  error: null,
  errors: {}, // Field-specific validation errors
  successMessage: null,
};

const passwordSlice = createSlice({
  name: "password",
  initialState,
  reducers: {
    // Clear all errors
    clearErrors: (state) => {
      state.error = null;
      state.errors = {};
    },
    // Clear success message
    clearSuccessMessage: (state) => {
      state.successMessage = null;
    },
    // Reset password state
    resetPasswordState: (state) => {
      state.status = "idle";
      state.error = null;
      state.errors = {};
      state.successMessage = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Update password - pending
      .addCase(updatePassword.pending, (state) => {
        state.status = "loading";
        state.error = null;
        state.errors = {};
        state.successMessage = null;
      })
      // Update password - fulfilled
      .addCase(updatePassword.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.error = null;
        state.errors = {};
        const lang = getCurrentLanguage();
        state.successMessage = action.payload.message || translateError(lang, 'password.updatedSuccessfully');
      })
      // Update password - rejected
      .addCase(updatePassword.rejected, (state, action) => {
        state.status = "failed";
        const lang = getCurrentLanguage();
        
        // Handle validation errors
        if (action.payload?.errors) {
          state.errors = action.payload.errors;
          state.error = action.payload.message || translateError(lang, 'password.validationFailed');
        } else {
          state.error = action.payload?.message || translateError(lang, 'password.failedToUpdate');
          state.errors = {};
        }
        
        state.successMessage = null;
      });
  },
});

export const { clearErrors, clearSuccessMessage, resetPasswordState } = passwordSlice.actions;
export default passwordSlice.reducer;