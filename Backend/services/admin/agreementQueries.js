import pool from "../../config/db.js";

const agreementQueries = {
  // Drivers with their agreement status. A superadmin sees every city; any other admin only the cities
  // assigned to them.
  getAgreementsForAdmin: async (isSuperAdmin, adminId) => {
    const query = `
        SELECT 
          d.id, 
          d.name, 
          d.email, 
          d.driver_code, 
          d.enabled,
          d.agreement_signed,
          d.agreement_signed_at,
          d.agreement_signature_name,
          d.agreement_joining_date,
          c.job AS city_job
        FROM drivers d
        LEFT JOIN city c ON d.city_id = c.id
        WHERE ($1::boolean OR EXISTS (
          SELECT 1 FROM admin_city_ref acr
          WHERE acr.city_id = d.city_id AND acr.admin_id = $2
        ))
        ORDER BY d.id DESC
      `;
    const { rows } = await pool.query(query, [isSuperAdmin, adminId]);
    return rows;
  },

  // Revokes (status false) or marks as signed the agreement of one driver. Returns how many rows changed.
  setAgreementStatus: async (id, status) => {
    // If status is false (revoking), we clear the signature data as well
    let updateQuery;
    let queryParams;

    if (status === false) {
      updateQuery = `
          UPDATE drivers 
          SET agreement_signed = FALSE, 
              agreement_signed_at = NULL,
              agreement_signature_name = NULL,
              agreement_joining_date = NULL
          WHERE id = $1
          RETURNING *
        `;
      queryParams = [id];
    } else {
      // Technically admin shouldn't manually set it to TRUE without a signature, 
      // but just in case:
      updateQuery = `
          UPDATE drivers 
          SET agreement_signed = TRUE,
              agreement_signed_at = NOW()
          WHERE id = $1
          RETURNING *
        `;
      queryParams = [id];
    }

    const { rowCount } = await pool.query(updateQuery, queryParams);
    return rowCount;
  },
};

export default agreementQueries;
