require('dotenv').config();

const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/hyperlocal',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  logLevel: process.env.LOG_LEVEL || 'info',

  feed: {
    defaultRadiusKm: 5,
    maxRadiusKm: 25,
    defaultLimit: 20,
    maxLimit: 50,
  },

  trending: {
    cacheTtlSec: toInt(process.env.TRENDING_CACHE_TTL_SEC, 60),
    // Geohash precision 5 = cell of ~4.9km x 4.9km. Every user inside the
    // same cell shares one cache entry, which is what makes the hit rate high.
    geohashPrecision: 5,
    radiusKm: 5,
    windowHours: 48,
    candidateLimit: 500,
    size: 20,
  },

  rateLimit: {
    windowSec: toInt(process.env.RATE_LIMIT_WINDOW_SEC, 60),
    max: toInt(process.env.RATE_LIMIT_MAX, 100),
    writeMax: toInt(process.env.RATE_LIMIT_WRITE_MAX, 20),
  },
};
