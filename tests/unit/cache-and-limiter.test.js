const express = require('express');
const request = require('supertest');
const RedisMock = require('ioredis-mock');
const { createCache } = require('../../src/services/cache.service');
const { createRateLimiter } = require('../../src/middleware/rateLimiter');

describe('cache service', () => {
  let redis;
  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });
  afterEach(() => redis.disconnect());

  test('miss then hit, with hit rate', async () => {
    const cache = createCache(redis, { name: 't1' });
    const loader = jest.fn().mockResolvedValue({ a: 1 });

    const first = await cache.getOrSet('k', 60, loader);
    const second = await cache.getOrSet('k', 60, loader);

    expect(first).toEqual({ value: { a: 1 }, hit: false });
    expect(second).toEqual({ value: { a: 1 }, hit: true });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.getStats().hitRate).toBe(0.5);
  });

  test('single-flight: 20 concurrent misses call the loader once', async () => {
    const cache = createCache(redis, { name: 't2' });
    const loader = jest.fn(() => new Promise((r) => setTimeout(() => r([1, 2, 3]), 30)));

    const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrSet('hot', 60, loader)));

    expect(loader).toHaveBeenCalledTimes(1);
    results.forEach((r) => expect(r.value).toEqual([1, 2, 3]));
    expect(cache.getStats().coalesced).toBe(19);
  });

  test('fails open when redis is down', async () => {
    const broken = { get: jest.fn().mockRejectedValue(new Error('down')), set: jest.fn().mockRejectedValue(new Error('down')) };
    const cache = createCache(broken, { name: 't3' });
    const res = await cache.getOrSet('k', 60, async () => 'from-db');
    expect(res.value).toBe('from-db');
    expect(cache.getStats().errors).toBe(2);
  });
});

describe('rate limiter', () => {
  function appWith(redis, max) {
    const app = express();
    app.use(createRateLimiter(redis, { name: 'test', windowSec: 60, max }));
    app.get('/', (req, res) => res.send('ok'));
    return app;
  }

  test('allows up to max, then 429 with headers', async () => {
    const redis = new RedisMock();
    await redis.flushall();
    const app = appWith(redis, 3);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get('/').set('x-user-id', 'u1');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-remaining']).toBe(String(2 - i));
    }
    const blocked = await request(app).get('/').set('x-user-id', 'u1');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    // A different user has their own bucket.
    const other = await request(app).get('/').set('x-user-id', 'u2');
    expect(other.status).toBe(200);
    redis.disconnect();
  });

  test('fails open when redis is unavailable', async () => {
    const broken = { eval: jest.fn().mockRejectedValue(new Error('down')) };
    const res = await request(appWith(broken, 1)).get('/');
    expect(res.status).toBe(200);
  });
});
