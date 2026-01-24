import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { translateError } from "../../../hooks/backendI18n.js";

// Get current language from localStorage or default to 'en'
const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

// Fetch deliveries for driver with request cancellation support
export const fetchDeliverySummary = createAsyncThunk(
  "delivery/fetchDeliverySummary",
  async ({ driverId, from_date, to_date }, { signal, rejectWithValue }) => {
    try {
      const lang = getCurrentLanguage();

      // Input validation
      if (!driverId) {
        return rejectWithValue(translateError(lang, 'driver.driverIdRequired'));
      }

      if (!from_date || !to_date) {
        return rejectWithValue(translateError(lang, 'delivery.bothDatesRequiredShort'));
      }

      const res = await axios.get(`/driver/deliveries/${driverId}`, {
        params: { from_date, to_date },
        headers: { "X-Language": lang },
        signal,
      });

      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      const lang = getCurrentLanguage();
      if (err.name === 'AbortError' || axios.isCancel(err)) {
        return rejectWithValue(translateError(lang, 'delivery.requestCancelled'));
      }
      console.error("fetchDeliverySummary error:", err);
      return rejectWithValue(err.response?.data?.message || err.message || translateError(lang, 'delivery.errorFetching'));
    }
  }
);

const deliverySlice = createSlice({
  name: "delivery",
  initialState: {
    deliveries: [],
    status: "idle", // idle | loading | succeeded | failed
    error: null,
    lastFetch: null, // Track when data was last fetched
  },
  reducers: {
    // Clear error state
    clearDeliveryError: (state) => {
      state.error = null;
    },

    // Reset deliveries state
    resetDeliveries: (state) => {
      state.deliveries = [];
      state.status = "idle";
      state.error = null;
      state.lastFetch = null;
    },

    // Set deliveries from cache without triggering loading state
    setDeliveriesFromCache: (state, action) => {
      state.deliveries = action.payload;
      state.status = "succeeded";
      state.error = null;
      // Don't update lastFetch for cached data
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDeliverySummary.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchDeliverySummary.fulfilled, (state, action) => {
        state.status = "succeeded";
        console.log("Deliveries ", action.payload);
        state.deliveries = action.payload;
        state.error = null;
        state.lastFetch = Date.now();
      })
      .addCase(fetchDeliverySummary.rejected, (state, action) => {
        const lang = getCurrentLanguage();
        // Don't set error state for cancelled requests
        if (action.payload !== translateError(lang, 'delivery.requestCancelled')) {
          state.status = "failed";
          state.error = action.payload || translateError(lang, 'delivery.failedToFetch');
          state.deliveries = []; // Clear deliveries on error
        }
      });
  },
});

export const { clearDeliveryError, resetDeliveries, setDeliveriesFromCache } = deliverySlice.actions;
export default deliverySlice.reducer;