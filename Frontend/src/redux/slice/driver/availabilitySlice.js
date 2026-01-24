import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { translateError } from "../../../hooks/backendI18n.js";

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

// ================= DRIVER =================

// Driver: Get own availability
export const getDriverAvailability = createAsyncThunk(
  "availability/getDriverAvailability",
  async (_, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const response = await axios.get(`/driver/availability`, {
        headers: { "X-Language": lang }
      });
      return response.data.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(
        error.response?.data?.message || translateError(lang, 'availability.failedToFetch')
      );
    }
  }
);

// Driver: Update own availability
export const updateDriverAvailability = createAsyncThunk(
  "availability/updateDriverAvailability",
  async ({ availability, timezone }, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const response = await axios.post(`/driver/availability`,
        { availability },
        {
          headers: {
            "X-Language": lang,
            "X-User-Timezone": timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
          }
        }
      );
      return response.data.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(
        error.response?.data?.message || translateError(lang, 'availability.failedToUpdate')
      );
    }
  }
);

// ================= ADMIN =================

// Admin: Get all drivers availability
export const getAllDriversAvailability = createAsyncThunk(
  "availability/getAllDriversAvailability",
  async ({ filterDay = null, page = 1, limit = 10, searchQuery = null, filterCity = null }, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const params = { page, limit, searchQuery };
      if (filterDay) params.day = filterDay;
      if (filterCity) params.city = filterCity;

      const response = await axios.get(`/admin/drivers/availability`, {
        params,
        headers: { "X-Language": lang }
      });

      return {
        data: response.data.data,
        pagination: response.data.pagination,
      };
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(
        error.response?.data?.message || translateError(lang, 'availability.failedToFetchDrivers')
      );
    }
  }
);

// Admin: Get available cities for filter
export const getAvailableCities = createAsyncThunk(
  "availability/getAvailableCities",
  async (_, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const response = await axios.get(`/admin/drivers/availability/cities`, {
        headers: { "X-Language": lang }
      });
      return response.data.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(
        error.response?.data?.message || translateError(lang, 'availability.failedToFetchCities')
      );
    }
  }
);

// NEW: Admin: Get global availability counts (across all pages)
export const getGlobalAvailabilityCounts = createAsyncThunk(
  "availability/getGlobalAvailabilityCounts",
  async ({ searchQuery = null, filterCity = null }, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const params = { searchQuery };
      if (filterCity) params.city = filterCity;

      const response = await axios.get(`/admin/drivers/availability/counts`, {
        params,
        headers: { "X-Language": lang }
      });
      return response.data.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(
        error.response?.data?.message || translateError(lang, 'availability.failedToFetchCounts')
      );
    }
  }
);

// Admin update specific driver's availability
export const updateDriverAvailabilityByAdmin = createAsyncThunk(
  "availability/updateDriverAvailabilityByAdmin",
  async ({ driverId, availability }, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const response = await axios.put(`/admin/drivers/availability/${driverId}`,
        { availability },
        { headers: { "X-Language": lang } }
      );
      return response.data.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(
        error.response?.data?.message || translateError(lang, 'availability.failedToUpdateDriver')
      );
    }
  }
);

// Admin manual reset all drivers availability (Superadmin only)
export const manualResetAllDriversAvailability = createAsyncThunk(
  "availability/manualResetAllDriversAvailability",
  async (_, { rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const response = await axios.post(`/admin/drivers/availability/reset-all`, {}, {
        headers: { "X-Language": lang }
      });
      return response.data.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      return rejectWithValue(
        error.response?.data?.message || translateError(lang, 'availability.failedToResetAll')
      );
    }
  }
);

// ================= SLICE =================

