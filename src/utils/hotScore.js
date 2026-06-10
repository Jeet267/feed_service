// Hacker-News style "hot" score: engagement decays with age.
//   score = (likes + 1) / (ageHours + 2) ^ gravity
// Higher gravity = older posts fall off faster.
function hotScore(likeCount, createdAt, now = Date.now(), gravity = 1.5) {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3.6e6);
  return (likeCount + 1) / Math.pow(ageHours + 2, gravity);
}

module.exports = { hotScore };
