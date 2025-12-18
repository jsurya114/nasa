import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { API_BASE_URL } from "../../../config";

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('adminToken');
  return {
    "Content-Type": "application/json",
    ...(token && { "Authorization": `Bearer ${token}` })
  };
};

export const toggleAdminRole = createAsyncThunk("/admin/toggle-admin-role",
    async (id, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/toggle-admin-role/${id}`, {
                method: "PATCH",
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (!res.ok) {
                return rejectWithValue(data.message || 'Failure to get details of Admin')
            }
            return data;
        } catch (err) {
            return rejectWithValue(err.message)
        }
    }
)

export const addDriver = createAsyncThunk("/admin/create-users",
    async (formData, { rejectWithValue }) => {
        try {
            console.log("formdata of driver ", formData);
            const res = await fetch(`${API_BASE_URL}/admin/create-users`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify(formData),
            })
            const data = await res.json();
            if (!res.ok) {
                return rejectWithValue(data.message || "User Add failure")
            }
            return data;
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

export const getUsers = createAsyncThunk('/admin/get-users',
    async ({ page = 1 }, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/get-users?&page=${page}`, {
                method: "GET",
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (!res.ok) {
                return rejectWithValue(data.message || "Error while getting users data")
            }
            return data;
        } catch (err) {
            return rejectWithValue(err.message)
        }
    }
)

export const getCities = createAsyncThunk('/admin/get-cities',
    async (_, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/get-cities`, {
                method: "GET",
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (!res.ok) {
                return rejectWithValue(data.message || "Error while getting users data")
            }
            return data;
        } catch (err) {
            return rejectWithValue(err.message)
        }
    }
)

// Get cities based on admin role (superadmin gets all, admin gets assigned only)
export const getAdminCities = createAsyncThunk('/admin/get-admin-cities',
    async (_, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/get-admin-cities`, {
                method: "GET",
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (!res.ok) {
                return rejectWithValue(data.message || "Error while getting admin cities")
            }
            return data;
        } catch (err) {
            return rejectWithValue(err.message)
        }
    }
)

export const getAdmins = createAsyncThunk('/admin/get-admins',
    async ({ page = 1 }, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/get-admins?page=${page}`, {
                method: "GET",
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (!res.ok) {
                return rejectWithValue(data.message || "Error while getting admins data")
            }
            return data;
        } catch (err) {
            return rejectWithValue(err.message)
        }
    }
)

export const toggleAvailUser = createAsyncThunk(`/admin/toggle-user`, async (id, { rejectWithValue }) => {
    try {
        const res = await fetch(`${API_BASE_URL}/admin/toggle-user/${id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (!res.ok) {
            return rejectWithValue(data.message || "Deletion failure");
        }
        return data;
    } catch (err) {
        return rejectWithValue(err.message);
    }
})

