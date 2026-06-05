const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const config = require('./config');
const defaultLogger = require('./logger');
const { register, metricsMiddleware } = require('./metrics');
const { isMongoReady } = require('./db/mongo');
const { createCache } = require('./services/cache.service');
const { createFeedService } = require('./services/feed.service');
const { createRateLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const feedRouter = require('./routes/feed.routes');
const postsRouter = require('./routes/posts.routes');

/**
 * App factory: dependencies (redis, limits) are injected so tests can run
 * the real app against an in-memory Redis and MongoDB.
 */
function createApp({ redis, logger = defaultLogger, rateLimit = config.rateLimit, staticDir } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS only matters if the frontend is hosted on a different domain.
  // CORS_ORIGINS="https://my-frontend.vercel.app,http://localhost:5173"
  const origins = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
  app.use(cors({
    origin: origins.includes('*') ? '*' : origins,
    allowedHeaders: ['Content-Type', 'x-user-id'],
    exposedHeaders: ['X-Cache', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  }));

  // Local / Docker: Express serves the frontend. On Vercel the CDN does it.
  if (staticDir) app.use(express.static(staticDir, { maxAge: '1h' }));

  app.use(express.json({ limit: '16kb' }));
  if (process.env.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(metricsMiddleware);

  const trendingCache = createCache(redis, { name: 'trending', logger });
  const feedService = createFeedService({ cache: trendingCache });

  const readLimiter = createRateLimiter(redis, { name: 'read', windowSec: rateLimit.windowSec, max: rateLimit.max, logger });
  const writeLimiter = createRateLimiter(redis, { name: 'write', windowSec: rateLimit.windowSec, max: rateLimit.writeMax, logger });

  // --- Ops endpoints ---
  app.get('/health', async (req, res) => {
    let redisOk = false;
    try {
      redisOk = (await redis.ping()) === 'PONG';
    } catch { /* reported below */ }
    const mongoOk = isMongoReady();
    res.status(mongoOk && redisOk ? 200 : 503).json({
      status: mongoOk && redisOk ? 'ok' : 'degraded',
      mongo: mongoOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  app.get('/api/v1/stats/cache', (req, res) => res.json(trendingCache.getStats()));

  // --- API ---
  app.use('/api/v1/feed', readLimiter, feedRouter(feedService));
  app.use('/api/v1/posts', postsRouter({ readLimiter, writeLimiter }));

  app.use(notFound);
  app.use(errorHandler);

  app.locals.trendingCache = trendingCache;
  return app;
}

module.exports = { createApp };
