const { haversineKm, kmToRadians, EARTH_RADIUS_KM } = require('../../src/utils/geo');
const { encodeCursor, decodeCursor } = require('../../src/utils/cursor');
const { hotScore } = require('../../src/utils/hotScore');
const HttpError = require('../../src/utils/httpError');

describe('geo utils', () => {
  test('haversine: Koramangala -> Indiranagar is ~5km', () => {
    const d = haversineKm(12.9352, 77.6245, 12.9784, 77.6408);
    expect(d).toBeGreaterThan(4.5);
    expect(d).toBeLessThan(5.5);
  });

  test('haversine of same point is 0', () => {
    expect(haversineKm(12.9, 77.6, 12.9, 77.6)).toBe(0);
  });

  test('kmToRadians uses earth radius', () => {
    expect(kmToRadians(EARTH_RADIUS_KM)).toBeCloseTo(1);
  });
});

describe('cursor', () => {
  const doc = { _id: '64b7f0c2a1b2c3d4e5f60718', createdAt: new Date('2026-10-01T10:00:00Z') };

  test('round-trips', () => {
    const decoded = decodeCursor(encodeCursor(doc));
    expect(decoded.id).toBe(doc._id);
    expect(decoded.createdAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  test('rejects garbage with 400', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(HttpError);
    try { decodeCursor('abc'); } catch (e) { expect(e.status).toBe(400); }
  });

  test('rejects tampered id', () => {
    const bad = Buffer.from(JSON.stringify({ t: new Date().toISOString(), id: 'x' })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow('Invalid cursor');
  });
});

describe('hotScore', () => {
  const now = Date.now();
  test('more likes = higher score at same age', () => {
    expect(hotScore(50, now - 3.6e6, now)).toBeGreaterThan(hotScore(5, now - 3.6e6, now));
  });
  test('newer post beats older post with same likes', () => {
    expect(hotScore(10, now - 3.6e6, now)).toBeGreaterThan(hotScore(10, now - 24 * 3.6e6, now));
  });
});
