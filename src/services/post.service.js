const Post = require('../models/Post');
const Like = require('../models/Like');
const HttpError = require('../utils/httpError');

async function createPost({ authorId, title, body, category, lat, lng }) {
  const post = await Post.create({
    authorId,
    title,
    body,
    category,
    location: { type: 'Point', coordinates: [lng, lat] },
  });
  return post.toObject();
}

async function getPost(id) {
  const post = await Post.findById(id).lean();
  if (!post) throw new HttpError(404, 'Post not found');
  return post;
}

/**
 * Idempotent like. The unique (postId, userId) index guarantees one like per
 * user; a retry or double-tap returns 200 without incrementing again.
 */
async function likePost(postId, userId) {
  if (!(await Post.exists({ _id: postId }))) throw new HttpError(404, 'Post not found');

  try {
    await Like.create({ postId, userId });
  } catch (err) {
    if (err.code === 11000) return { liked: true, changed: false };
    throw err;
  }
  await Post.updateOne({ _id: postId }, { $inc: { likeCount: 1 } });
  return { liked: true, changed: true };
}

async function unlikePost(postId, userId) {
  if (!(await Post.exists({ _id: postId }))) throw new HttpError(404, 'Post not found');

  const { deletedCount } = await Like.deleteOne({ postId, userId });
  if (deletedCount === 1) {
    await Post.updateOne({ _id: postId, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
  }
  return { liked: false, changed: deletedCount === 1 };
}

module.exports = { createPost, getPost, likePost, unlikePost };
