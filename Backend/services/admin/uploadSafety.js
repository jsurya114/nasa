// Shared rules for the Excel upload actions (issue #29).
//
// The daily upload, the weekly upload and "add staged weekly data to the dashboard" all rewrite
// shared staging tables. They take one lock so they run one after another, and each does all of
// its writing inside a single transaction so a failure leaves the previous data in place.

// The file or request cannot be used. Nothing was changed. Answered with 400.
export class UploadFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "UploadFileError";
  }
}

// Another upload is still running. Answered with 409.
export class UploadBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "UploadBusyError";
  }
}

// Any fixed number; only these upload actions use it.
const UPLOAD_LOCK_KEY = 41290001;
const LOCK_WAIT = "60s";
const LOCK_TIMEOUT_CODE = "55P03";

// Call right after BEGIN. Waits for a running upload to finish (up to a minute), and the lock is
// released automatically at COMMIT or ROLLBACK.
export const lockUploads = async (client) => {
  try {
    await client.query(`SET LOCAL lock_timeout = '${LOCK_WAIT}'`);
    await client.query("SELECT pg_advisory_xact_lock($1)", [UPLOAD_LOCK_KEY]);
    await client.query("SET LOCAL lock_timeout = 0");
  } catch (error) {
    if (error.code === LOCK_TIMEOUT_CODE) {
      throw new UploadBusyError("Another upload is still running. Please try again in a minute.");
    }
    throw error;
  }
};

// True only for a real calendar date written as YYYY-MM-DD.
export const isIsoDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// Answers the errors above with a clear message. Returns true when it did.
export const respondToUploadError = (res, error) => {
  if (error instanceof UploadFileError) {
    res.status(400).json({ success: false, message: error.message });
    return true;
  }
  if (error instanceof UploadBusyError) {
    res.status(409).json({ success: false, message: error.message });
    return true;
  }
  return false;
};
