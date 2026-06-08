const request = require('supertest');
const RedisMock = require('ioredis-mock');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { mongoose } = require('../../src/db/mongo');
const Post = require('../../src/models/Post');
const Like = require('../../src/models/Like');
const { createApp } = require('../../src/app');

const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
const WHITEFIELD = { lat: 12.9698, lng: 77.75 }; // ~14km from Koramangala

let mongod;
let redis;
let app;

const rawPost = (overrides = {}) => {
  const { lat, lng } = overrides.at || KORAMANGALA;
  const createdAt = overrides.createdAt || new Date();
  return {
    authorId: 'u1',
    title: overrides.title || 'Test post',
    body: 'body',
    category: overrides.category || 'news',
    location: { type: 'Point', coordinates: [lng, lat] },
    likeCount: overrides.likeCount || 0,
    createdAt,
    updatedAt: createdAt,
  };
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([Post.createIndexes(), Like.createIndexes()]);
  redis = new RedisMock();
  app = createApp({ redis, rateLimit: { windowSec: 60, max: 10_000, writeMax: 10_000 } });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  if (redis) redis.disconnect();
});

beforeEach(async () => {
  await Promise.all([Post.deleteMany({}), Like.deleteMany({}), redis.flushall()]);
  app.locals.trendingCache.resetStats();
});

