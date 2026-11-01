import { createClient } from 'redis';
import dotenv from 'dotenv'
import logger from '../utils/logger.js';
dotenv.config();

const RedisClient = createClient({
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

RedisClient.on('error', err => logger.error('Redis client error', err));

await RedisClient.connect();
 export default RedisClient

