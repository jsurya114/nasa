import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { translateError } from "../../../hooks/backendI18n.js";
import { driverLogout } from "./driverSlice.js";

// The signed-in driver's own profile (full name, email, phone). The server decides who the driver is from the sign-in token; nothing here sends an id.
// The profile is held in memory only and is cleared when the driver signs out.

const getCurrentLanguage = () => localStorage.getItem("preferredLanguage") || "en";
const languageHeader = () => ({ headers: { "X-Language": getCurrentLanguage() } });

export const loadProfile = createAsyncThunk("driverProfile/load", async (_, { rejectWithValue }) => {
  try {
    const res = await axios.get("/driver/profile", languageHeader());
    return res.data.profile;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || translateError(getCurrentLanguage(), "profile.failedToLoad"));
  }
});

// profileData: { name, email, phoneNumber }. A refusal comes back as { message, errors: { name?, email?, phoneNumber? } } in the driver's language.
export const saveProfile = createAsyncThunk("driverProfile/save", async (profileData, { rejectWithValue }) => {
  try {
    const res = await axios.put("/driver/profile", profileData, languageHeader());
    return res.data;
  } catch (error) {
    return rejectWithValue(error.response?.data || { message: error.message });
  }
});

const initialState = {
  loadStatus: "idle", // idle | loading | succeeded | failed
  loadError: null,
  profile: null, // { name, email, phoneNumber }
  saveStatus: "idle", // idle | saving | succeeded | failed
  saveError: null,
  fieldErrors: {},
};

const profileSlice = createSlice({
  name: "driverProfile",
  initialState,
  reducers: {
    clearSaveErrors: (state) => {
      state.saveError = null;
      state.fieldErrors = {};
      if (state.saveStatus === "failed") state.saveStatus = "idle";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadProfile.pending, (state) => {
        state.loadStatus = "loading";
        state.loadError = null;
      })
      .addCase(loadProfile.fulfilled, (state, action) => {
        state.loadStatus = "succeeded";
        state.profile = action.payload;
      })
      .addCase(loadProfile.rejected, (state, action) => {
        state.loadStatus = "failed";
        state.loadError = action.payload;
      })
      .addCase(saveProfile.pending, (state) => {
        state.saveStatus = "saving";
        state.saveError = null;
        state.fieldErrors = {};
      })
      .addCase(saveProfile.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";
        state.profile = action.payload.profile;
      })
      .addCase(saveProfile.rejected, (state, action) => {
        state.saveStatus = "failed";
        state.fieldErrors = action.payload?.errors || {};
        state.saveError = action.payload?.message || translateError(getCurrentLanguage(), "profile.failedToUpdate");
      })
      // Signing out leaves nothing of this driver in memory.
      .addCase(driverLogout.fulfilled, () => initialState)
      .addCase(driverLogout.rejected, () => initialState);
  },
});

export const { clearSaveErrors } = profileSlice.actions;
export default profileSlice.reducer;
