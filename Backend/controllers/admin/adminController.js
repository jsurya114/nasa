import { dbService } from '../../services/admin/dbQueries.js'
import { generateToken, verifyToken, generateRefreshToken, verifyRefreshToken } from '../../services/jwtservice.js'
import HttpStatus from '../../utils/statusCodes.js'
import { blackListToken, revokeRefreshToken, isTokenRevoked } from '../../services/redis-jwt-service.js'
import { ADMIN_ROLES } from '../../middlewares/requireRole.js'
import logger from '../../utils/logger.js';
import asyncHandler from '../../utils/asyncHandler.js'

const adminController = {
  Login: asyncHandler(async (req, res) => {
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

  }, {
    log: "Login Error",
    respond: (error, req, res) => {
      const isDev = process.env.NODE_ENV !== 'production';
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: "Server error",
        ...(isDev && { error: error.message })
      });
    },
  }),

  Logout: async (req, res) => {
    // Get token from Authorization header instead of cookie
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

    if (token) {
      await blackListToken(token)
    }

    // Also revoke the refresh token, so it cannot be used to sign in again.
    // Only the caller's own refresh token is revoked.
    // An automatic refresh during logout replaces the refresh token, so the app also sends the one it replaced.
    const ownsRefreshToken = (decoded) => decoded.id === req.user?.id && ADMIN_ROLES.includes(decoded.role)
    for (const refreshToken of [req.body?.refreshToken, req.body?.previousRefreshToken]) {
      await revokeRefreshToken(refreshToken, ownsRefreshToken)
    }

    return res.status(HttpStatus.OK).json({ message: "Logged out successfully" });
  },

  getUser: asyncHandler(async (req, res) => {
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

  }, {
    log: 'getUser failed',
    respond: (err, req, res) => res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" }),
  }),

  RefreshToken: asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(HttpStatus.BAD_REQUEST).json({ message: "Refresh token is required" });
    }

    const decoded = verifyRefreshToken(refreshToken);

    // A driver refresh token must never mint an admin token.
    if (!ADMIN_ROLES.includes(decoded.role)) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: "UNAUTHORIZED" });
    }

    // A refresh token revoked at logout can no longer be used.
    if (await isTokenRevoked(refreshToken)) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: "UNAUTHORIZED" });
    }

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
  }, {
    log: "Refresh Token Error",
    respond: (error, req, res) => res.status(HttpStatus.UNAUTHORIZED).json({ message: "Invalid refresh token" }),
  })
}

export default adminController