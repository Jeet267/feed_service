const { cacheRequests } = require('../metrics');

/**
 * Read-through cache on Redis with:
 *  - hit/miss/error stats (exposed at /api/v1/stats/cache and /metrics)
 *  - single-flight: concurrent misses for the same key share ONE loader call,
 *    so a cache expiry under load does not stampede MongoDB
 *  - fail-open: if Redis is down we still serve from the database
 */
function createCache(redis, { name = 'default', logger } = {}) {
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, coalesced: 0, errors: 0 };

  async function getOrSet(key, ttlSec, loader) {
    let cached = null;
    try {
      cached = await redis.get(key);
    } catch (err) {
      stats.errors += 1;
      cacheRequests.inc({ cache: name, result: 'error' });
      logger?.warn({ err: err.message, key }, 'cache read failed, falling back to loader');
    }

    if (cached !== null && cached !== undefined) {
      stats.hits += 1;
      cacheRequests.inc({ cache: name, result: 'hit' });
      return { value: JSON.parse(cached), hit: true };
    }

    stats.misses += 1;
    cacheRequests.inc({ cache: name, result: 'miss' });

    if (inflight.has(key)) {
      stats.coalesced += 1;
      return { value: await inflight.get(key), hit: false };
    }

    const promise = (async () => {
      const value = await loader();
      try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
      } catch (err) {
        stats.errors += 1;
        logger?.warn({ err: err.message, key }, 'cache write failed');
      }
      return value;
    })();

    inflight.set(key, promise);
    try {
      return { value: await promise, hit: false };
    } finally {
      inflight.delete(key);
    }
  }

  function getStats() {
    const total = stats.hits + stats.misses;
    return {
      cache: name,
      ...stats,
      total,
      hitRate: total === 0 ? 0 : Number((stats.hits / total).toFixed(4)),
    };
  }

  function resetStats() {
    stats.hits = 0;
    stats.misses = 0;
    stats.coalesced = 0;
    stats.errors = 0;
  }

  return { getOrSet, getStats, resetStats };
}

module.exports = { createCache };
