import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

// Fetch paginated jobs with search and request cancellation support
export const fetchPaginatedJobs = createAsyncThunk(
  "jobs/fetchPaginated",
  async ({ page, limit, search = "", status = "all" }, { signal, rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/jobs`, {
        signal,
        params: { page, limit, search, status }
      });
      return res.data;
    } catch (error) {
      if (error.name === 'AbortError' || axios.isCancel(error)) {
        return rejectWithValue('Request cancelled');
      }
      console.error("fetchPaginatedJobs error:", error.response?.data?.message || error.message);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

// Fetch all jobs
export const fetchJobs = createAsyncThunk(
  "jobs/fetchJobs",
  async (_, { rejectWithValue }) => {
    try {
      const res = await axios.get(`/admin/jobs`);
      return res.data;
    } catch (error) {
      console.error("fetchJobs error:", error.response?.data?.message || error.message);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

// Add a job
export const addJob = createAsyncThunk(
  "jobs/addJob",
  async ({ job, city_code, enabled, city_type }, { rejectWithValue }) => {
    try {
      console.log('Adding job with city_type:', city_type);
      const res = await axios.post(`/admin/addjob`, {
        job,
        city_code,
        enabled,
        city_type: city_type || 'DAILY'
      });
      console.log('Job added successfully:', res.data);
      return res.data;
    } catch (error) {
      console.error("addJob error:", error.response?.data?.message || error.message);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

// Update a job
export const updateJob = createAsyncThunk(
  "jobs/updateJob",
  async ({ id, job, city_code, city_type }, { rejectWithValue }) => {
    try {
      console.log('Updating job:', { id, job, city_code, city_type });
      const payload = { job, city_code };
      if (city_type !== undefined && city_type !== null) {
        payload.city_type = city_type;
      }

      const res = await axios.put(`/admin/updatejob/${id}`, payload);
      console.log('Job updated successfully:', res.data);
      return res.data;
    } catch (error) {
      console.error("updateJob error:", error.response?.data?.message || error.message);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

// Delete a job
export const deleteJob = createAsyncThunk(
  "jobs/deleteJob",
  async (id, { rejectWithValue }) => {
    try {
      await axios.delete(`/admin/deletejob/${id}`);
      return id;
    } catch (error) {
      console.error("deleteJob error:", error.response?.data?.message || error.message);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

// Toggle job status
export const jobStatus = createAsyncThunk(
  "jobs/jobStatus",
  async (id, { rejectWithValue }) => {
    try {
      const res = await axios.patch(`/admin/${id}/status`);
      return res.data;
    } catch (error) {
      console.error("jobStatus error:", error.response?.data?.message || error.message);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

export const fetchAllCities = createAsyncThunk(
  "jobs/fetchAllCities",
  async (_, { rejectWithValue }) => {
    try {
      console.log("Fetching all enabled cities...");
      const res = await axios.get(`/admin/get-cities`);
      return res.data.cities;
    } catch (error) {
      console.error("fetchAllCities error:", error.response?.data?.message || error.message);
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

const jobSlice = createSlice({
  name: "jobs",
  initialState: {
    cities: [],           // For paginated jobs management
    allCities: [],        // For dropdowns - all enabled cities
    total: 0,
    totalPages: 0,
    page: 1,
    isSuperAdmin: false,  // Track if user is superadmin
    status: "idle",       // idle | loading | succeeded | failed
    allCitiesStatus: "idle", // Separate status for all cities
    error: null,
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    resetJobsState: (state) => {
      state.cities = [];
      state.allCities = [];
      state.total = 0;
      state.totalPages = 0;
      state.page = 1;
      state.isSuperAdmin = false;
      state.status = "idle";
      state.allCitiesStatus = "idle";
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch paginated jobs
      .addCase(fetchPaginatedJobs.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchPaginatedJobs.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.cities = action.payload.jobs || [];
        state.total = action.payload.total || 0;
        state.totalPages = action.payload.totalPages || 0;
        state.page = action.payload.page || 1;
        state.isSuperAdmin = action.payload.isSuperAdmin || false;
        state.error = null;
      })
      .addCase(fetchPaginatedJobs.rejected, (state, action) => {
        if (action.payload !== 'Request cancelled') {
          state.status = "failed";
          state.error = action.payload || action.error.message;
        }
      })

      // Fetch all enabled cities
      .addCase(fetchAllCities.pending, (state) => {
        state.allCitiesStatus = "loading";
      })
      .addCase(fetchAllCities.fulfilled, (state, action) => {
        state.allCitiesStatus = "succeeded";
        state.allCities = action.payload || [];
      })
      .addCase(fetchAllCities.rejected, (state, action) => {
        state.allCitiesStatus = "failed";
        state.error = action.payload || action.error.message;
      })

      // Fetch all jobs
      .addCase(fetchJobs.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchJobs.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.cities = action.payload.jobs || action.payload || [];
        state.error = null;
      })
      .addCase(fetchJobs.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || action.error.message;
      })

      // Add job
      .addCase(addJob.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(addJob.fulfilled, (state) => {
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(addJob.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || action.error.message;
      })

      // Update job
      .addCase(updateJob.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(updateJob.fulfilled, (state, action) => {
        state.status = "succeeded";
        const index = state.cities.findIndex((c) => c.id === action.payload.id);
        if (index !== -1) {
          state.cities[index] = action.payload;
        }
        const allIndex = state.allCities.findIndex((c) => c.id === action.payload.id);
        if (allIndex !== -1) {
          state.allCities[allIndex] = action.payload;
        }
        state.error = null;
      })
      .addCase(updateJob.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || action.error.message;
      })

      // Delete job
      .addCase(deleteJob.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(deleteJob.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.cities = state.cities.filter((c) => c.id !== action.payload);
        state.allCities = state.allCities.filter((c) => c.id !== action.payload);
        state.total = Math.max(0, state.total - 1);
        state.error = null;
      })
      .addCase(deleteJob.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || action.error.message;
      })

      // Toggle job status
      .addCase(jobStatus.pending, (state, action) => {
        const id = action.meta.arg;
        const index = state.cities.findIndex((c) => c.id === id);
        if (index !== -1) {
          state.cities[index].enabled = !state.cities[index].enabled;
        }
      })
      .addCase(jobStatus.fulfilled, (state, action) => {
        state.status = "succeeded";
        const index = state.cities.findIndex((c) => c.id === action.payload.id);
        if (index !== -1) {
          state.cities[index] = action.payload;
        }
        const allIndex = state.allCities.findIndex((c) => c.id === action.payload.id);
        if (action.payload.enabled) {
          if (allIndex === -1) {
            state.allCities.push(action.payload);
          } else {
            state.allCities[allIndex] = action.payload;
          }
        } else {
          state.allCities = state.allCities.filter((c) => c.id !== action.payload.id);
        }
        state.error = null;
      })
      .addCase(jobStatus.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || action.error.message;
        const id = action.meta.arg;
        const index = state.cities.findIndex((c) => c.id === id);
        if (index !== -1) {
          state.cities[index].enabled = !state.cities[index].enabled;
        }
      });
  },
});

export const { clearError, resetJobsState } = jobSlice.actions;
export default jobSlice.reducer;