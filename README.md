# Hyperlocal Feed Service

A location-aware feed API in the style of hyperlocal apps (local news, jobs, events, alerts):
users see posts **within N km of where they are**, plus a **trending** feed for their area.

Built to explore the backend problems that show up at scale: geospatial queries, cache design,
pagination that stays fast at depth, idempotent writes, rate limiting, and measuring all of it.

**Stack:** Node.js 20 · Express · MongoDB 7 (2dsphere) · Redis 7 · Docker Compose · Prometheus metrics · Jest · k6

---

## Architecture

```mermaid
flowchart LR
    C[Client] --> RL[Rate limiter<br/>Redis, Lua INCR+EXPIRE]
    RL --> API[Express API]
    API -- nearby feed --> M[(MongoDB<br/>2dsphere + createdAt index)]
    API -- trending --> CA{Redis cache<br/>key = geohash cell}
    CA -- HIT --> API
    CA -- MISS, single-flight --> M
    API --> P[/metrics<br/>Prometheus/]
```

## Features

| Feature | How |
|---|---|
| **Nearby feed** | `$geoWithin` + `$centerSphere` on a compound `2dsphere` index, newest first |
| **Cursor pagination** | Opaque cursor on `(createdAt, _id)`; no `skip`, so page 50 is as fast as page 1 |
| **Trending feed** | Hot score `(likes+1)/(ageH+2)^1.5`, cached in Redis per **geohash cell** (~5 km) |
| **Cache stampede protection** | Single-flight: concurrent misses on one key share one DB query |
| **Rate limiting** | Redis fixed-window, atomic Lua script, per user; separate read/write budgets; `429` + `Retry-After` |
| **Idempotent likes** | Unique `(postId, userId)` index; retries and double-taps never double-count |
| **Observability** | `/metrics` (latency histogram, cache hit/miss, 429 count), `/api/v1/stats/cache`, `/health` |
| **Resilience** | Cache and limiter **fail open** if Redis is down; graceful shutdown on `SIGTERM` |
| **Validation** | zod schemas on every input; consistent JSON error envelope |

## Quick start

```bash
docker compose up -d --build                                   # mongo + redis + api
docker compose exec api node scripts/seed.js --count 100000 --drop   # ~100k posts across Bengaluru
```

Open **http://localhost:3000** for the web app (map, nearby feed, trending, post, like),
or hit the API directly:

```bash
curl "http://localhost:3000/api/v1/feed/nearby?lat=12.9352&lng=77.6245&radiusKm=5&limit=5"
```

Local without Docker (needs MongoDB and Redis running, or Atlas/Upstash URLs in `.env`):

```bash
cp .env.example .env
npm install
npm run seed -- --count 50000 --drop
npm run dev
```

## Frontend

A dependency-free web client lives in `public/` (vanilla JS + Leaflet/OpenStreetMap):
pick an area or use your location, change the radius, filter by category, scroll the nearby feed
(cursor pagination), switch to Trending to see the Redis **CACHE HIT / MISS** badge and latency,
like posts, and create a post at any point on the map. User content is rendered with `textContent`,
never as HTML.

Locally, Express serves it at `/`. On Vercel, the CDN serves it and the API runs as a function on
the same domain, so no CORS setup is needed.

## Deploy (Vercel + MongoDB Atlas + Upstash Redis, all free tiers)

1. **MongoDB Atlas**: create a free M0 cluster (region: Mumbai `ap-south-1`), a database user, and
   under *Network Access* allow `0.0.0.0/0` (Vercel functions have no fixed IPs).
   Copy the connection string and add a database name:
   `mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/hyperlocal?retryWrites=true&w=majority`
2. **Upstash Redis**: create a free database (region: Mumbai) and copy the **`rediss://`** URL
   (`rediss://default:PASS@xxxx.upstash.io:6379`).
3. **Seed Atlas from your laptop** (this also creates the indexes):
   ```bash
   MONGO_URI="mongodb+srv://...atlas..." node scripts/seed.js --count 30000 --drop
   ```
