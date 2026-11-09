import logger from '../utils/logger.js';
import jwt from 'jsonwebtoken'
import client from '../config/redis.js'
import { verifyRefreshToken } from './jwtservice.js'

// Used when a token has no readable expiry.
const DEFAULT_REVOKE_SECONDS = 3600

// Seconds until the token expires. A revoked token only needs to stay on the
// list while it could still be used, so this keeps a 7 day refresh token
// revoked for 7 days, and a 15 minute access token for 15 minutes.
const secondsLeft = (token) => {
    const exp = jwt.decode(token)?.exp
    if (!Number.isFinite(exp)) return DEFAULT_REVOKE_SECONDS
    return Math.max(1, Math.ceil(exp - Date.now() / 1000))
}

// Never throws. If Redis is unavailable the failure is logged and false is returned.
export async function blackListToken(token) {
    try {
        await client.set(token, 'revoked', { EX: secondsLeft(token) })
        logger.debug('Token added to the revoked list')
        return true
    } catch (error) {
        logger.warn('Could not revoke token in Redis', { reason: error.message })
        return false
    }
}

// Revokes a refresh token sent at logout, but only if it belongs to the person
// logging out. `belongsToCaller(decoded)` decides that. Anything that is not a
// valid refresh token is ignored.
export async function revokeRefreshToken(refreshToken, belongsToCaller) {
    if (typeof refreshToken !== 'string' || !refreshToken) return false
    try {
        const decoded = verifyRefreshToken(refreshToken)
        if (!belongsToCaller(decoded)) return false
        return await blackListToken(refreshToken)
    } catch {
        return false
    }
}

export  async function isTokenRevoked(jti){
    try {
        const reply = await client.get(jti)
        return reply === 'revoked'
    } catch (error) {
        logger.warn('Redis error while checking a token', error)
        return false
    }
}