const availabilitySlice = createSlice({
  name: "availability",
  initialState: {
    driverAvailability: {
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
    },
    allDriversAvailability: [],
    availableCities: [],
    globalCounts: {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
      saturday: 0,
      sunday: 0
    },
    pagination: null,
    updatedAt: null,
    loading: false,
    updateLoading: false,
    citiesLoading: false,
    countsLoading: false,
    resetLoading: false,
    error: null,
    successMessage: null,
  },
  reducers: {
    clearMessages: (state) => {
      state.error = null;
      state.successMessage = null;
    },
    resetAvailability: (state) => {
      state.driverAvailability = {
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      };
      state.updatedAt = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // ===== DRIVER GET =====
      .addCase(getDriverAvailability.pending, (state) => {
        state.loading = true;
      })
      .addCase(getDriverAvailability.fulfilled, (state, action) => {
        state.loading = false;
        state.driverAvailability = action.payload.availability;
        state.updatedAt = action.payload.availability_updated_at;
      })
      .addCase(getDriverAvailability.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== DRIVER UPDATE =====
      .addCase(updateDriverAvailability.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateDriverAvailability.fulfilled, (state, action) => {
        state.loading = false;
        state.driverAvailability = action.payload.availability;
        state.updatedAt = action.payload.availability_updated_at;
        const lang = getCurrentLanguage();
        state.successMessage = translateError(lang, 'availability.updatedSuccessfully');
      })
      .addCase(updateDriverAvailability.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== ADMIN GET ALL =====
      .addCase(getAllDriversAvailability.pending, (state) => {
        state.loading = true;
      })
      .addCase(getAllDriversAvailability.fulfilled, (state, action) => {
        state.loading = false;
        state.allDriversAvailability = action.payload.data;
        state.pagination = action.payload.pagination;
      })
      .addCase(getAllDriversAvailability.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== ADMIN GET CITIES =====
      .addCase(getAvailableCities.pending, (state) => {
        state.citiesLoading = true;
      })
      .addCase(getAvailableCities.fulfilled, (state, action) => {
        state.citiesLoading = false;
        state.availableCities = action.payload;
      })
      .addCase(getAvailableCities.rejected, (state, action) => {
        state.citiesLoading = false;
        state.error = action.payload;
      })

      // ===== ADMIN GET GLOBAL COUNTS =====
      .addCase(getGlobalAvailabilityCounts.pending, (state) => {
        state.countsLoading = true;
      })
      .addCase(getGlobalAvailabilityCounts.fulfilled, (state, action) => {
        state.countsLoading = false;
        state.globalCounts = action.payload;
      })
      .addCase(getGlobalAvailabilityCounts.rejected, (state, action) => {
        state.countsLoading = false;
        state.error = action.payload;
      })

      // ===== ADMIN UPDATE DRIVER AVAILABILITY =====
      .addCase(updateDriverAvailabilityByAdmin.pending, (state) => {
        state.updateLoading = true;
      })
      .addCase(updateDriverAvailabilityByAdmin.fulfilled, (state, action) => {
        state.updateLoading = false;
        const lang = getCurrentLanguage();
        state.successMessage = translateError(lang, 'availability.driverAvailabilityUpdated');

        const index = state.allDriversAvailability.findIndex(
          (driver) => driver.id === action.payload.id
        );

        if (index !== -1) {
          state.allDriversAvailability[index].availability =
            action.payload.availability;
          state.allDriversAvailability[index].availability_updated_at =
            action.payload.availability_updated_at;
        }
      })
      .addCase(updateDriverAvailabilityByAdmin.rejected, (state, action) => {
        state.updateLoading = false;
        state.error = action.payload;
      })

      // ===== ADMIN MANUAL RESET ALL =====
      .addCase(manualResetAllDriversAvailability.pending, (state) => {
        state.resetLoading = true;
        state.error = null;
      })
      .addCase(manualResetAllDriversAvailability.fulfilled, (state, action) => {
        state.resetLoading = false;
        const lang = getCurrentLanguage();
        state.successMessage = translateError(lang, 'availability.resetSuccess', {
          total: action.payload.totalDriversReset,
          enabled: action.payload.enabledDriversReset,
          disabled: action.payload.disabledDriversReset
        });

        // Reset all drivers in the current list to have all days = false
        state.allDriversAvailability = state.allDriversAvailability.map(
          (driver) => ({
            ...driver,
            availability: {
              monday: false,
              tuesday: false,
              wednesday: false,
              thursday: false,
              friday: false,
              saturday: false,
              sunday: false,
            },
            availability_updated_at: action.payload.resetTimestamp,
          })
        );

        // Reset global counts to 0
        state.globalCounts = {
          monday: 0,
          tuesday: 0,
          wednesday: 0,
          thursday: 0,
          friday: 0,
          saturday: 0,
          sunday: 0
        };

        // Also reset driver's own availability if they're viewing it
        state.driverAvailability = {
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
        };
        state.updatedAt = action.payload.resetTimestamp;
      })
      .addCase(manualResetAllDriversAvailability.rejected, (state, action) => {
        state.resetLoading = false;
        state.error = action.payload;
      });
  },
});

export const { clearMessages, resetAvailability } =
  availabilitySlice.actions;

export default availabilitySlice.reducer;