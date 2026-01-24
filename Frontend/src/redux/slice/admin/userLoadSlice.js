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
            console.log("formdata of driver ", formData);
            const res = await axios.post(`/admin/create-users`, formData);
            return res.data;
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || error.message)
        }
    }
)

export const getUsers = createAsyncThunk('/admin/get-users',
    async ({ page = 1, search = "", city = "" }, { rejectWithValue }) => {
        try {
            const res = await axios.get(`/admin/get-users`, {
                params: {
                    page,
                    search,
                    city: city === "All" ? undefined : city
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
            console.log("Admin data ", formData);
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
        selectedCity: "All"
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
                console.log("Driver added successfully:", action.payload);

                const newDriver = action.payload.insertUser;

                state.drivers = [newDriver, ...state.drivers];

                state.loading = false;
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(addDriver.rejected, (state, action) => {
                console.error("Add driver failed:", action.payload);
                state.loading = false;
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
                console.log("Admin added successfully:", action.payload);

                const newAdmin = action.payload.insertAdmin;

                state.admins = [newAdmin, ...state.admins];

                state.loading = false;
                state.success = action.payload.message;
                state.error = null;
            })
            .addCase(addAdmin.rejected, (state, action) => {
                console.error("Add admin failed:", action.payload);
                state.loading = false;
                state.error = action.payload || "Failed to add admin";
                state.success = null;
            })
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

export const { clearMessages, clearPaginateTerms, setSearchTerm, setSelectedCity } = userLoadSlice.actions
export default userLoadSlice.reducer;