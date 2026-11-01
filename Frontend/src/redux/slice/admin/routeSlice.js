import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

// ✅ ENHANCED: Fetch routes with city filter
export const fetchRoutes = createAsyncThunk("routes/fetchRoutes", async ({ page, limit, search = "", city = "" }) => {
  const res = await axios.get(`/admin/routes`, {
    params: { page, limit, search, city }
  });

  return res.data;
});

// Add a route
export const addRoute = createAsyncThunk("routes/addRoute", async (routeData) => {
  const res = await axios.post(`/admin/routes`, routeData);
  return res.data;
});

// Toggle route status
export const toggleRouteStatus = createAsyncThunk("routes/toggleRouteStatus", async (id) => {
  const res = await axios.patch(`/admin/routes/${id}/status`);
  return res.data;
});

// Delete a route
export const deleteRoute = createAsyncThunk("routes/deleteRoute", async (id) => {
  await axios.delete(`/admin/routes/${id}`);
  return id;
});

export const updateRoute = createAsyncThunk("routes/updateRoute", async ({ id, routeData }) => {
  const res = await axios.put(`/admin/routes/${id}`, routeData);
  return res.data;
})

const routeSlice = createSlice({
  name: "routes",
  initialState: {
    routes: [],
    status: "idle", // idle | loading | succeeded | failed
    error: null,
    page: 1,
    total: 0,
    totalPages: 0,
    limit: 4,
    cityFilter: "" // ✅ NEW: Track current city filter
  },
  reducers: {
    // ✅ NEW: Action to update city filter
    setCityFilter: (state, action) => {
      state.cityFilter = action.payload;
    },
    // ✅ NEW: Action to clear city filter
    clearCityFilter: (state) => {
      state.cityFilter = "";
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch routes
      .addCase(fetchRoutes.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchRoutes.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.routes = action.payload.routes;
        state.total = action.payload.total;
        state.page = action.payload.page;
        state.totalPages = action.payload.totalPages;
      })
      .addCase(fetchRoutes.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      // Add route
      .addCase(addRoute.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(addRoute.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.routes.push(action.payload);
      })
      .addCase(addRoute.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      //update Route
      .addCase(updateRoute.pending, (state) => {
        state.status = "loading"
        state.error = null
      })
      .addCase(updateRoute.fulfilled, (state, action) => {
        state.status = "succeeded"
        const index = state.routes.findIndex((r) => r.id === action.payload.id)
        if (index !== -1) {
          state.routes[index] = action.payload
        }
      })
      .addCase(updateRoute.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      // Toggle route status
      .addCase(toggleRouteStatus.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(toggleRouteStatus.fulfilled, (state, action) => {
        state.status = "succeeded";
        const index = state.routes.findIndex((r) => r.id === action.payload.id);
        if (index !== -1) {
          state.routes[index] = action.payload;
        }
      })
      .addCase(toggleRouteStatus.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      // Delete route
      .addCase(deleteRoute.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(deleteRoute.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.routes = state.routes.filter((r) => r.id !== action.payload);
      })
      .addCase(deleteRoute.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      });
  },
});

export const { setCityFilter, clearCityFilter } = routeSlice.actions;
export default routeSlice.reducer