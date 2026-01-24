import jwt from "jsonwebtoken";

// Function to generate a token
export const generateToken = (payload, expiresIn = "15m") => {
  const secret = process.env.JWT_SECRET;
  return jwt.sign(payload, secret, { expiresIn });
};

// Function to generate a refresh token
export const generateRefreshToken = (payload, expiresIn = "7d") => {
  const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyToken = (token) => {
  const secret = process.env.JWT_SECRET;
  const decoded = jwt.verify(token, secret);
  return decoded;
};

export const verifyRefreshToken = (token) => {
  const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
  const decoded = jwt.verify(token, secret);
  return decoded;
};

