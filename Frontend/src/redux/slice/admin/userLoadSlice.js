import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";

export const toggleAdminRole = createAsyncThunk("/admin/toggle-admin-role",
    async (id, { rejectWithValue }) => {
        try {
            const res = await axios.patch(`/admin/toggle-admin-role/${id}`);
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message)
        }
    }
)

export const addDriver = createAsyncThunk("/admin/create-users",
    async (formData, { rejectWithValue }) => {
        try {
            const res = await axios.post(`/admin/create-users`, formData);
            return res.data;
        } catch (error) {
            // A very similar name is a question for the admin, not a failure: the list travels with the answer so the screen can ask.
            const data = error.response?.data;
            return rejectWithValue(data?.message || error.message, data?.code === "similar_driver" ? { similar: data.similar } : undefined)
        }
    }
)

export const getUsers = createAsyncThunk('/admin/get-users',
    async ({ page = 1, search = "", city = "", type = "", enabled = "", status = "", issue = "", sort = "name", dir = "asc" }, { rejectWithValue }) => {
        try {
            // Only what is chosen is sent; the server applies the same defaults.
            const res = await axios.get(`/admin/get-users`, {
                params: {
                    page,
                    search,
                    city: city === "All" ? undefined : city,
                    type: type || undefined,
                    enabled: enabled || undefined,
                    status: status || undefined,
                    issue: issue || undefined,
                    sort: sort === "name" ? undefined : sort,
                    dir: dir === "asc" ? undefined : dir
                }
            });
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message)
        }
    }
)

export const getCities = createAsyncThunk('/admin/get-cities',
    async (_, { rejectWithValue }) => {
        try {
            const res = await axios.get(`/admin/get-cities`);
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message)
        }
    }
)

export const getAdminCities = createAsyncThunk('/admin/get-admin-cities',
    async (_, { rejectWithValue }) => {
        try {
            const res = await axios.get(`/admin/get-admin-cities`);
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message)
        }
    }
)

export const getAdmins = createAsyncThunk('/admin/get-admins',
    async ({ page = 1 }, { rejectWithValue }) => {
        try {
            const res = await axios.get(`/admin/get-admins`, {
                params: { page }
            });
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message)
        }
    }
)

export const toggleAvailUser = createAsyncThunk(`/admin/toggle-user`, async (id, { rejectWithValue }) => {
    try {
        const res = await axios.patch(`/admin/toggle-user/${id}`);
        return res.data;
    } catch (err) {
        return rejectWithValue(err.response?.data?.message || err.message);
    }
})

export const toggleAvailAdmin = createAsyncThunk(`/admin/toggle-admin`, async (id, { rejectWithValue }) => {
    try {
        const res = await axios.patch(`/admin/toggle-admin/${id}`);
        return res.data;
    } catch (err) {
        return rejectWithValue(err.response?.data?.message || err.message);
    }
})

export const addAdmin = createAsyncThunk(`/admin/create-admin`,
    async (formData, { rejectWithValue }) => {
        try {
            const res = await axios.post(`/admin/create-admin`, formData);
            return res.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || error.message);
        }
    }
)

export const updateDriver = createAsyncThunk(
    "/admin/update-user",
    async ({ id, formData }, { rejectWithValue }) => {
        try {
            const res = await axios.put(`/admin/update-user/${id}`, formData);
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message);
        }
    }
);

// Local or Desi for one or many drivers in a single request (the server changes all of them or none).
export const changeDriverTypes = createAsyncThunk(
    "/admin/change-driver-types",
    async ({ driverIds, driverType }, { rejectWithValue }) => {
        try {
            const res = await axios.patch(`/admin/drivers/type`, { driverIds, driverType });
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message);
        }
    }
);

