import pool from "../../config/db.js";
import HttpStatus from "../../utils/statusCodes.js";
import { checkDriverAccess, isSuperAdmin } from "../../services/admin/agreementAccess.js";

// The driver id from the URL: digits only. The same number is used for the city check and the change.
const parseDriverId = (value) => (/^\d{1,9}$/.test(String(value)) && Number(value) > 0 ? Number(value) : null);

const agreementController = {
  // Get all drivers with their agreement status
  getAllAgreements: async (req, res) => {
    try {
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
      // A superadmin sees every city; any other admin only the cities assigned to them.
      const { rows } = await pool.query(query, [isSuperAdmin(req.user), req.user?.id ?? 0]);

      return res.status(HttpStatus.OK).json({
        success: true,
        data: rows
      });
    } catch (error) {
      console.error("❌ Fetch Agreements Error:", error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to fetch driver agreements"
      });
    }
  },

  // Toggle/Reset a driver's agreement status
  toggleAgreement: async (req, res) => {
    try {
      const id = parseDriverId(req.params.id);
      if (id === null) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Invalid driver id" });
      }
      const { status } = req.body; // expected boolean: true or false

      const access = await checkDriverAccess(req.user, id);
      if (access === 'missing') {
        return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: "Driver not found" });
      }
      if (access !== 'allowed') {
        return res.status(HttpStatus.FORBIDDEN).json({
          success: false,
          message: "You can only manage agreements of drivers in your assigned cities"
        });
      }

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

      if (rowCount === 0) {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: "Driver not found"
        });
      }

      return res.status(HttpStatus.OK).json({
        success: true,
        message: status ? "Agreement marked as signed" : "Agreement revoked successfully"
      });
    } catch (error) {
      console.error("❌ Toggle Agreement Error:", error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to update agreement status"
      });
    }
  }
};

export default agreementController;
