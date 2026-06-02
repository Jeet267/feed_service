const { Schema, model } = require('mongoose');

const likeSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    userId: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// The unique index is what makes "like" idempotent: a second like by the
// same user fails with a duplicate-key error instead of double counting.
likeSchema.index({ postId: 1, userId: 1 }, { unique: true, name: 'post_user_unique' });

module.exports = model('Like', likeSchema);
