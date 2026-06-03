const { rateLimited } = require('../metrics');

// INCR + EXPIRE in one atomic Lua script, so two concurrent requests can
// never both see "first hit" and the key can never be left without a TTL.
const INCR_WITH_TTL = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

/**
 * Fixed-window rate limiter backed by Redis, so the limit is shared across
 * every API instance behind a load balancer (an in-memory limiter is not).
 * Fails OPEN: if Redis is unavailable we let traffic through rather than
 * take the whole API down.
 */
function createRateLimiter(redis, {
  name = 'default',
  windowSec,
  max,
  keyFn = (req) => req.get('x-user-id') || req.ip,
  logger,
}) {
  return async function rateLimiter(req, res, next) {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowId = Math.floor(nowSec / windowSec);
    const key = `rl:${name}:${keyFn(req)}:${windowId}`;
    const resetSec = windowSec - (nowSec % windowSec);

    let count;
    try {
      count = Number(await redis.eval(INCR_WITH_TTL, 1, key, windowSec));
    } catch (err) {
      logger?.warn({ err: err.message }, 'rate limiter unavailable, failing open');
      return next();
    }

    res.set({
      'X-RateLimit-Limit': max,
      'X-RateLimit-Remaining': Math.max(0, max - count),
      'X-RateLimit-Reset': resetSec,
    });

    if (count > max) {
      rateLimited.inc({ limiter: name });
      res.set('Retry-After', resetSec);
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: `Too many requests, retry in ${resetSec}s` },
      });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
