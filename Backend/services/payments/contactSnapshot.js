// A provider call (Everee, QuickBooks) is built from the driver's email and phone as they were when the call started. A link is written only if,
// under the driver's lock, those details are still exactly what was used and nobody is holding them for review (drivers.contact_changed_at is empty).
// A driver can change their own contact at any moment (Profile page); this keeps a link from being saved for details that were never checked.

export const contactSnapshot = (driver) => ({ email: driver.email ?? null, phone: driver.phone_number ?? null });

// `tx` is inside the driver's lock. FOR SHARE waits for a profile save that is writing the same row, so the answer is never older than that save.
export const contactStillVerified = async (tx, driverId, snapshot) => {
  const { rows: [row] } = await tx.query('SELECT email, phone_number, contact_changed_at FROM drivers WHERE id = $1 FOR SHARE', [driverId]);
  return Boolean(row) && !row.contact_changed_at && (row.email ?? null) === snapshot.email && (row.phone_number ?? null) === snapshot.phone;
};

export const CONTACT_CHANGED_WHILE_LINKING = "this driver's email or phone changed while linking; nothing was linked. Check the new details, confirm them, and look the driver up again";
