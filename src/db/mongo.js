const mongoose = require('mongoose');
const logger = require('../logger');

// Indexes are created explicitly (server.js / seed.js) instead of letting
// Mongoose build them lazily in the background on first use.
mongoose.set('autoIndex', false);
mongoose.set('strictQuery', true);

async function connectMongo(uri, { maxPoolSize = 50 } = {}) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  await mongoose.connect(uri, {
    maxPoolSize,
    serverSelectionTimeoutMS: 5000,
  });
  logger.info('MongoDB connected');
  return mongoose.connection;
}

function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connectMongo, isMongoReady, mongoose };
