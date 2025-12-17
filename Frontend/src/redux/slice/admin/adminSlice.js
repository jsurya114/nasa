import { createSlice, createAsyncThunk } from "@reduxjs/toolkit"
import { API_BASE_URL } from "../../../config"

const initialState = {
    admin: null,
    isAuthenticated: null,
    loading: false,
    error: null,
    isSuperAdmin: false,
}

// Helper function to get auth headers
const getAuthHeaders = () => {
    const token = localStorage.getItem('adminToken');
    return {
        "Content-Type": "application/json",
        ...(token && { "Authorization": `Bearer ${token}` })
    };
};

export const adminLogin = createAsyncThunk(
    "admin/login",
    async (credentials, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(credentials),
            })
            const data = await res.json();

            if (!res.ok) {
                return rejectWithValue(data)
            }

            // Store token in localStorage
            if (data.token) {
                localStorage.setItem('adminToken', data.token);
            }

            return data;
        } catch (error) {
            return rejectWithValue({ message: error.message })
        }
    }
)

export const accessAdminUser = createAsyncThunk(
    "admin/access-admin",
    async (_, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/access-admin`, {
                method: "GET",
                headers: getAuthHeaders(),
            })
            const data = await res.json();

            if (!res.ok) {
                // If blocked or unauthorized, clear token
                if (data.blocked || res.status === 401 || res.status === 403) {
                    localStorage.removeItem('adminToken');
                }
                return rejectWithValue(data.message || "Unable to get Users")
            }
            return data;
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

export const adminLogout = createAsyncThunk(
    "admin/logout",
    async (_, { rejectWithValue }) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/logout`, {
                method: "POST",
                headers: getAuthHeaders(),
            })
            const data = await res.json();

            if (!res.ok) {
                return rejectWithValue(data.message || "Logout Error")
            }

            // Always remove token from localStorage
            localStorage.removeItem('adminToken');

            return data;
        } catch (error) {
            // Even if logout fails, remove token
            localStorage.removeItem('adminToken');
            return rejectWithValue(error.message)
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
                state.loading = true
                state.error = null
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