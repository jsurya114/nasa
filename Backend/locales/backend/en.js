// locales/backend/en.js - Backend error messages only
export const backendEn = {
  // Authentication errors
  auth: {
    emailRequired: "Email is required",
    passwordRequired: "Password is required",
    timezoneRequired: "Timezone is required",
    invalidEmail: "Invalid email",
    invalidPassword: "Invalid password",
    accountBlocked: "Your account has been blocked. Please contact support.",
    accountDisabled: "Account has been disabled",
    unauthorized: "UNAUTHORIZED",
    authTokenMissing: "Authentication token missing",
  },

  // Driver errors
  driver: {
    driverIdRequired: "Driver ID is required",
    driverNotFound: "Driver not found",
  },

  // Access Code errors
  accessCode: {
    allFieldsRequired: "All fields (zip_code, address, access_code) are required",
    invalidZipCode: "Please enter a valid zip code (5 digits or 5+4 format)",
    imageUploadFailed: "Some images failed to upload. Please try again.",
    savedSuccessfully: "Access code saved successfully",
    alreadyExists: "Access code already exists",
    failedToFetch: "Failed to fetch access codes",
    failedToCreate: "Failed to create access code",
  },

  // Delivery errors
  delivery: {
    bothDatesRequired: "Both from_date and to_date are required for filtering",
    invalidDateFormat: "Invalid date format. Use YYYY-MM-DD",
    fromDateAfterToDate: "from_date cannot be after to_date",
    failedToFetchSummary: "Failed to fetch delivery summary",
    noAuthToken: "No authentication token found",
    failedToFetch: "Failed to fetch deliveries",
    errorFetching: "Error fetching deliveries",
  },

  // Availability errors
  availability: {
    failedToFetch: "Failed to fetch availability",
    invalidData: "Invalid availability data",
    invalidValueFor: "Invalid value for",
    mustBeBoolean: "Must be boolean",
    updatedSuccessfully: "Availability updated successfully",
    driverAvailabilityUpdated: "Driver availability updated successfully",
    failedToUpdate: "Failed to update availability",
    failedToFetchDrivers: "Failed to fetch drivers availability",
    failedToFetchCities: "Failed to fetch cities",
    failedToUpdateDriver: "Failed to update driver availability",
    failedToResetAll: "Failed to reset all drivers availability",
    resetSuccess: "Successfully reset {total} drivers ({enabled} enabled, {disabled} disabled)",
  },

  // Journey errors
  journey: {
    routeRequired: "Route is required",
    startSeqInvalid: "Start sequence must be greater than 0",
    endSeqInvalid: "End sequence must be >= start sequence",
    sequenceConflict: "Some packages in this sequence range are already taken by another driver",
    alreadySaved: "Journey for today is already saved",
    savedButSeqFailed: "Journey saved but failed to add delivery sequences",
    errorInserting: "Error inserting journey",
    errorFetching: "Error fetching journey",
  },

  // Language errors
  language: {
    driverIdAndLanguageRequired: "Driver ID and language are required",
    invalidLanguageCode: 'Invalid language code. Must be "en" or "es"',
    updatedSuccessfully: "Language preference updated successfully",
    failedToLoad: "Failed to load language",
    failedToSave: "Failed to save language",
  },

  // Password errors
  password: {
    currentPasswordRequired: "Current password is required",
    newPasswordRequired: "New password is required",
    minLength: "New password must be at least 6 characters",
    maxLength: "New password must not exceed 50 characters",
    confirmRequired: "Please confirm your new password",
    passwordsDoNotMatch: "Passwords do not match",
    mustBeDifferent: "New password must be different from current password",
    validationFailed: "Validation failed",
    updatedSuccessfully: "Password updated successfully",
    incorrectCurrent: "Current password is incorrect",
    failedToUpdate: "Failed to update password. Please try again.",
  },

  // Common errors
  common: {
    serverError: "Server error",
    success: "Success",
    failed: "Failed",
  },
};

export default backendEn;