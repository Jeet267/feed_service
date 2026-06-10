const HttpError = require('./httpError');

// Opaque cursor = base64url(JSON{ t: createdAt, id: _id }) of the last item.
// Using (createdAt, _id) as a tie-breaker keeps pagination stable even when
// many posts share the same timestamp, and unlike skip/offset it never
// re-scans the pages already served.

function encodeCursor(doc) {
  const payload = { t: new Date(doc.createdAt).toISOString(), id: String(doc._id) };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const { t, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const createdAt = new Date(t);
    if (Number.isNaN(createdAt.getTime()) || !/^[a-f0-9]{24}$/i.test(id)) {
      throw new Error('bad cursor');
    }
    return { createdAt, id };
  } catch {
    throw new HttpError(400, 'Invalid cursor', 'INVALID_CURSOR');
  }
}

module.exports = { encodeCursor, decodeCursor };
