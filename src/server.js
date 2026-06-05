const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { connectMongo, mongoose } = require('./db/mongo');
const { createRedis } = require('./db/redis');
const { createApp } = require('./app');
const Post = require('./models/Post');
const Like = require('./models/Like');

async function main() {
  await connectMongo(config.mongoUri);
  await Promise.all([Post.createIndexes(), Like.createIndexes()]);
  logger.info('Indexes ensured');

  const redis = createRedis(config.redisUrl);
  const app = createApp({ redis, staticDir: path.join(__dirname, '..', 'public') });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Hyperlocal feed service listening');
  });

  // Graceful shutdown: stop accepting new connections, let in-flight
  // requests finish, then close DB connections. Docker sends SIGTERM.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await Promise.allSettled([mongoose.disconnect(), redis.quit()]);
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
