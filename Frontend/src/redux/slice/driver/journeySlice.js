import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { translateError } from "../../../hooks/backendI18n.js";

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

// Fetch all routes (for driver app) with request cancellation
export const fetchRoutes = createAsyncThunk(
  "routes/fetchRoutes",
  async (_, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const res = await axios.get(`/driver/routes-list`, {
        signal,
        headers: { 'X-Language': lang }
      });
      return res.data;
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchRoutes error:", error);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

export const fetchAdminRoutes = createAsyncThunk(
  "routes/fetchAdminRoutes",
  async (_, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const res = await axios.get(`/admin/routes-list`, {
        signal,
        headers: { 'X-Language': lang }
      });
      const data = res.data;
      return data.routes || data.data || data || [];
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchAdminRoutes error:", error);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

// Fetch today's journey with request cancellation
export const fetchTodayJourney = createAsyncThunk(
  "journeys/fetchTodayJourney",
  async (driver_id, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      if (!driver_id) {
        return rejectWithValue(translateError(lang, 'driver.driverIdRequired'));
      }

      const res = await axios.get(`/driver/journey/${driver_id}`, {
        signal,
        headers: { 'X-Language': lang }
      });
      return res.data.data || [];
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchTodayJourney error:", error);
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'journey.errorFetching'));
    }
  }
);

// Save journey
export const saveJourney = createAsyncThunk(
  "journeys/saveJourney",
  async (journeyData, { rejectWithValue }) => {
    try {
      const res = await axios.post(`/driver/journey`, journeyData);
      return res.data.data;
    } catch (error) {
      console.error("saveJourney error:", error);
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

// Fetch all journeys (admin)
export const fetchAllJourneys = createAsyncThunk(
  "journeys/fetchAllJourneys",
  async (_, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const res = await axios.get(`/admin/journeys`, {
        signal,
        headers: { 'X-Language': lang }
      });
      return res.data.data || [];
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchAllJourneys error:", error);
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'journey.errorFetching'));
    }
  }
);

// ✅ Fetch paginated journeys with filters (admin)
export const fetchPaginatedJourneys = createAsyncThunk(
  "journeys/fetchPaginatedJourneys",
  async ({ page = 1, limit = 10, route_id, driver_name, journey_date } = {}, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const res = await axios.get(`/admin/journeys/paginated`, {
        signal,
        params: { page, limit, route_id, driver_name, journey_date },
        headers: { 'X-Language': lang }
      });

      const data = res.data;
      return {
        journeys: data.data || [],
        pagination: data.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 }
      };
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchPaginatedJourneys error:", error);
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'journey.errorFetching'));
    }
  }
);

