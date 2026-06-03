const ngeohash = require('ngeohash');
const { Types } = require('mongoose');
const Post = require('../models/Post');
const config = require('../config');
const { haversineKm, withinRadiusFilter } = require('../utils/geo');
const { encodeCursor, decodeCursor } = require('../utils/cursor');
const { hotScore } = require('../utils/hotScore');

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function toDto(post, userLat, userLng) {
  const [lng, lat] = post.location.coordinates;
  return {
    id: String(post._id),
    authorId: post.authorId,
    title: post.title,
    body: post.body,
    category: post.category,
    likeCount: post.likeCount,
    createdAt: new Date(post.createdAt).toISOString(),
    location: { lat, lng },
    distanceKm: round(haversineKm(userLat, userLng, lat, lng)),
  };
}

function createFeedService({ cache, trendingConfig = config.trending }) {
  /**
   * Newest posts within radiusKm of (lat, lng), cursor-paginated.
   * $geoWithin (not $geoNear) is used because the feed is ordered by time,
   * not by distance, and $geoWithin can be combined with sort + cursor.
   */
  async function getNearbyFeed({ lat, lng, radiusKm, category, limit, cursor }) {
    const filter = withinRadiusFilter(lat, lng, radiusKm);
    if (category) filter.category = category;

    if (cursor) {
      const c = decodeCursor(cursor);
      const oid = new Types.ObjectId(c.id);
      filter.$or = [
        { createdAt: { $lt: c.createdAt } },
        { createdAt: c.createdAt, _id: { $lt: oid } },
      ];
    }

    const docs = await Post.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1) // fetch one extra to know if another page exists
      .lean();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;

    return {
      items: page.map((p) => toDto(p, lat, lng)),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  /**
   * Trending posts around the user's geohash cell.
   * The cache key is the CELL, not the exact coordinates, so thousands of
   * users in the same ~5km cell share one cached result. The query is run
   * around the cell centre, and distance is recomputed per user afterwards.
   */
  async function getTrending({ lat, lng, category }) {
    const cell = ngeohash.encode(lat, lng, trendingConfig.geohashPrecision);
    const key = `trending:v1:${cell}:${category || 'all'}`;

    const { value, hit } = await cache.getOrSet(key, trendingConfig.cacheTtlSec, async () => {
      const center = ngeohash.decode(cell);
      const filter = withinRadiusFilter(center.latitude, center.longitude, trendingConfig.radiusKm);
      filter.createdAt = { $gte: new Date(Date.now() - trendingConfig.windowHours * 3.6e6) };
      if (category) filter.category = category;

      const candidates = await Post.find(filter)
        .sort({ likeCount: -1 })
        .limit(trendingConfig.candidateLimit)
        .lean();

      const now = Date.now();
      return candidates
        .map((p) => ({
          _id: String(p._id),
          authorId: p.authorId,
          title: p.title,
          body: p.body,
          category: p.category,
          likeCount: p.likeCount,
          createdAt: p.createdAt,
          location: p.location,
          score: hotScore(p.likeCount, p.createdAt, now),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, trendingConfig.size);
    });

    return {
      cell,
      cache: hit ? 'HIT' : 'MISS',
      items: value.map((p) => ({ ...toDto(p, lat, lng), score: round(p.score, 4) })),
    };
  }

  return { getNearbyFeed, getTrending };
}

module.exports = { createFeedService, toDto };
