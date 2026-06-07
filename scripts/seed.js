#!/usr/bin/env node
/**
 * Seeds realistic hyperlocal posts clustered around Bengaluru neighbourhoods.
 *
 *   node scripts/seed.js --count 100000 --drop
 */
const config = require('../src/config');
const { connectMongo, mongoose } = require('../src/db/mongo');
const Post = require('../src/models/Post');
const Like = require('../src/models/Like');
const AREAS = require('./areas');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const COUNT = parseInt(argValue('--count', '50000'), 10);
const DROP = args.includes('--drop');
const BATCH = 2000;

const TITLES = {
  news: ['Road repair work starts', 'Metro line update', 'Water supply timing changed', 'New park opens', 'Ward meeting this week'],
  jobs: ['Delivery partners needed', 'Hiring cashier', 'Part-time tutor wanted', 'Store helper required', 'Cook needed for PG'],
  events: ['Weekend flea market', 'Free yoga session', 'Ganesh pandal cultural night', 'Book swap meetup', 'Cricket tournament'],
  classifieds: ['Second-hand cycle for sale', '2BHK available for rent', 'Study table for sale', 'Selling old fridge', 'Room for rent near metro'],
  alerts: ['Power cut 10am-2pm', 'Heavy traffic near junction', 'Waterlogging reported', 'Lost dog, please help', 'Road closed for event'],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Box-Muller: normally distributed offset so posts cluster near the centre.
function gaussian() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomPost() {
  const area = pick(AREAS);
  const spreadKm = 2.5;
  const lat = area.lat + (gaussian() * spreadKm) / 111;
  const lng = area.lng + (gaussian() * spreadKm) / (111 * Math.cos((area.lat * Math.PI) / 180));
  const category = pick(Post.CATEGORIES);
  const createdAt = new Date(Date.now() - Math.random() * 7 * 24 * 3.6e6);
  return {
    authorId: `user-${Math.floor(Math.random() * 20000)}`,
    title: `${pick(TITLES[category])} - ${area.name}`,
    body: `Posted for residents of ${area.name}. Contact through the app for details.`,
    category,
    location: { type: 'Point', coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] },
    // Long-tail engagement: most posts get few likes, a few get many.
    likeCount: Math.floor(Math.pow(Math.random(), 4) * 500),
    createdAt,
    updatedAt: createdAt,
  };
}

async function main() {
  await connectMongo(config.mongoUri);
  if (DROP) {
    await Promise.all([Post.deleteMany({}), Like.deleteMany({})]);
    console.log('Cleared posts and likes');
  }
  await Promise.all([Post.createIndexes(), Like.createIndexes()]);

  const started = Date.now();
  for (let done = 0; done < COUNT; done += BATCH) {
    const size = Math.min(BATCH, COUNT - done);
    const docs = Array.from({ length: size }, randomPost);
    // Raw driver insert: skips Mongoose timestamps so createdAt stays spread over 7 days.
    await Post.collection.insertMany(docs, { ordered: false });
    process.stdout.write(`\rInserted ${done + size}/${COUNT}`);
  }
  console.log(`\nSeeded ${COUNT} posts in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
