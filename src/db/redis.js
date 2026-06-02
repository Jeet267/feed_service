const Redis = require('ioredis');
const logger = require('../logger');

/**
 * Long-running server: connect eagerly and fail fast while Redis is down
 * (no offline queue), so the cache and rate limiter fail open immediately.
 *
 * Serverless (Vercel): connect lazily and let the handler await connect(),
 * because every cold start begins with a fresh, not-yet-ready connection.
 * Works with Upstash: just use its rediss:// URL (TLS is automatic).
 */
function createRedis(url, { serverless = false } = {}) {
  const redis = new Redis(url, serverless
    ? { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: true }
    : { maxRetriesPerRequest: 2, enableOfflineQueue: false, retryStrategy: (times) => Math.min(times * 200, 2000) });

  redis.on('ready', () => logger.info('Redis connected'));
  redis.on('error', (err) => logger.warn({ err: err.message }, 'Redis error'));
  return redis;
}

module.exports = { createRedis };
