import pool from "../../config/db.js";

const languageQueries = {
  // Rows with the driver's preferred_language (none when the driver does not exist).
  getPreferredLanguage: async (driverId) => {
    const result = await pool.query(
      'SELECT preferred_language FROM drivers WHERE id = $1',
      [driverId]
    );
    return result.rows;
  },

  // Rows with the saved id and preferred_language (none when the driver does not exist).
  updatePreferredLanguage: async (driverId, language) => {
    const result = await pool.query(
      'UPDATE drivers SET preferred_language = $1 WHERE id = $2 RETURNING id, preferred_language',
      [language, driverId]
    );
    return result.rows;
  },
};

export default languageQueries;
