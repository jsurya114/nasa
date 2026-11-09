import pool from "../../config/db.js";

const agreementQueries = {
  // Marks the driver's agreement as signed, with the signature name and joining date.
  signAgreement: async (driverId, name, joiningDate) => {
    await pool.query(
      `UPDATE drivers 
         SET agreement_signed = TRUE, 
             agreement_signed_at = NOW(), 
             agreement_signature_name = $1, 
             agreement_joining_date = $2 
         WHERE id = $3`,
      [name, joiningDate, driverId]
    );
  },
};

export default agreementQueries;
