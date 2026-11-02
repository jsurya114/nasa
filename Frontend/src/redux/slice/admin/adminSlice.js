import { createSlice, createAsyncThunk } from "@reduxjs/toolkit"
import axios from "../axiosInstance";
import { isNativeShell } from "../../../native/bridge";
import { clearBrowserTokens, clearSession, getRefreshToken, isSignOutPending, saveSession } from "../../../native/sessionStore";

const DEVICE_SIGN_IN_ERROR = "Could not sign in on this device. Please try again.";
const DEVICE_SIGN_OUT_ERROR = "Signed out here, but the app could not confirm it on this phone. Please restart the app and sign out again.";

const initialState = {
    admin: null,
    isAuthenticated: null,
    loading: false,
    error: null,
    isSuperAdmin: false,
    // True when the sign-in could not be checked because of the connection (mobile app only)
    authCheckFailed: false,
}

export const adminLogin = createAsyncThunk(
    "admin/login",
    async (credentials, { rejectWithValue }) => {
        try {
            const res = await axios.post(`/admin/login`, credentials);
            const data = res.data;

            // Store the tokens (in the mobile app the shell keeps the refresh token)
            if (data.accessToken) {
                await saveSession('admin', { accessToken: data.accessToken, refreshToken: data.refreshToken });
                localStorage.setItem('lastActivity', Date.now().toString());
            }

            return data;
        } catch (error) {
            if (error.name === "BridgeError") return rejectWithValue({ message: DEVICE_SIGN_IN_ERROR });
            return rejectWithValue(error.response?.data || { message: error.message })
        }
    }
)

export const accessAdminUser = createAsyncThunk(
    "admin/access-admin",
    async (_, { rejectWithValue }) => {
        // While the phone has not confirmed a sign-out, the old session is never used again
        if (isSignOutPending('admin')) return rejectWithValue("UNAUTHORIZED");
        try {
            const res = await axios.get(`/admin/access-admin`);
            return res.data;
        } catch (error) {
            // In the app, a lost connection or a failed refresh check keeps the session and offers a retry
            if (error.transient || (isNativeShell() && !error.response)) {
                return rejectWithValue({ transient: true });
            }
            // If blocked or unauthorized, clear token
            if ((error.response?.status === 401 || error.response?.status === 403) && !error.noSession) {
                await clearSession('admin').catch(() => {});
            }
            return rejectWithValue(error.response?.data?.message || "Unable to get Users")
        }
    }
)

export const adminLogout = createAsyncThunk(
    "admin/logout",
    async (_, { rejectWithValue }) => {
        try {
            // In the mobile app the shell revokes the refresh token on the server and clears its copy.
            if (isNativeShell()) {
                localStorage.removeItem('lastActivity');
                try {
                    await clearSession('admin');
                } catch {
                    return rejectWithValue(DEVICE_SIGN_OUT_ERROR);
                }
                return {};
            }
            // Send the refresh token too, so the server can revoke it.
            const refreshToken = getRefreshToken('admin');
            const res = await axios.post(`/admin/logout`, { refreshToken });
            // Cleanup tokens after successful logout request
            await clearSession('admin');
            localStorage.removeItem('lastActivity');
            return res.data;
        } catch (error) {
            // Ensure tokens are removed even on error
            await clearSession('admin').catch(() => {});
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
            clearSession('admin').catch(() => {});
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
                state.authCheckFailed = false
            })
            .addCase(accessAdminUser.fulfilled, (state, action) => {
                state.loading = false;
                state.authCheckFailed = false;
                state.isAuthenticated = true;
                state.admin = action.payload.admin;
                state.isSuperAdmin = action.payload.admin.role === 'superadmin';
            })
            .addCase(accessAdminUser.rejected, (state, action) => {
                state.loading = false;
                if (action.payload?.transient) {
                    // Keep whatever was known about the person; the screen offers "Try again"
                    state.authCheckFailed = true;
                    return;
                }
                state.isAuthenticated = false;
                // Clear token on rejection (in the mobile app only a 401 or 403 signs out, above)
                clearBrowserTokens('admin');
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