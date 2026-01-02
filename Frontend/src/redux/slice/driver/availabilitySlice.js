import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { API_BASE_URL } from "../../../config";

// ================= AUTH HELPERS =================
const getDriverAuthHeaders = () => {
  const token = localStorage.getItem("driverToken");
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};

const getAdminAuthHeaders = () => {
  const token = localStorage.getItem("adminToken");
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};

// ================= DRIVER =================

// Driver: Get own availability
export const getDriverAvailability = createAsyncThunk(
  "availability/getDriverAvailability",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/driver/availability`,
        {
          headers: getDriverAuthHeaders(),
        }
      );
      return response.data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch availability"
      );
    }
  }
);

// Driver: Update own availability
export const updateDriverAvailability = createAsyncThunk(
  "availability/updateDriverAvailability",
  async (availability, { rejectWithValue }) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/driver/availability`,
        { availability },
        {
          headers: getDriverAuthHeaders(),
        }
      );
      return response.data.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to update availability"
      );
    }
  }
);

// ================= ADMIN =================

// Admin: Get all drivers availability with pagination
export const getAllDriversAvailability = createAsyncThunk(
  "availability/getAllDriversAvailability",
  async ({ filterDay = null, page = 1, limit = 10 }, { rejectWithValue }) => {
    try {
      let url = `${API_BASE_URL}/admin/drivers/availability?page=${page}&limit=${limit}`;
      
      if (filterDay) {
        url += `&day=${filterDay}`;
      }

      const response = await axios.get(url, {
        headers: getAdminAuthHeaders(),
      });

      return {
        data: response.data.data,
        pagination: response.data.pagination
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ||
          "Failed to fetch drivers availability"
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
    pagination: null,
    updatedAt: null,
    loading: false,
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
      // ===== GET DRIVER AVAILABILITY =====
      .addCase(getDriverAvailability.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getDriverAvailability.fulfilled, (state, action) => {
        state.loading = false;
        state.driverAvailability =
          action.payload.availability || state.driverAvailability;
        state.updatedAt = action.payload.availability_updated_at;
      })
      .addCase(getDriverAvailability.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== UPDATE DRIVER AVAILABILITY =====
      .addCase(updateDriverAvailability.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.successMessage = null;
      })
      .addCase(updateDriverAvailability.fulfilled, (state, action) => {
        state.loading = false;
        state.driverAvailability = action.payload.availability;
        state.updatedAt = action.payload.availability_updated_at;
        state.successMessage = "Availability updated successfully";
      })
      .addCase(updateDriverAvailability.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // ===== ADMIN GET ALL WITH PAGINATION =====
      .addCase(getAllDriversAvailability.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getAllDriversAvailability.fulfilled, (state, action) => {
        state.loading = false;
        state.allDriversAvailability = action.payload.data;
        state.pagination = action.payload.pagination;
      })
      .addCase(getAllDriversAvailability.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearMessages, resetAvailability } =
  availabilitySlice.actions;
export default availabilitySlice.reducer;