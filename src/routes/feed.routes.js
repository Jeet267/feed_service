const { Router } = require('express');
const { validate, asyncHandler } = require('../middleware/validate');
const { nearbyQuery, trendingQuery } = require('../validators');

function feedRouter(feedService) {
  const router = Router();

  // GET /api/v1/feed/nearby?lat=12.93&lng=77.62&radiusKm=5&category=news&limit=20&cursor=...
  router.get('/nearby', validate(nearbyQuery), asyncHandler(async (req, res) => {
    const result = await feedService.getNearbyFeed(req.valid.query);
    res.json(result);
  }));

  // GET /api/v1/feed/trending?lat=12.93&lng=77.62&category=events
  router.get('/trending', validate(trendingQuery), asyncHandler(async (req, res) => {
    const result = await feedService.getTrending(req.valid.query);
    res.set('X-Cache', result.cache);
    res.json(result);
  }));

  return router;
}

module.exports = feedRouter;
