// Driver type shown in the Drivers table and chosen in the Change modal. The server stores LOCAL or DESI; a driver nobody has classified
// yet has no type (null) and shows as "Not set".
export const DRIVER_TYPE_LABEL = { LOCAL: "Local", DESI: "Desi" };
export const driverTypeLabel = (type) => DRIVER_TYPE_LABEL[type] ?? "Not set";

// How many of these drivers are Local, Desi or not set (used to describe a mixed selection).
export const countByType = (drivers) =>
  drivers.reduce((counts, d) => {
    const key = DRIVER_TYPE_LABEL[d.driver_type] ? d.driver_type : "NONE";
    return { ...counts, [key]: counts[key] + 1 };
  }, { LOCAL: 0, DESI: 0, NONE: 0 });
