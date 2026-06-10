// MongoDB's $centerSphere expects the radius in radians, using the
// equatorial radius of the Earth (6378.1 km) per the MongoDB docs.
const EARTH_RADIUS_KM = 6378.1;

const toRad = (deg) => (deg * Math.PI) / 180;

function kmToRadians(km) {
  return km / EARTH_RADIUS_KM;
}

// Great-circle distance between two lat/lng points, in km.
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function withinRadiusFilter(lat, lng, radiusKm) {
  return {
    location: {
      $geoWithin: { $centerSphere: [[lng, lat], kmToRadians(radiusKm)] },
    },
  };
}

module.exports = { EARTH_RADIUS_KM, kmToRadians, haversineKm, withinRadiusFilter };
