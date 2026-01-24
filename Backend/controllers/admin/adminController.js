import { dbService } from '../../services/admin/dbQueries.js'
import { generateToken, verifyToken, generateRefreshToken, verifyRefreshToken } from '../../services/jwtservice.js'
import HttpStatus from '../../utils/statusCodes.js'
import { blackListToken } from '../../services/redis-jwt-service.js'

const adminController = {
  Login: async (req, res) => {
    try {
      const { email, password } = req.body

      const errors = {};
      if (!email) errors.email = "Email is required";
      if (!password) errors.password = "Password is required";
      if (Object.keys(errors).length > 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({ errors });
      }

      const admin = await dbService.getAdminByEmail(email)

      if (!admin) {
        return res
          .status(HttpStatus.UNAUTHORIZED)
          .json({ errors: { email: "Invalid email" } });
      }

      if (!admin.is_active) {
        return res
          .status(HttpStatus.FORBIDDEN)
          .json({ errors: { general: "Your account has been blocked. Please contact support." } });
      }

      const validPassword = await dbService.checkPassword(password, admin.password)

      if (!validPassword) {
        return res
          .status(HttpStatus.UNAUTHORIZED)
          .json({ errors: { password: "Invalid password" } });
      }

      let accessToken = generateToken({ id: admin.id, email: admin.email, role: admin.role, name: admin.name });
      let refreshToken = generateRefreshToken({ id: admin.id, email: admin.email, role: admin.role, name: admin.name });

      if (!accessToken || !refreshToken) {
        return res.status(HttpStatus.UNAUTHORIZED).json({ message: "UNAUTHORIZED" });
      }

      admin.password = null

      // Return tokens in response body
      return res.status(HttpStatus.OK).json({
        message: "Login successful",
        admin,
        accessToken,
        refreshToken
      });

    } catch (error) {
      console.error("❌ Login Error:", error);

      const isDev = process.env.NODE_ENV !== 'production';
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: "Server error",
        ...(isDev && { error: error.message })
      });
    }
  },

  Logout: async (req, res) => {
    // Get token from Authorization header instead of cookie
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

    if (token) {
      blackListToken(token)
    }

    return res.status(HttpStatus.OK).json({ message: "Logged out successfully" });
  },

  getUser: async (req, res) => {
    try {
      // Get token from Authorization header instead of cookie
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : null;

      if (!token) return res.status(HttpStatus.UNAUTHORIZED).json({ message: "UNAUTHORIZED" })

      const decoded = verifyToken(token);

      const admin = await dbService.getAdminById(decoded.id);

      if (!admin) {
        blackListToken(token);
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: "UNAUTHORIZED",
          blocked: true
        });
      }

      if (!admin.is_active) {
        blackListToken(token);
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: "UNAUTHORIZED",
          blocked: true
        });
      }

      return res.status(HttpStatus.OK).json({ admin: decoded });

    } catch (err) {
      console.error(err.message)
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" })
    }
  },

  RefreshToken: async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(HttpStatus.BAD_REQUEST).json({ message: "Refresh token is required" });
      }

      const decoded = verifyRefreshToken(refreshToken);
      const admin = await dbService.getAdminById(decoded.id);

      if (!admin || !admin.is_active) {
        return res.status(HttpStatus.UNAUTHORIZED).json({ message: "UNAUTHORIZED" });
      }

      const newAccessToken = generateToken({ id: admin.id, email: admin.email, role: admin.role, name: admin.name });
      const newRefreshToken = generateRefreshToken({ id: admin.id, email: admin.email, role: admin.role, name: admin.name });

      return res.status(HttpStatus.OK).json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      });
    } catch (error) {
      console.error("❌ Refresh Token Error:", error);
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: "Invalid refresh token" });
    }
  }
}

export default adminController