import express from 'express'
import statusCode from '../../utils/statusCodes.js'
import { dbService } from '../../services/admin/dbQueries.js'
import { generateToken, verifyToken } from '../../services/jwtservice.js'
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

      let token = generateToken({ id: admin.id, email: admin.email, role: admin.role, name: admin.name });

      if (!token) {
        return res.status(HttpStatus.UNAUTHORIZED).json({ message: "UNAUTHORIZED" });
      }

      admin.password = null

      // Return token in response body instead of cookie
      return res.status(HttpStatus.OK).json({ 
        message: "Login successful", 
        admin,
        token // Send token to be stored in localStorage
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
  }
}

export default adminController