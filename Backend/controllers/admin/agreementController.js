import agreementQueries from "../../services/admin/agreementQueries.js";
import HttpStatus from "../../utils/statusCodes.js";
import { checkDriverAccess, isSuperAdmin } from "../../services/admin/agreementAccess.js";
import logger from '../../utils/logger.js';

// The driver id from the URL: digits only. The same number is used for the city check and the change.
const parseDriverId = (value) => (/^\d{1,9}$/.test(String(value)) && Number(value) > 0 ? Number(value) : null);

const agreementController = {
  // Get all drivers with their agreement status
  getAllAgreements: async (req, res) => {
    try {
      // A superadmin sees every city; any other admin only the cities assigned to them.
      const rows = await agreementQueries.getAgreementsForAdmin(isSuperAdmin(req.user), req.user?.id ?? 0);

      return res.status(HttpStatus.OK).json({
        success: true,
        data: rows
      });
    } catch (error) {
      logger.error("Fetch Agreements Error", error);
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

      const rowCount = await agreementQueries.setAgreementStatus(id, status);

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
      logger.error("Toggle Agreement Error", error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to update agreement status"
      });
    }
  }
};

export default agreementController;
