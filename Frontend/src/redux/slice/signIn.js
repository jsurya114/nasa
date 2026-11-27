import { createAsyncThunk } from "@reduxjs/toolkit";
import axios from "./axiosInstance";
import { isNativeShell } from "../../native/bridge";
import { clearSession, saveSession } from "../../native/sessionStore";
import { signedIn as adminSignedIn } from "./admin/adminSlice";
import { setDriver } from "./driver/driverSlice";

const AREAS = ["admin", "driver"];
const DEVICE_SIGN_IN_ERROR = "Could not sign in on this device. Please try again.";

// The one sign-in for every NASA account. The server decides whether the email and password open an admin or a
// driver account; the page never asks first. Rejects with { code, message, areas? } so the page can show it.
export const signIn = createAsyncThunk("auth/signIn", async ({ email, password, area }, { dispatch, rejectWithValue }) => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let data;
  try {
    const res = await axios.post("/auth/login", { email, password, timezone, ...(area ? { area } : {}) });
    data = res.data;
  } catch (error) {
    const body = error.response?.data;
    if (error.response?.status === 429) return rejectWithValue({ code: "rate_limited", message: body?.message || "Too many attempts. Please wait and try again." });
    if (body?.code) return rejectWithValue({ code: body.code, message: body.message, areas: body.areas });
    if (!error.response) return rejectWithValue({ code: "network", message: "No connection. Check your signal and try again." });
    return rejectWithValue({ code: "server_error", message: "NASA could not sign you in right now. Please try again." });
  }

  if (!AREAS.includes(data?.area) || !data.accessToken || !data.refreshToken) {
    return rejectWithValue({ code: "server_error", message: "NASA could not sign you in right now. Please try again." });
  }

  try {
    // In the app only one person is signed in at a time: whatever the other area still held is signed out first,
    // with its drafts, cached screens and push registration, so a new sign-in never sits next to someone else's.
    if (isNativeShell()) {
      const other = AREAS.find((a) => a !== data.area);
      await clearSession(other).catch(() => {});
    }
    await saveSession(data.area, { accessToken: data.accessToken, refreshToken: data.refreshToken });
  } catch {
    return rejectWithValue({ code: "device", message: DEVICE_SIGN_IN_ERROR });
  }

  localStorage.setItem("lastActivity", Date.now().toString());
  if (data.area === "admin") {
    dispatch(adminSignedIn(data.admin));
  } else {
    localStorage.setItem("driverTimezone", data.driver?.timezone || timezone);
    dispatch(setDriver(data.driver));
  }
  return { area: data.area, next: data.next };
});
