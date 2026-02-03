import { createSlice, createAsyncThunk } from "@reduxjs/toolkit"
import axios from "../axiosInstance";

const initialState = {
    admin: null,
    isAuthenticated: null,
    loading: false,
    error: null,
    isSuperAdmin: false,
}

export const adminLogin = createAsyncThunk(
    "admin/login",
    async (credentials, { rejectWithValue }) => {
        try {
            const res = await axios.post(`/admin/login`, credentials);
            const data = res.data;

            // Store tokens in localStorage
            if (data.accessToken) {
                localStorage.setItem('adminToken', data.accessToken);
                localStorage.setItem('lastActivity', Date.now().toString());
            }
            if (data.refreshToken) {
                localStorage.setItem('adminRefreshToken', data.refreshToken);
            }

            return data;
        } catch (error) {
            return rejectWithValue(error.response?.data || { message: error.message })
        }
    }
)

export const accessAdminUser = createAsyncThunk(
    "admin/access-admin",
    async (_, { rejectWithValue }) => {
        try {
            const res = await axios.get(`/admin/access-admin`);
            return res.data;
        } catch (error) {
            // If blocked or unauthorized, clear token
            if (error.response?.status === 401 || error.response?.status === 403) {
                localStorage.removeItem('adminToken');
                localStorage.removeItem('adminRefreshToken');
            }
            return rejectWithValue(error.response?.data?.message || "Unable to get Users")
        }
    }
)

export const adminLogout = createAsyncThunk(
    "admin/logout",
    async (_, { rejectWithValue }) => {
        try {
            const res = await axios.post(`/admin/logout`);
            // Cleanup tokens after successful logout request
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminRefreshToken');
            localStorage.removeItem('lastActivity');
            return res.data;
        } catch (error) {
            // Ensure tokens are removed even on error
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminRefreshToken');
            localStorage.removeItem('lastActivity');
            return rejectWithValue(error.response?.data?.message || error.message)
        }
    }
)

const adminSlice = createSlice({
    name: "admin",
    initialState,
    reducers: {
        clearError: (state) => {
            state.error = null;
        },
        // Add manual logout action for client-side logout
        manualLogout: (state) => {
            state.isAuthenticated = false;
            state.admin = null;
            state.isSuperAdmin = false;
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminRefreshToken');
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(adminLogin.pending, (state) => {
                state.loading = true
                state.error = null
            })
            .addCase(adminLogin.fulfilled, (state, action) => {
                state.loading = false;
                state.isAuthenticated = true;
                state.admin = action.payload.admin;
                state.isSuperAdmin = action.payload.admin.role === 'superadmin';
            })
            .addCase(adminLogin.rejected, (state, action) => {
                state.loading = false
                if (action.payload?.errors) {
                    state.error = null
                } else {
                    state.error = action.payload?.message || "Login Failed"
                }
            })
            .addCase(adminLogout.pending, (state) => {
                state.loading = true;
                state.isAuthenticated = false;
                state.admin = null;
                state.isSuperAdmin = false;
                state.error = null;
            })
            .addCase(adminLogout.fulfilled, (state) => {
                state.loading = false;
                state.isAuthenticated = false;
                state.admin = null;
                state.isSuperAdmin = false;
            })
            .addCase(adminLogout.rejected, (state, action) => {
                state.loading = false;
                state.isAuthenticated = false;
                state.admin = null;
                state.isSuperAdmin = false;
                state.error = action.payload;
            })
            .addCase(accessAdminUser.pending, (state) => {
                state.loading = true
                state.error = null
            })
            .addCase(accessAdminUser.fulfilled, (state, action) => {
                state.loading = false;
                state.isAuthenticated = true;
                state.admin = action.payload.admin;
                state.isSuperAdmin = action.payload.admin.role === 'superadmin';
            })
            .addCase(accessAdminUser.rejected, (state, action) => {
                state.loading = false;
                state.isAuthenticated = false;
                // Clear token on rejection
                localStorage.removeItem('adminToken');
                localStorage.removeItem('adminRefreshToken');
                if (action.payload !== "UNAUTHORIZED") {
                    state.error = action.payload || "Access denied"
                } else {
                    state.error = null
                }
            })
    },
})

export const { clearError, manualLogout } = adminSlice.actions;
export default adminSlice.reducer;