export const toggleAvailAdmin = createAsyncThunk(`/admin/toggle-admin`, async (id, { rejectWithValue }) => {
    try {
        const res = await fetch(`${API_BASE_URL}/admin/toggle-admin/${id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (!res.ok) {
            return rejectWithValue(data.message || "Disable admin failure");
        }
        return data;
    } catch (err) {
        return rejectWithValue(err.message);
    }
})

export const addAdmin = createAsyncThunk(`/admin/create-admin`,
    async (formData, { rejectWithValue }) => {
        try {
            console.log("Admin data ", formData);
            const res = await fetch(`${API_BASE_URL}/admin/create-admin`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify(formData),
            })
            const data = await res.json();
            if (!res.ok) {
                return rejectWithValue(data.message || "Admin Add failure")
            }

            return data;
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
)

export const updateDriver = createAsyncThunk(
  "/admin/update-user",
  async ({ id, formData }, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/update-user/${id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        return rejectWithValue(data.message || "Update failed");
      }
      return data;
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const updateAdmin = createAsyncThunk(
  "/admin/update-admin",
  async ({ id, formData }, { rejectWithValue }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/update-admin/${id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        return rejectWithValue(data.message || "Update failed");
      }
      return data;
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);


const userLoadSlice = createSlice({
    name: "usersCumAdmin",
    initialState: {
        loading: false,
        error: null,
        success: null,
        drivers: [],
        admins: [],
        page: 1,
        city: [],
        totalPages: 0,
    },
    reducers: {
        clearMessages: (state) => {
            state.error = null;
            state.success = null;
        },
        clearPaginateTerms: (state) => {
            state.page = 1;
            state.totalPages = 0;
        }
    },
    extraReducers: (builder) => {
        builder
            // Add Driver
            .addCase(addDriver.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.success = null;
            })
            .addCase(addDriver.fulfilled, (state, action) => {
                state.loading = false;
                state.drivers.push(action.payload.insertUser);
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(addDriver.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to add driver";
                state.success = null;
            })

            // Get Users (Drivers)
            .addCase(getUsers.pending, (state) => {
                state.loading = true;
            })
            .addCase(getUsers.fulfilled, (state, action) => {
                if (JSON.stringify(state.drivers) !== JSON.stringify(action.payload.drivers)) {
                    state.drivers = action.payload.drivers;
                }
                state.page = action.payload.page;
                state.totalPages = action.payload.totalPages;
                state.loading = false;
                state.success = null;
            })
            .addCase(getUsers.rejected, (state, action) => {
                state.error = action.payload;
                state.loading = false;
            })

            // Get Admins
            .addCase(getAdmins.pending, (state) => {
                state.loading = true;
            })
            .addCase(getAdmins.fulfilled, (state, action) => {
                if (JSON.stringify(state.admins) !== JSON.stringify(action.payload.admins)) {
                    state.admins = action.payload.admins;
                }
                state.loading = false;
                state.success = null;
                state.page = action.payload.page;
                state.totalPages = action.payload.totalPages;
            })
            .addCase(getAdmins.rejected, (state, action) => {
                state.error = action.payload;
                state.loading = false;
            })

            // Toggle User (Driver) Status
            .addCase(toggleAvailUser.pending, (state) => {
                state.loading = true;
            })
            .addCase(toggleAvailUser.fulfilled, (state, action) => {
                const updatedDriver = action.payload.data;
                state.drivers = state.drivers.map(d =>
                    d.id === updatedDriver.id ? updatedDriver : d
                );
                state.loading = false;
                state.success = action.payload.message;
            })
            .addCase(toggleAvailUser.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to update driver status"
                state.success = null;
            })

            // Toggle Admin Status
            .addCase(toggleAvailAdmin.pending, (state) => {
                state.loading = true;
            })
            .addCase(toggleAvailAdmin.fulfilled, (state, action) => {
                const updatedAdmin = action.payload.data;
                state.admins = state.admins.map(d =>
                    d.id === updatedAdmin.id ? updatedAdmin : d
                );
                state.loading = false;
                state.success = action.payload.message;
            })
            .addCase(toggleAvailAdmin.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to update admin status"
                state.success = null;
            })

            // Toggle Admin Role
            .addCase(toggleAdminRole.pending, (state) => {
                state.loading = true;
            })
            .addCase(toggleAdminRole.fulfilled, (state, action) => {
                const updatedAdmin = action.payload.data;
                state.admins = state.admins.map(d =>
                    d.id === updatedAdmin.id ? updatedAdmin : d
                );
                state.loading = false;
                state.success = action.payload.message;
            })
            .addCase(toggleAdminRole.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to update admin status"
                state.success = null;
            })

            // Add Admin
            .addCase(addAdmin.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.success = null;
            })
            .addCase(addAdmin.fulfilled, (state, action) => {
                state.admins.push(action.payload.insertAdmin)
                state.loading = false;
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(addAdmin.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to add admin"
                state.success = null;
            })

            // Get Cities
            .addCase(getCities.pending, (state) => {
                state.loading = true;
            })
            .addCase(getCities.fulfilled, (state, action) => {
                console.log("From cities", action.payload.cities);
                state.city = action.payload.cities;
                state.loading = false;
                state.success = true;
            })
            .addCase(getCities.rejected, (state, action) => {
                state.error = action.payload;
                state.city = [];
                state.loading = false;
            })

            // Get Admin Cities (role-based)
            .addCase(getAdminCities.pending, (state) => {
                state.loading = true;
            })
            .addCase(getAdminCities.fulfilled, (state, action) => {
                console.log("From admin cities", action.payload.cities);
                state.city = action.payload.cities;
                state.loading = false;
                state.success = true;
            })
            .addCase(getAdminCities.rejected, (state, action) => {
                state.error = action.payload;
                state.city = [];
                state.loading = false;
            })

            // Update Driver
            .addCase(updateDriver.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.success = null;
            })
            .addCase(updateDriver.fulfilled, (state, action) => {
                const updated = action.payload.updatedUser;
                state.drivers = state.drivers.map(d =>
                    d.id === updated.id ? updated : d
                );
                state.loading = false;
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(updateDriver.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to update driver";
                state.success = null;
            })

            // Update Admin
            .addCase(updateAdmin.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.success = null;
            })
            .addCase(updateAdmin.fulfilled, (state, action) => {
                const updated = action.payload.updatedAdmin;
                state.admins = state.admins.map(a =>
                    a.id === updated.id ? updated : a
                );
                state.loading = false;
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(updateAdmin.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to update admin";
                state.success = null;
            });
    }
})

export const { clearMessages, clearPaginateTerms } = userLoadSlice.actions
export default userLoadSlice.reducer;