4. **Vercel**: import the GitHub repo, keep the defaults (`vercel.json` sets everything), and add
   environment variables `MONGO_URI` and `REDIS_URL`. Deploy.
5. Check `https://<your-app>.vercel.app/health` returns `{"status":"ok"}`, then open the site.

How it maps to Vercel: `api/index.js` wraps the same Express app as a serverless function and reuses
Mongo/Redis connections across warm invocations; `vercel.json` rewrites `/api/*`, `/health` and
`/metrics` to it and serves `public/` as static files from the region `bom1` (Mumbai).

Serverless caveats (worth knowing for interviews): each function instance has its own Mongo pool
(kept small via `MONGO_POOL_SIZE`, default 5), single-flight and `/metrics` counters are
per-instance, and cold starts add latency to the first request. For load testing and real
performance numbers, use the Docker setup, not free-tier cloud.

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/feed/nearby?lat&lng&radiusKm=5&category&limit=20&cursor` | radius ≤ 25 km, limit ≤ 50 |
| `GET` | `/api/v1/feed/trending?lat&lng&category` | `X-Cache: HIT \| MISS` header |
| `POST` | `/api/v1/posts` | `{authorId, title, body, category, lat, lng}` |
| `GET` | `/api/v1/posts/:id` | |
| `POST` | `/api/v1/posts/:id/like` | `{userId}`, `201` first time, `200` if already liked |
| `DELETE` | `/api/v1/posts/:id/like` | `{userId}` |
| `GET` | `/api/v1/stats/cache` | hits, misses, coalesced, hitRate |
| `GET` | `/metrics` | Prometheus format |
| `GET` | `/health` | `200` or `503` with per-dependency status |

Categories: `news`, `jobs`, `events`, `classifieds`, `alerts`.

Example response (`/feed/nearby`):

```json
{
  "items": [
    {
      "id": "6712c0...",
      "title": "Power cut 10am-2pm - Koramangala",
      "category": "alerts",
      "likeCount": 14,
      "createdAt": "2026-10-09T08:12:44.000Z",
      "location": { "lat": 12.9361, "lng": 77.6213 },
      "distanceKm": 0.36
    }
  ],
  "nextCursor": "eyJ0IjoiMjAyNi0xMC0wOVQwODoxMjo0NC4wMDBaIiwiaWQiOiI2NzEyYzAuLi4ifQ"
}
```

## Design decisions

**`$geoWithin` instead of `$geoNear`.** A feed is ordered by *time*, not distance. `$geoNear`
forces distance ordering and doesn't combine with a cursor. `$geoWithin` filters by area and lets
the index serve the `createdAt` sort, with distance computed per item afterwards.

**Compound index `{location: 2dsphere, createdAt: -1, _id: -1}`.** The geo filter, the sort and the
cursor tie-breaker are all served from one index. `scripts/explain.js` shows the plan and the
before/after numbers against a forced collection scan.

**Cursor, not offset.** `skip(N)` makes the database walk and discard N documents, so deep pages
get slower and results shift when new posts arrive. The cursor is `(createdAt, _id)` of the last
item; `_id` breaks ties when posts share a timestamp.

**Cache key = geohash cell, not coordinates.** Caching by exact lat/lng gives a near-zero hit rate
because no two users stand on the same spot. Precision-5 geohash cells are ~4.9 km wide, so everyone
in a neighbourhood shares one entry. The query runs around the cell centre; distance is recomputed
for each user on the way out.

**Single-flight.** When a hot key expires, hundreds of concurrent requests miss together and all
hit MongoDB (cache stampede). An in-process promise map makes them wait on one query instead.
*Limitation:* this is per instance; across N instances you still get up to N queries. A Redis lock
or probabilistic early expiry would fix that.

**Fixed-window limiter in Lua.** `INCR` and `EXPIRE` run atomically, so a key can never be left
without a TTL. Being in Redis, the limit holds across all API instances. *Trade-off:* a client can
burst up to 2x at a window boundary; a sliding-window log or token bucket would smooth that.

**Fail open.** If Redis dies, the cache falls through to MongoDB and the limiter lets traffic
pass. For a consumer feed, slower beats down. (For a payment endpoint you'd likely fail closed.)

**Likes.** The unique index makes likes idempotent under retries and concurrent taps. The counter
update is a separate write, so a crash between the two can drift `likeCount`; a periodic
reconciliation job (count from `likes`) or a transaction would close that gap.

## Measuring it (numbers for your write-up)

1. **Query plan, index vs no index**
   ```bash
   docker compose exec api node scripts/explain.js
   ```
   Prints the winning plan (`IXSCAN` vs `COLLSCAN`), docs examined and median time for both.

2. **Load test**
   ```bash
   RATE_LIMIT_MAX=1000000 RATE_LIMIT_WRITE_MAX=1000000 docker compose up -d   # don't rate-limit the load test
   docker compose --profile loadtest run --rm k6                               # or: k6 run loadtest/k6-feed.js
   ```
   Mix: 60% nearby (30% scroll to page 2), 35% trending, 5% writes. Thresholds fail the run if
   p95 goes above budget. Summary is written to `loadtest/summary.json`.

3. **Cache hit rate** after the load test
   ```bash
   curl localhost:3000/api/v1/stats/cache
   ```

4. **Rate limiter**
   ```bash
   for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/api/v1/posts \
     -H 'content-type: application/json' -H 'x-user-id: demo' \
     -d '{"authorId":"demo","title":"spam test","body":"x","category":"news","lat":12.93,"lng":77.62}'; done
   ```
   Expect `201` × 20, then `429`.

### Results

Fill these in from your own runs (machine: ______):

| Metric | Value |
|---|---|
| Posts in collection | |
| Nearby query: indexed vs COLLSCAN (median) | ___ ms vs ___ ms |
| Docs examined: indexed vs COLLSCAN | ___ vs ___ |
| Sustained throughput | ___ req/s |
| p95 nearby / trending | ___ ms / ___ ms |
| Trending cache hit rate | ___ % |

## Tests

```bash
npm test          # unit + integration (integration downloads a MongoDB binary on first run)
npm run test:unit # utils, cache, rate limiter only
```

Integration tests run the real app against an in-memory MongoDB and cover: radius filtering, cursor
pagination with duplicate timestamps (every post exactly once), category filter, query plan uses an
index, trending cache MISS→HIT across users in the same cell, idempotent likes under 10 concurrent
requests, validation errors, health and metrics.

## Project layout

```
api/index.js              Vercel serverless entry (wraps the Express app)
public/                   web frontend (index.html, app.js, styles.css)
vercel.json               rewrites + static output + region
src/
  app.js                  express app factory (deps injected for tests)
  server.js               bootstrap, index creation, graceful shutdown
  config.js  logger.js  metrics.js  validators.js
  db/         mongo.js, redis.js
  models/     Post.js (2dsphere indexes), Like.js (unique index)
  services/   feed.service.js, post.service.js, cache.service.js
  middleware/ rateLimiter.js, validate.js, errorHandler.js
  routes/     feed.routes.js, posts.routes.js
  utils/      geo.js, cursor.js, hotScore.js, httpError.js
scripts/      seed.js, explain.js, areas.js
loadtest/     k6-feed.js
tests/        unit/, integration/
```

## What I'd do next at real scale

- **Fan-out on write for followed localities:** precompute per-cell feeds into Redis sorted sets on write (Kafka consumer) instead of querying on read.
- **Shard MongoDB by geohash prefix** so a city's traffic lands on a few shards.
- **Read replicas** for feed queries; primary only for writes.
- **Sliding-window / token-bucket limiter** and a distributed lock for cross-instance single-flight.
- **Auth** (JWT) so the limiter keys on a verified user, not a header.
