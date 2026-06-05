/**
 * Vercel serverless entry point.
 *
 * Vercel runs this file as a function and rewrites /api/*, /health and
 * /metrics to it (see vercel.json). The frontend in /public is served by
 * Vercel's CDN directly, so frontend and backend share one domain.
 *
 * Connections are created once per warm instance and reused across
 * invocations; only a cold start pays the connection cost.
 */
const config = require('../src/config');
const logger = require('../src/logger');
const { connectMongo } = require('../src/db/mongo');
const { createRedis } = require('../src/db/redis');
const { createApp } = require('../src/app');

let appPromise;

async function init() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI environment variable is not set');

  const redis = createRedis(config.redisUrl, { serverless: true });
  await Promise.all([
    // Small pool: many short-lived instances each hold their own pool,
    // and Atlas free tier caps total connections.
    connectMongo(config.mongoUri, { maxPoolSize: Number(process.env.MONGO_POOL_SIZE || 5) }),
    // Redis is optional: if it fails, cache and rate limiter fail open.
    redis.connect().catch((err) => logger.warn({ err: err.message }, 'Redis unavailable, continuing without it')),
  ]);
  return createApp({ redis });
}

module.exports = async function handler(req, res) {
  try {
    appPromise = appPromise || init();
    const app = await appPromise;
    return app(req, res);
  } catch (err) {
    appPromise = undefined; // let the next request retry the startup
    console.error('Startup failed:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: { code: 'STARTUP_FAILED', message: 'Service could not start. Check MONGO_URI / REDIS_URL in Vercel env vars and the function logs.' },
    }));
  }
};
