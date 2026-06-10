const { z } = require('zod');
const config = require('./config');
const { CATEGORIES } = require('./models/Post');

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a valid id');

const nearbyQuery = z.object({
  lat,
  lng,
  radiusKm: z.coerce.number().positive().max(config.feed.maxRadiusKm).default(config.feed.defaultRadiusKm),
  category: z.enum(CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(config.feed.maxLimit).default(config.feed.defaultLimit),
  cursor: z.string().max(200).optional(),
});

const trendingQuery = z.object({
  lat,
  lng,
  category: z.enum(CATEGORIES).optional(),
});

const createPostBody = z.object({
  authorId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(2000),
  category: z.enum(CATEGORIES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const idParams = z.object({ id: objectId });
const likeBody = z.object({ userId: z.string().trim().min(1).max(64) });

module.exports = { nearbyQuery, trendingQuery, createPostBody, idParams, likeBody };
