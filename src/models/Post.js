const { Schema, model } = require('mongoose');

const CATEGORIES = ['news', 'jobs', 'events', 'classifieds', 'alerts'];

const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    // GeoJSON order is [longitude, latitude]
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (c) => c.length === 2 && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90,
        message: 'coordinates must be [lng, lat]',
      },
    },
  },
  { _id: false },
);

const postSchema = new Schema(
  {
    authorId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    category: { type: String, enum: CATEGORIES, required: true },
    location: { type: pointSchema, required: true },
    likeCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

// Nearby feed: geo filter + newest-first sort + cursor on (createdAt, _id).
postSchema.index({ location: '2dsphere', createdAt: -1, _id: -1 }, { name: 'geo_recent' });
// Nearby feed filtered by category.
postSchema.index({ location: '2dsphere', category: 1, createdAt: -1 }, { name: 'geo_category_recent' });
postSchema.index({ authorId: 1, createdAt: -1 }, { name: 'author_recent' });

module.exports = model('Post', postSchema);
module.exports.CATEGORIES = CATEGORIES;