// Add journey (admin)
export const addJourney = createAsyncThunk(
  "journeys/addJourney",
  async (journeyData, { rejectWithValue }) => {
    try {
      const res = await axios.post(`/admin/journey`, journeyData);
      return res.data.data;
    } catch (error) {
      console.error("addJourney error:", error);
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

// Update journey (admin)
export const updateJourney = createAsyncThunk(
  "journeys/updateJourney",
  async ({ journey_id, ...data }, { rejectWithValue }) => {
    try {
      const res = await axios.put(`/admin/journey/${journey_id}`, data);
      return res.data.data;
    } catch (error) {
      console.error("updateJourney error:", error);
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

// Delete journey (admin)
export const deleteJourney = createAsyncThunk(
  "journeys/deleteJourney",
  async (id, { rejectWithValue }) => {
    try {
      await axios.delete(`/admin/journey/${id}`);
      return id;
    } catch (error) {
      console.error("deleteJourney error:", error);
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

// Fetch all drivers (admin)
export const fetchAllDrivers = createAsyncThunk(
  "drivers/fetchAll",
  async (_, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      const res = await axios.get(`/admin/drivers`, {
        signal,
        headers: { 'X-Language': lang }
      });
      return res.data.data || [];
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchAllDrivers error:", error);
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'common.failed'));
    }
  }
);

// Fetch routes by driver ID (admin)
export const fetchRoutesByDriver = createAsyncThunk(
  "routes/fetchByDriver",
  async (driverId, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      if (!driverId) {
        return rejectWithValue(translateError(lang, 'driver.driverIdRequired'));
      }

      const res = await axios.get(`/admin/routes-by-driver/${driverId}`, {
        signal,
        headers: { 'X-Language': lang }
      });
      return res.data.data || [];
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchRoutesByDriver error:", error);
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'common.failed'));
    }
  }
);

// Fetch driver city type
export const fetchDriverCityType = createAsyncThunk(
  "driver/fetchCityType",
  async (driverId, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();
      if (!driverId) {
        return rejectWithValue(translateError(lang, 'driver.driverIdRequired'));
      }

      const res = await axios.get(`/driver/city-type/${driverId}`, {
        signal,
        headers: { 'X-Language': lang }
      });
      return res.data.cityType || "DAILY";
    } catch (error) {
      const lang = getCurrentLanguage();
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchDriverCityType error:", error);
      return rejectWithValue(error.response?.data?.message || translateError(lang, 'common.failed'));
    }
  }
);

const journeySlice = createSlice({
  name: "journey",
  initialState: {
    // Routes state
    routes: [],
    routesStatus: "idle",
    routesError: null,

    // Journey state (driver)
    journeys: [],
    journeyStatus: "idle",
    journeyError: null,

    // Admin journeys state (non-paginated)
    adminJourneys: [],
    adminStatus: "idle",
    adminError: null,

    // Paginated journeys state (admin)
    paginatedJourneys: [],
    paginatedStatus: "idle",
    paginatedError: null,
    pagination: {
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1
    },

    // Drivers state (admin)
    drivers: [],
    driversStatus: "idle",
    driversError: null,

    // City type state
    cityType: "DAILY", // Default
    cityTypeStatus: "idle",
  },
  reducers: {
    clearRoutesError: (state) => {
      state.routesError = null;
    },
    clearJourneyError: (state) => {
      state.journeyError = null;
      state.adminError = null;
      state.paginatedError = null;
    },
    resetRoutesStatus: (state) => {
      state.routesStatus = "idle";
    },
    resetJourneyStatus: (state) => {
      state.journeyStatus = "idle";
      state.adminStatus = "idle";
      state.paginatedStatus = "idle";
    },
    resetAllStatus: (state) => {
      state.routesStatus = "idle";
      state.journeyStatus = "idle";
      state.adminStatus = "idle";
      state.paginatedStatus = "idle";
      state.driversStatus = "idle";
      state.cityTypeStatus = "idle";
    },
    clearAllData: (state) => {
      state.routes = [];
      state.journeys = [];
      state.adminJourneys = [];
      state.paginatedJourneys = [];
      state.drivers = [];
      state.cityType = "DAILY";
    },
  },
  extraReducers: (builder) => {
    // ============ DRIVER ROUTES ============
    builder
      .addCase(fetchRoutes.pending, (state) => {
        state.routesStatus = "loading";
        state.routesError = null;
      })
      .addCase(fetchRoutes.fulfilled, (state, action) => {
        state.routesStatus = "succeeded";
        const routesData = action.payload?.routes || action.payload?.data || action.payload || [];
        state.routes = Array.isArray(routesData) ? routesData : [];
        state.routesError = null;
      })
      .addCase(fetchRoutes.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.routesStatus = "failed";
          state.routesError = action.payload || action.error.message;
        }
      });


    builder
      .addCase(fetchDriverCityType.pending, (state) => {
        state.cityTypeStatus = "loading";
      })
      .addCase(fetchDriverCityType.fulfilled, (state, action) => {
        state.cityTypeStatus = "succeeded";
        state.cityType = action.payload;
      })
      .addCase(fetchDriverCityType.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.cityTypeStatus = "failed";
          // Default to DAILY if fetch fails so driver can still work
          state.cityType = "DAILY";
        }
      });


    // ============ ADMIN ROUTES ============
    builder
      .addCase(fetchAdminRoutes.pending, (state) => {
        state.routesStatus = "loading";
        state.routesError = null;
      })
      .addCase(fetchAdminRoutes.fulfilled, (state, action) => {
        state.routesStatus = "succeeded";
        const routesData = action.payload?.routes || action.payload?.data || action.payload || [];
        state.routes = Array.isArray(routesData) ? routesData : [];
        state.routesError = null;
      })
      .addCase(fetchAdminRoutes.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.routesStatus = "failed";
          state.routesError = action.payload || action.error.message;
        }
      });

    // ============ TODAY'S JOURNEY ============
    builder
      .addCase(fetchTodayJourney.pending, (state) => {
        state.journeyStatus = "loading";
        state.journeyError = null;
      })
      .addCase(fetchTodayJourney.fulfilled, (state, action) => {
        state.journeyStatus = "succeeded";
        state.journeys = Array.isArray(action.payload) ? action.payload : [];
        state.journeyError = null;
      })
      .addCase(fetchTodayJourney.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.journeyStatus = "failed";
          state.journeyError = action.payload || action.error.message;
        }
      });

    // ============ SAVE JOURNEY ============
    builder
      .addCase(saveJourney.pending, (state) => {
        state.journeyStatus = "loading";
        state.journeyError = null;
      })
      .addCase(saveJourney.fulfilled, (state, action) => {
        state.journeyStatus = "succeeded";
        const exists = state.journeys.some(j => j.id === action.payload.id);
        if (!exists) {
          state.journeys.unshift(action.payload);
        }
        state.journeyError = null;
      })
      .addCase(saveJourney.rejected, (state, action) => {
        state.journeyStatus = "failed";
        state.journeyError = action.payload?.message || action.error.message;
      });

    // ============ ALL JOURNEYS (Non-paginated) ============
    builder
      .addCase(fetchAllJourneys.pending, (state) => {
        state.adminStatus = "loading";
        state.adminError = null;
      })
      .addCase(fetchAllJourneys.fulfilled, (state, action) => {
        state.adminStatus = "succeeded";
        state.adminJourneys = Array.isArray(action.payload) ? action.payload : [];
        state.adminError = null;
      })
      .addCase(fetchAllJourneys.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.adminStatus = "failed";
          state.adminError = action.payload || action.error.message;
        }
      });

    // ============ PAGINATED JOURNEYS ============
    builder
      .addCase(fetchPaginatedJourneys.pending, (state) => {
        state.paginatedStatus = "loading";
        state.paginatedError = null;
      })
      .addCase(fetchPaginatedJourneys.fulfilled, (state, action) => {
        state.paginatedStatus = "succeeded";
        state.paginatedJourneys = action.payload.journeys;
        state.pagination = action.payload.pagination;
        state.paginatedError = null;
      })
      .addCase(fetchPaginatedJourneys.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.paginatedStatus = "failed";
          state.paginatedError = action.payload || action.error.message;
        }
      });

    // ============ ADD JOURNEY ============
    builder
      .addCase(addJourney.pending, (state) => {
        state.paginatedStatus = "loading";
        state.paginatedError = null;
      })
      .addCase(addJourney.fulfilled, (state, action) => {
        state.paginatedStatus = "succeeded";
        // Don't modify paginatedJourneys here
        // Component will refetch to get accurate paginated data
        state.paginatedError = null;
      })
      .addCase(addJourney.rejected, (state, action) => {
        const isValidationError = action.payload?.errors && Object.keys(action.payload.errors).length > 0;
        state.paginatedStatus = isValidationError ? "succeeded" : "failed";
        const lang = getCurrentLanguage();
        state.paginatedError = action.payload?.message || translateError(lang, 'journey.errorInserting');
      });

    // ============ UPDATE JOURNEY ============
    builder
      .addCase(updateJourney.pending, (state) => {
        state.paginatedStatus = "loading";
        state.paginatedError = null;
      })
      .addCase(updateJourney.fulfilled, (state, action) => {
        state.paginatedStatus = "succeeded";
        // Optimistic update for immediate UI feedback
        const index = state.paginatedJourneys.findIndex(j => j.id === action.payload.id);
        if (index !== -1) {
          state.paginatedJourneys[index] = action.payload;
        }
        state.paginatedError = null;
      })
      .addCase(updateJourney.rejected, (state, action) => {
        const isValidationError = action.payload?.errors && Object.keys(action.payload.errors).length > 0;
        state.paginatedStatus = isValidationError ? "succeeded" : "failed";
        const lang = getCurrentLanguage();
        state.paginatedError = isValidationError
          ? null
          : (action.payload?.message || translateError(lang, 'journey.errorInserting'));
      });

    // ============ DELETE JOURNEY ============
    builder
      .addCase(deleteJourney.pending, (state) => {
        state.paginatedStatus = "loading";
        state.paginatedError = null;
      })
      .addCase(deleteJourney.fulfilled, (state, action) => {
        state.paginatedStatus = "succeeded";
        // Optimistic delete for immediate UI feedback
        state.paginatedJourneys = state.paginatedJourneys.filter(
          journey => journey.id !== action.payload
        );
        state.pagination.total = Math.max(0, state.pagination.total - 1);
        state.paginatedError = null;
      })
      .addCase(deleteJourney.rejected, (state, action) => {
        state.paginatedStatus = "failed";
        const lang = getCurrentLanguage();
        state.paginatedError = action.payload?.message || translateError(lang, 'common.failed');
      });

    // ============ DRIVERS ============
    builder
      .addCase(fetchAllDrivers.pending, (state) => {
        state.driversStatus = "loading";
        state.driversError = null;
      })
      .addCase(fetchAllDrivers.fulfilled, (state, action) => {
        state.driversStatus = "succeeded";
        state.drivers = Array.isArray(action.payload) ? action.payload : [];
        state.driversError = null;
      })
      .addCase(fetchAllDrivers.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.driversStatus = "failed";
          state.driversError = action.payload || action.error.message;
        }
      });

    // ============ ROUTES BY DRIVER ============
    builder
      .addCase(fetchRoutesByDriver.pending, (state) => {
        state.routesStatus = "loading";
        state.routesError = null;
      })
      .addCase(fetchRoutesByDriver.fulfilled, (state, action) => {
        state.routesStatus = "succeeded";
        const routesData = action.payload || [];
        state.routes = Array.isArray(routesData) ? routesData : [];
        state.routesError = null;
      })
      .addCase(fetchRoutesByDriver.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.routesStatus = "failed";
          state.routesError = action.payload || action.error.message;
        }
      });
  },
});

export const {
  clearRoutesError,
  clearJourneyError,
  resetRoutesStatus,
  resetJourneyStatus,
  resetAllStatus,
  clearAllData,
} = journeySlice.actions;

export default journeySlice.reducer;
