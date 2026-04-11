const axios    = require('axios');
const Hospital = require('../models/Hospital');
const logger   = require('../utils/logger');

const RADIUS_M      = Number(process.env.SOS_SEARCH_RADIUS_METERS) || 5000;
const MAX_HOSPITALS = Number(process.env.SOS_MAX_HOSPITALS_ALERT)  || 5;

/**
 * Find hospitals near a coordinate from our own MongoDB.
 * Uses MongoDB $nearSphere (2dsphere index) for fast geospatial lookup.
 *
 * @param {number[]} coordinates  [lng, lat]
 * @param {number}   radiusMeters
 * @param {number}   limit
 * @returns {Array} sorted by distance ascending
 */
const findNearbyInDB = async (coordinates, radiusMeters = RADIUS_M, limit = MAX_HOSPITALS) => {
  const hospitals = await Hospital.find({
    isActive:     true,
    isVerified:   true,
    hasEmergency: true,
    location: {
      $nearSphere: {
        $geometry:    { type: 'Point', coordinates },
        $maxDistance: radiusMeters
      }
    }
  })
    .limit(limit)
    .select('-__v -socketId');

  return hospitals;
};

/**
 * Fall back to Google Places Nearby Search when our DB has no results
 * (e.g. new area, sparse registrations).
 * Returns a lightweight list — these are NOT full Hospital documents.
 *
 * @param {number[]} coordinates [lng, lat]
 * @param {number}   radiusMeters
 * @returns {Array} Google Places results shaped like { name, phone, address, location }
 */
const findNearbyViaGooglePlaces = async (coordinates, radiusMeters = RADIUS_M) => {
  const [lng, lat] = coordinates;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    logger.warn('GOOGLE_MAPS_API_KEY not set — skipping Places fallback');
    return [];
  }

  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
      {
        params: {
          location: `${lat},${lng}`,
          radius:   radiusMeters,
          type:     'hospital',
          key:      apiKey
        }
      }
    );

    if (data.status !== 'OK') {
      logger.warn(`Google Places returned status: ${data.status}`);
      return [];
    }

    return data.results.slice(0, MAX_HOSPITALS).map(p => ({
      name:      p.name,
      address:   p.vicinity,
      googlePlaceId: p.place_id,
      location: {
        type:        'Point',
        coordinates: [p.geometry.location.lng, p.geometry.location.lat]
      },
      rating: p.rating || 0,
      // No direct phone from Nearby Search; would need Place Details call
      phone: null,
      email: null,
      fromGoogle: true
    }));
  } catch (err) {
    logger.error(`Google Places API error: ${err.message}`);
    return [];
  }
};

/**
 * Reverse-geocode coordinates to a human-readable address.
 *
 * @param {number[]} coordinates [lng, lat]
 * @returns {string}
 */
const reverseGeocode = async (coordinates) => {
  const [lng, lat] = coordinates;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) return '';

  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { params: { latlng: `${lat},${lng}`, key: apiKey } }
    );
    if (data.status === 'OK' && data.results.length > 0) {
      return data.results[0].formatted_address;
    }
  } catch (err) {
    logger.warn(`Reverse geocode failed: ${err.message}`);
  }
  return '';
};

/**
 * Calculate straight-line distance in metres between two [lng,lat] pairs.
 */
const haversineDistance = ([lng1, lat1], [lng2, lat2]) => {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

module.exports = {
  findNearbyInDB,
  findNearbyViaGooglePlaces,
  reverseGeocode,
  haversineDistance,
  RADIUS_M,
  MAX_HOSPITALS
};
