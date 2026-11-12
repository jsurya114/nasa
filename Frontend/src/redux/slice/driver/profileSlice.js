import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "../axiosInstance";
import { translateError } from "../../../hooks/backendI18n.js";
import { driverLogout, setDriver } from "./driverSlice.js";

// The signed-in driver's own profile (full name, email, phone). The server decides who the driver is from the sign-in token; nothing here sends an id.
// The profile is held in memory only and is cleared when the driver signs out.
// Every request remembers which sign-in it was made for (`session`). Signing out starts a new one, so an answer that arrives after the driver has
// signed out (or another driver has signed in) is ignored: it can neither refill the cleared profile nor change the header.

const getCurrentLanguage = () => localStorage.getItem("preferredLanguage") || "en";
const languageHeader = () => ({ headers: { "X-Language": getCurrentLanguage() } });

const sessionOf = (getState) => getState().driverProfile.session;

export const loadProfile = createAsyncThunk("driverProfile/load", async (_, { rejectWithValue, getState }) => {
  const session = sessionOf(getState);
  try {
    const res = await axios.get("/driver/profile", languageHeader());
    return { session, profile: res.data.profile };
  } catch (error) {
    return rejectWithValue({ session, message: error.response?.data?.message || translateError(getCurrentLanguage(), "profile.failedToLoad") });
  }
});

// profileData: { name, email, phoneNumber, currentPassword }. The password is needed only when the email changes.
// A refusal comes back as { message, errors: { name?, email?, phoneNumber?, currentPassword? } } in the driver's language.
export const saveProfile = createAsyncThunk("driverProfile/save", async (profileData, { rejectWithValue, getState, dispatch }) => {
  const session = sessionOf(getState);
  try {
    const res = await axios.put("/driver/profile", profileData, languageHeader());
    // The header shows the driver's name: bring it up to date, but only while the same sign-in is still active.
    if (sessionOf(getState) === session) {
      dispatch(setDriver({ ...getState().driver.driver, name: res.data.profile.name, email: res.data.profile.email }));
    }
    return { session, ...res.data };
  } catch (error) {
    return rejectWithValue({ session, ...(error.response?.data || { message: error.message }) });
  }
});

const initialState = {
  session: 0, // grows each time the driver signs out
  loadStatus: "idle", // idle | loading | succeeded | failed
  loadError: null,
  profile: null, // { name, email, phoneNumber }
  saveStatus: "idle", // idle | saving | succeeded | failed
  saveError: null,
  fieldErrors: {},
};

// Is this answer for the sign-in that is active now? (Only answers carry a session; an unexpected failure has none and is shown.)
const isCurrent = (state, action) => (action.payload?.session ?? state.session) === state.session;

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
        if (!isCurrent(state, action)) return;
        state.loadStatus = "succeeded";
        state.profile = action.payload.profile;
      })
      .addCase(loadProfile.rejected, (state, action) => {
        if (!isCurrent(state, action)) return;
        state.loadStatus = "failed";
        state.loadError = action.payload?.message ?? null;
      })
      .addCase(saveProfile.pending, (state) => {
        state.saveStatus = "saving";
        state.saveError = null;
        state.fieldErrors = {};
      })
      .addCase(saveProfile.fulfilled, (state, action) => {
        if (!isCurrent(state, action)) return;
        state.saveStatus = "succeeded";
        state.profile = action.payload.profile;
      })
      .addCase(saveProfile.rejected, (state, action) => {
        if (!isCurrent(state, action)) return;
        state.saveStatus = "failed";
        state.fieldErrors = action.payload?.errors || {};
        state.saveError = action.payload?.message || translateError(getCurrentLanguage(), "profile.failedToUpdate");
      })
      // Signing out leaves nothing of this driver in memory, and from the first moment answers still on their way are ignored.
      .addCase(driverLogout.pending, (state) => ({ ...initialState, session: state.session + 1 }))
      .addCase(driverLogout.fulfilled, (state) => ({ ...initialState, session: state.session }))
      .addCase(driverLogout.rejected, (state) => ({ ...initialState, session: state.session }));
  },
});

export const { clearSaveErrors } = profileSlice.actions;
export default profileSlice.reducer;
