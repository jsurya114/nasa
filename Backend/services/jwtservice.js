import jwt from "jsonwebtoken";

// Function to generate a token
export const generateToken = (payload, expiresIn = "15m") => {
  const secret = process.env.JWT_SECRET;
  return jwt.sign(payload, secret, { expiresIn });
};

// Function to generate a refresh token. It is signed with its own secret, so a
// refresh token can never be accepted as an access token, and the other way round.
export const generateRefreshToken = (payload, expiresIn = "7d") => {
  const secret = process.env.REFRESH_TOKEN_SECRET;
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyToken = (token) => {
  const secret = process.env.JWT_SECRET;
  const decoded = jwt.verify(token, secret);
  return decoded;
};

export const verifyRefreshToken = (token) => {
  const secret = process.env.REFRESH_TOKEN_SECRET;
  const decoded = jwt.verify(token, secret);
  return decoded;
};

// Called once at start-up. Refuses to run with a missing or shared secret, so a
// forgotten setting stops the server with a clear message instead of failing on
// the first login.
export const assertAuthSecrets = () => {
  const access = process.env.JWT_SECRET;
  const refresh = process.env.REFRESH_TOKEN_SECRET;

  if (!access) {
    throw new Error("JWT_SECRET is not set");
  }
  if (!refresh) {
    throw new Error("REFRESH_TOKEN_SECRET is not set. Set it to a long random value that is different from JWT_SECRET.");
  }
  if (refresh === access) {
    throw new Error("REFRESH_TOKEN_SECRET must be different from JWT_SECRET");
  }
};

