import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

// ✅ ENHANCED: Fetch routes with city filter
export const fetchRoutes = createAsyncThunk("routes/fetchRoutes", async ({ page, limit, search = "", city = "" }) => {
  try {
    console.log("Fetching routes with filters:", { page, limit, search, city });

    const res = await axios.get(`/admin/routes`, {
      params: { page, limit, search, city }
    });

    console.log("Fetched routes:", res.data);
    return res.data;
  } catch (error) {
    console.error("fetchRoutes error:", error.response?.data?.message || error.message);
    throw error;
  }
});

// Add a route
export const addRoute = createAsyncThunk("routes/addRoute", async (routeData) => {
  try {
    console.log("Adding route:", routeData);
    const res = await axios.post(`/admin/routes`, routeData);
    console.log("Added route:", res.data);
    return res.data;
  } catch (error) {
    console.error("addRoute error:", error.response?.data?.message || error.message);
    throw error;
  }
});

// Toggle route status
export const toggleRouteStatus = createAsyncThunk("routes/toggleRouteStatus", async (id) => {
  try {
    console.log(`Toggling status for route id: ${id}`);
    const res = await axios.patch(`/admin/routes/${id}/status`);
    console.log("Toggled route:", res.data);
    return res.data;
  } catch (error) {
    console.error("toggleRouteStatus error:", error.response?.data?.message || error.message);
    throw error;
  }
});

// Delete a route
export const deleteRoute = createAsyncThunk("routes/deleteRoute", async (id) => {
  try {
    console.log(`Deleting route id: ${id}`);
    await axios.delete(`/admin/routes/${id}`);
    console.log("Deleted route id:", id);
    return id;
  } catch (error) {
    console.error("deleteRoute error:", error.response?.data?.message || error.message);
    throw error;
  }
});

export const updateRoute = createAsyncThunk("routes/updateRoute", async ({ id, routeData }) => {
  try {
    const res = await axios.put(`/admin/routes/${id}`, routeData);
    console.log("Updated route:", res.data);
    return res.data;
  } catch (error) {
    console.error("updateRoute error:", error.response?.data?.message || error.message);
    throw error;
  }
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
        console.log("fetchRoutes: Status set to loading");
      })
      .addCase(fetchRoutes.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.routes = action.payload.routes;
        state.total = action.payload.total;
        state.page = action.payload.page;
        state.totalPages = action.payload.totalPages;
        console.log("fetchRoutes: Routes state updated:", action.payload);
      })
      .addCase(fetchRoutes.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
        console.error("fetchRoutes: Failed:", action.error.message);
      })
      // Add route
      .addCase(addRoute.pending, (state) => {
        state.status = "loading";
        state.error = null;
        console.log("addRoute: Status set to loading");
      })
      .addCase(addRoute.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.routes.push(action.payload);
        console.log("addRoute: Route added:", action.payload);
      })
      .addCase(addRoute.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
        console.error("addRoute: Failed:", action.error.message);
      })
      //update Route
      .addCase(updateRoute.pending, (state) => {
        state.status = "loading"
        state.error = null
        console.log("updateRoute: Status set to loading");
      })
      .addCase(updateRoute.fulfilled, (state, action) => {
        state.status = "succeeded"
        const index = state.routes.findIndex((r) => r.id === action.payload.id)
        if (index !== -1) {
          state.routes[index] = action.payload
          console.log("updateRoute: Route updated:", action.payload);
        }
      })
      .addCase(updateRoute.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
        console.error("updateRoute: Failed:", action.error.message);
      })
      // Toggle route status
      .addCase(toggleRouteStatus.pending, (state) => {
        state.status = "loading";
        state.error = null;
        console.log("toggleRouteStatus: Status set to loading");
      })
      .addCase(toggleRouteStatus.fulfilled, (state, action) => {
        state.status = "succeeded";
        const index = state.routes.findIndex((r) => r.id === action.payload.id);
        if (index !== -1) {
          state.routes[index] = action.payload;
          console.log("toggleRouteStatus: Route updated:", action.payload);
        }
      })
      .addCase(toggleRouteStatus.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
        console.error("toggleRouteStatus: Failed:", action.error.message);
      })
      // Delete route
      .addCase(deleteRoute.pending, (state) => {
        state.status = "loading";
        state.error = null;
        console.log("deleteRoute: Status set to loading");
      })
      .addCase(deleteRoute.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.routes = state.routes.filter((r) => r.id !== action.payload);
        console.log("deleteRoute: Route deleted:", action.payload);
      })
      .addCase(deleteRoute.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
        console.error("deleteRoute: Failed:", action.error.message);
      });
  },
});

export const { setCityFilter, clearCityFilter } = routeSlice.actions;
export default routeSlice.reducer