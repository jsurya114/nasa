import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { translateError } from "../../../hooks/backendI18n.js";

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

/**
 * Update driver password
 * @param {Object} passwordData - { oldPassword, newPassword, confirmPassword }
 */
export const updatePassword = createAsyncThunk(
  "password/updatePassword",
  async (passwordData, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const res = await axios.post(`/driver/update-password`, passwordData, {
        headers: { "X-Language": lang }
      });
      return res.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      console.error("updatePassword error:", error);
      return rejectWithValue(error.response?.data || {
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