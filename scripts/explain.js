#!/usr/bin/env node
/**
 * Shows how the nearby-feed query executes, WITH the geo index and WITHOUT it
 * (forced collection scan), so you can quote real before/after numbers.
 *
 *   node scripts/explain.js            # compare both
 *   node scripts/explain.js --lat 12.97 --lng 77.64 --radius 3
 */
const config = require('../src/config');
const { connectMongo, mongoose } = require('../src/db/mongo');
const Post = require('../src/models/Post');
const { withinRadiusFilter } = require('../src/utils/geo');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const lat = arg('--lat', 12.9352);
const lng = arg('--lng', 77.6245);
const radiusKm = arg('--radius', 5);
const RUNS = 5;

function summarize(raw) {
  const e = Array.isArray(raw) ? raw[0] : raw;
  const s = e.executionStats;
  const stages = [];
  let node = e.queryPlanner.winningPlan;
  while (node) {
    stages.push(node.stage + (node.indexName ? `(${node.indexName})` : ''));
    node = node.inputStage || (node.inputStages && node.inputStages[0]);
  }
  return {
    plan: stages.join(' <- '),
    nReturned: s.nReturned,
    keysExamined: s.totalKeysExamined,
    docsExamined: s.totalDocsExamined,
    timeMs: s.executionTimeMillis,
  };
}

async function run(label, hint) {
  const results = [];
  for (let i = 0; i < RUNS; i += 1) {
    let q = Post.find(withinRadiusFilter(lat, lng, radiusKm)).sort({ createdAt: -1, _id: -1 }).limit(21);
    if (hint) q = q.hint(hint);
    results.push(summarize(await q.explain('executionStats')));
  }
  const times = results.map((r) => r.timeMs).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`\n=== ${label} ===`);
  console.log({ ...results[0], timeMs: undefined, medianTimeMs: median, runs: RUNS });
  return median;
}

async function main() {
  await connectMongo(config.mongoUri);
  const total = await Post.estimatedDocumentCount();
  console.log(`Collection size: ${total} posts | query: ${radiusKm}km around (${lat}, ${lng})`);

  const withIndex = await run('WITH 2dsphere index (geo_recent)', 'geo_recent');
  const withoutIndex = await run('WITHOUT index (collection scan)', { $natural: 1 });

  console.log(`\nSpeed-up: ${(withoutIndex / Math.max(withIndex, 1)).toFixed(1)}x`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