describe('POST /api/v1/posts', () => {
  test('creates a post', async () => {
    const res = await request(app).post('/api/v1/posts').send({
      authorId: 'u1', title: 'Road closed', body: 'Avoid 80ft road', category: 'alerts', ...KORAMANGALA,
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.distanceKm).toBe(0);
    expect(res.headers.location).toBe(`/api/v1/posts/${res.body.id}`);
  });

  test('rejects invalid coordinates and category', async () => {
    const res = await request(app).post('/api/v1/posts').send({
      authorId: 'u1', title: 'Bad', body: 'x', category: 'memes', lat: 200, lng: 77,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['lat', 'category']));
  });
});

describe('GET /api/v1/feed/nearby', () => {
  test('returns only posts inside the radius, newest first', async () => {
    const now = Date.now();
    await Post.collection.insertMany([
      rawPost({ title: 'near-old', createdAt: new Date(now - 60_000) }),
      rawPost({ title: 'near-new', createdAt: new Date(now) }),
      rawPost({ title: 'far', at: WHITEFIELD }),
    ]);

    const res = await request(app).get('/api/v1/feed/nearby').query({ ...KORAMANGALA, radiusKm: 5 });
    expect(res.status).toBe(200);
    expect(res.body.items.map((p) => p.title)).toEqual(['near-new', 'near-old']);
    expect(res.body.nextCursor).toBeNull();
  });

  test('cursor pagination returns every post exactly once', async () => {
    const base = Date.now();
    // Include duplicate timestamps to exercise the _id tie-breaker.
    const docs = Array.from({ length: 25 }, (_, i) => rawPost({ title: `p${i}`, createdAt: new Date(base - Math.floor(i / 2) * 1000) }));
    await Post.collection.insertMany(docs);

    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const res = await request(app).get('/api/v1/feed/nearby').query({ ...KORAMANGALA, limit: 10, ...(cursor && { cursor }) });
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((p) => p.id));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  test('filters by category', async () => {
    await Post.collection.insertMany([rawPost({ category: 'jobs' }), rawPost({ category: 'events' })]);
    const res = await request(app).get('/api/v1/feed/nearby').query({ ...KORAMANGALA, category: 'jobs' });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].category).toBe('jobs');
  });

  test('uses the geo index (no collection scan)', async () => {
    await Post.collection.insertMany(Array.from({ length: 50 }, () => rawPost()));
    const { withinRadiusFilter } = require('../../src/utils/geo');
    const explain = await Post.find(withinRadiusFilter(KORAMANGALA.lat, KORAMANGALA.lng, 5))
      .sort({ createdAt: -1, _id: -1 }).limit(21).explain('executionStats');
    const plan = JSON.stringify(Array.isArray(explain) ? explain[0].queryPlanner : explain.queryPlanner);
    expect(plan).toContain('IXSCAN');
    expect(plan).not.toContain('COLLSCAN');
  });

  test('400 on bad cursor and missing lat', async () => {
    const bad = await request(app).get('/api/v1/feed/nearby').query({ ...KORAMANGALA, cursor: 'junk' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
    const missing = await request(app).get('/api/v1/feed/nearby').query({ lng: 77 });
    expect(missing.status).toBe(400);
  });
});

describe('GET /api/v1/feed/trending', () => {
  test('ranks by hot score and is served from cache on the second call', async () => {
    const now = Date.now();
    await Post.collection.insertMany([
      rawPost({ title: 'viral', likeCount: 300, createdAt: new Date(now - 2 * 3.6e6) }),
      rawPost({ title: 'meh', likeCount: 2, createdAt: new Date(now - 2 * 3.6e6) }),
      rawPost({ title: 'too-old', likeCount: 999, createdAt: new Date(now - 72 * 3.6e6) }),
    ]);

    const first = await request(app).get('/api/v1/feed/trending').query(KORAMANGALA);
    expect(first.status).toBe(200);
    expect(first.headers['x-cache']).toBe('MISS');
    expect(first.body.items.map((p) => p.title)).toEqual(['viral', 'meh']);

    // A different user in the same geohash cell shares the cache entry.
    const nearby = { lat: KORAMANGALA.lat + 0.001, lng: KORAMANGALA.lng + 0.001 };
    const second = await request(app).get('/api/v1/feed/trending').query(nearby);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body.cell).toBe(first.body.cell);

    const stats = await request(app).get('/api/v1/stats/cache');
    expect(stats.body.hits).toBe(1);
    expect(stats.body.misses).toBe(1);
    expect(stats.body.hitRate).toBe(0.5);
  });
});

describe('likes', () => {
  test('like is idempotent and unlike decrements', async () => {
    const { insertedIds } = await Post.collection.insertMany([rawPost()]);
    const id = String(insertedIds[0]);

    const l1 = await request(app).post(`/api/v1/posts/${id}/like`).send({ userId: 'alice' });
    const l2 = await request(app).post(`/api/v1/posts/${id}/like`).send({ userId: 'alice' });
    await request(app).post(`/api/v1/posts/${id}/like`).send({ userId: 'bob' });
    expect(l1.status).toBe(201);
    expect(l2.status).toBe(200);
    expect(l2.body.changed).toBe(false);
    expect((await request(app).get(`/api/v1/posts/${id}`)).body.likeCount).toBe(2);

    await request(app).delete(`/api/v1/posts/${id}/like`).send({ userId: 'alice' });
    await request(app).delete(`/api/v1/posts/${id}/like`).send({ userId: 'alice' });
    expect((await request(app).get(`/api/v1/posts/${id}`)).body.likeCount).toBe(1);
  });

  test('concurrent double-tap counts once', async () => {
    const { insertedIds } = await Post.collection.insertMany([rawPost()]);
    const id = String(insertedIds[0]);
    await Promise.all(Array.from({ length: 10 }, () => request(app).post(`/api/v1/posts/${id}/like`).send({ userId: 'carol' })));
    expect((await request(app).get(`/api/v1/posts/${id}`)).body.likeCount).toBe(1);
  });

  test('404 for unknown post', async () => {
    const res = await request(app).post('/api/v1/posts/64b7f0c2a1b2c3d4e5f60718/like').send({ userId: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('ops', () => {
  test('health reports both dependencies', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mongo: 'up', redis: 'up' });
  });

  test('metrics exposes prometheus counters', async () => {
    await request(app).get('/api/v1/feed/trending').query(KORAMANGALA);
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('cache_requests_total');
  });
});
