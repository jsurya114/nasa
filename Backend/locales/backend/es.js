// locales/backend/es.js - Backend error messages only
export const backendEs = {
  // Authentication errors
  auth: {
    emailRequired: "El correo electrónico es requerido",
    passwordRequired: "La contraseña es requerida",
    timezoneRequired: "La zona horaria es requerida",
    invalidEmail: "Correo electrónico inválido",
    invalidPassword: "Contraseña inválida",
    accountBlocked: "Tu cuenta ha sido bloqueada. Por favor contacta con soporte.",
    accountDisabled: "La cuenta ha sido deshabilitada",
    unauthorized: "NO AUTORIZADO",
    authTokenMissing: "Falta el token de autenticación",
  },

  // Driver errors
  driver: {
    driverIdRequired: "Se requiere el ID del conductor",
    driverNotFound: "Conductor no encontrado",
  },

  // Access Code errors
  accessCode: {
    allFieldsRequired: "Todos los campos (código postal, dirección, código de acceso) son requeridos",
    invalidZipCode: "Por favor ingrese un código postal válido (5 dígitos o formato 5+4)",
    imageUploadFailed: "Algunas imágenes no se pudieron cargar. Por favor intente nuevamente.",
    savedSuccessfully: "Código de acceso guardado exitosamente",
    alreadyExists: "El código de acceso ya existe",
    failedToFetch: "Error al obtener códigos de acceso",
    failedToCreate: "Error al crear código de acceso",
  },

  // Delivery errors
  delivery: {
    bothDatesRequired: "Se requieren tanto from_date como to_date para filtrar",
    invalidDateFormat: "Formato de fecha inválido. Use AAAA-MM-DD",
    fromDateAfterToDate: "from_date no puede ser posterior a to_date",
    failedToFetchSummary: "Error al obtener resumen de entregas",
    noAuthToken: "No se encontró token de autenticación",
    failedToFetch: "Error al obtener entregas",
    errorFetching: "Error al obtener entregas",
  },

  // Availability errors
  availability: {
    failedToFetch: "Error al obtener disponibilidad",
    invalidData: "Datos de disponibilidad inválidos",
    invalidValueFor: "Valor inválido para",
    mustBeBoolean: "Debe ser booleano",
    updatedSuccessfully: "Disponibilidad actualizada exitosamente",
    driverAvailabilityUpdated: "Disponibilidad del conductor actualizada exitosamente",
    failedToUpdate: "Error al actualizar disponibilidad",
    failedToFetchDrivers: "Error al obtener disponibilidad de conductores",
    failedToFetchCities: "Error al obtener ciudades",
    failedToUpdateDriver: "Error al actualizar disponibilidad del conductor",
    failedToResetAll: "Error al restablecer disponibilidad de todos los conductores",
    resetSuccess: "Se restablecieron {total} conductores exitosamente ({enabled} habilitados, {disabled} deshabilitados)",
  },

  // Journey errors
  journey: {
    routeRequired: "La ruta es requerida",
    startSeqInvalid: "La secuencia inicial debe ser mayor que 0",
    endSeqInvalid: "La secuencia final debe ser >= secuencia inicial",
    sequenceConflict: "Algunos paquetes en este rango de secuencia ya están tomados por otro conductor",
    alreadySaved: "El viaje de hoy ya está guardado",
    savedButSeqFailed: "Viaje guardado pero error al agregar secuencias de entrega",
    errorInserting: "Error al insertar viaje",
    errorFetching: "Error al obtener viaje",
  },

  // Language errors
  language: {
    driverIdAndLanguageRequired: "Se requieren el ID del conductor y el idioma",
    invalidLanguageCode: 'Código de idioma inválido. Debe ser "en" o "es"',
    updatedSuccessfully: "Preferencia de idioma actualizada exitosamente",
    failedToLoad: "Error al cargar idioma",
    failedToSave: "Error al guardar idioma",
  },

  // Password errors
  password: {
    currentPasswordRequired: "La contraseña actual es requerida",
    newPasswordRequired: "La nueva contraseña es requerida",
    minLength: "La nueva contraseña debe tener al menos 6 caracteres",
    maxLength: "La nueva contraseña no debe exceder 50 caracteres",
    confirmRequired: "Por favor confirme su nueva contraseña",
    passwordsDoNotMatch: "Las contraseñas no coinciden",
    mustBeDifferent: "La nueva contraseña debe ser diferente de la contraseña actual",
    validationFailed: "Validación fallida",
    updatedSuccessfully: "Contraseña actualizada exitosamente",
    incorrectCurrent: "La contraseña actual es incorrecta",
    failedToUpdate: "Error al actualizar contraseña. Por favor intente nuevamente.",
  },

  // Common errors
  common: {
    serverError: "Error del servidor",
    success: "Éxito",
    failed: "Fallido",
  },
};

export default backendEs;