const { Router } = require('express');
const { validate, asyncHandler } = require('../middleware/validate');
const { createPostBody, idParams, likeBody } = require('../validators');
const postService = require('../services/post.service');
const { toDto } = require('../services/feed.service');

function postsRouter({ readLimiter, writeLimiter }) {
  const router = Router();

  router.post('/', writeLimiter, validate(createPostBody, 'body'), asyncHandler(async (req, res) => {
    const post = await postService.createPost(req.valid.body);
    const { lat, lng } = req.valid.body;
    res.status(201).location(`/api/v1/posts/${post._id}`).json(toDto(post, lat, lng));
  }));

  router.get('/:id', readLimiter, validate(idParams, 'params'), asyncHandler(async (req, res) => {
    const post = await postService.getPost(req.valid.params.id);
    const [lng, lat] = post.location.coordinates;
    res.json(toDto(post, lat, lng));
  }));

  router.post('/:id/like', writeLimiter, validate(idParams, 'params'), validate(likeBody, 'body'),
    asyncHandler(async (req, res) => {
      const result = await postService.likePost(req.valid.params.id, req.valid.body.userId);
      res.status(result.changed ? 201 : 200).json(result);
    }));

  router.delete('/:id/like', writeLimiter, validate(idParams, 'params'), validate(likeBody, 'body'),
    asyncHandler(async (req, res) => {
      const result = await postService.unlikePost(req.valid.params.id, req.valid.body.userId);
      res.json(result);
    }));

  return router;
}

module.exports = postsRouter;
