
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  currentLanguage: sessionStorage.getItem('driverLanguage') || 'en',
};

const languageSlice = createSlice({
  name: 'language',
  initialState,
  reducers: {
    setLanguage: (state, action) => {
      state.currentLanguage = action.payload;
      sessionStorage.setItem('driverLanguage', action.payload);
    },
    resetLanguage: (state) => {
      state.currentLanguage = 'en';
      sessionStorage.removeItem('driverLanguage');
    },
  },
});

export const { setLanguage, resetLanguage } = languageSlice.actions;
export default languageSlice.reducer;