export const updateAdmin = createAsyncThunk(
    "/admin/update-admin",
    async ({ id, formData }, { rejectWithValue }) => {
        try {
            const res = await axios.put(`/admin/update-admin/${id}`, formData);
            return res.data;
        } catch (err) {
            return rejectWithValue(err.response?.data?.message || err.message);
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
        searchTerm: "",
        selectedCity: "All",
        // The other filters and the sort of the drivers table. "" means "all"; the server sorts by name, A to Z, unless told otherwise.
        driverFilters: { type: "", enabled: "", status: "", issue: "", sort: "name", dir: "asc" },
        // From the last list: how many drivers have each Everee status (for the chips), the total, and whether Everee onboarding is on.
        counts: null,
        total: 0,
        everee: null,
        // Kept apart from `loading` so changing types never swaps the table for its loading skeleton.
        changingType: false
    },
    reducers: {
        clearMessages: (state) => {
            state.error = null;
            state.success = null;
        },
        clearPaginateTerms: (state) => {
            state.page = 1;
            state.totalPages = 0;
        },
        setSearchTerm: (state, action) => {
            state.searchTerm = action.payload;
            state.page = 1;
        },
        setSelectedCity: (state, action) => {
            state.selectedCity = action.payload;
            state.page = 1;
        },
        // One filter or the sort: { key, value }. Any change starts again from the first page.
        setDriverFilter: (state, action) => {
            const { key, value } = action.payload;
            if (key in state.driverFilters) state.driverFilters[key] = value;
            state.page = 1;
        },
        clearDriverFilters: (state) => {
            state.driverFilters = { type: "", enabled: "", status: "", issue: "", sort: "name", dir: "asc" };
            state.page = 1;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(addDriver.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.success = null;
            })
            .addCase(addDriver.fulfilled, (state, action) => {

                const newDriver = action.payload.insertUser;

                state.drivers = [newDriver, ...state.drivers];

                state.loading = false;
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(addDriver.rejected, (state, action) => {
                state.loading = false;
                if (action.meta.similar) return; // the screen asks the admin; no error message
                state.error = action.payload || "Failed to add driver";
                state.success = null;
            })

            .addCase(getUsers.pending, (state) => {
                state.loading = true;
            })
            .addCase(getUsers.fulfilled, (state, action) => {
                if (JSON.stringify(state.drivers) !== JSON.stringify(action.payload.drivers)) {
                    state.drivers = action.payload.drivers;
                }
                state.page = action.payload.page;
                state.totalPages = action.payload.totalPages;
                state.counts = action.payload.counts ?? null;
                state.total = action.payload.total ?? action.payload.drivers.length;
                state.everee = action.payload.everee ?? null;
                state.loading = false;
                state.success = null;
            })
            .addCase(getUsers.rejected, (state, action) => {
                state.error = action.payload;
                state.loading = false;
            })

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

            .addCase(addAdmin.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.success = null;
            })
            .addCase(addAdmin.fulfilled, (state, action) => {

                const newAdmin = action.payload.insertAdmin;

                state.admins = [newAdmin, ...state.admins];

                state.loading = false;
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(addAdmin.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to add admin";
                state.success = null;
            })
            .addCase(getCities.pending, (state) => {
                state.loading = true;
            })
            .addCase(getCities.fulfilled, (state, action) => {
                state.city = action.payload.cities;
                state.loading = false;
                state.success = true;
            })
            .addCase(getCities.rejected, (state, action) => {
                state.error = action.payload;
                state.city = [];
                state.loading = false;
            })

            .addCase(getAdminCities.pending, (state) => {
                state.loading = true;
            })
            .addCase(getAdminCities.fulfilled, (state, action) => {
                state.city = action.payload.cities;
                state.loading = false;
                state.success = true;
            })
            .addCase(getAdminCities.rejected, (state, action) => {
                state.error = action.payload;
                state.city = [];
                state.loading = false;
            })

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

            .addCase(changeDriverTypes.pending, (state) => {
                state.changingType = true;
            })
            .addCase(changeDriverTypes.fulfilled, (state, action) => {
                const { driverIds, driverType } = action.payload;
                const changed = new Set(driverIds);
                state.drivers = state.drivers.map(d => changed.has(d.id) ? { ...d, driver_type: driverType } : d);
                state.changingType = false;
            })
            .addCase(changeDriverTypes.rejected, (state) => {
                state.changingType = false;
            })

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

export const { clearMessages, clearPaginateTerms, setSearchTerm, setSelectedCity, setDriverFilter, clearDriverFilters } = userLoadSlice.actions
export default userLoadSlice.reducer;