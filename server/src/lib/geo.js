/**
 * Location privacy helpers.
 *
 * Crushly never stores or returns exact coordinates. Incoming coordinates are
 * snapped to a ~1.1 km grid before they touch the database, and the API only
 * ever returns a coarse, human label ("Under 1 km", "4 km", "15 km away").
 */

export function snapCoordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function distanceKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some((v) => v == null)) return null;
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Coarse label. Precision deliberately decreases with distance to prevent trilateration. */
export function distanceLabel(km) {
  if (km == null) return null;
  if (km < 2) return 'Under 2 km';
  if (km < 10) return `${Math.round(km)} km`;
  if (km < 50) return `${Math.round(km / 5) * 5} km`;
  if (km < 200) return `${Math.round(km / 25) * 25} km`;
  return 'Far away';
}
