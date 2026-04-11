const SOSEvent   = require('../models/SOSEvent');
const User       = require('../models/User');
const Hospital   = require('../models/Hospital');
const {
  findNearbyInDB,
  findNearbyViaGooglePlaces,
  reverseGeocode,
  haversineDistance
}                = require('./hospitalFinderService');
const { notifyHospital, notifyEmergencyContacts } = require('./notificationService');
const logger     = require('../utils/logger');

const SOS_EXPIRY_MS = (Number(process.env.SOS_EXPIRY_MINUTES) || 60) * 60 * 1000;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * triggerSOS
 * ─────────────────────────────────────────────────────────────────────────────
 * Called the instant a user taps the SOS button.
 *
 * Flow:
 *  1. Validate: user has no other active SOS.
 *  2. Create SOSEvent document immediately (so we have an ID to work with).
 *  3. Reverse-geocode the coordinates in the background.
 *  4. Find nearby hospitals (DB first, Google Places fallback).
 *  5. Fire notifications to all found hospitals simultaneously.
 *  6. Notify user's personal emergency contacts.
 *  7. Emit a Socket.io event to each connected hospital.
 *  8. Return the event + list of alerted hospitals to the caller.
 *
 * @param {string}   userId
 * @param {number[]} coordinates  [lng, lat]
 * @param {Object}   io           Socket.io server instance
 * @returns {Object} { sosEvent, alertedHospitals }
 */
const triggerSOS = async (userId, coordinates, io) => {
  // ── 1. Block duplicate active SOS ──────────────────────────────────────────
  const existing = await SOSEvent.findOne({ user: userId, status: 'active' });
  if (existing) {
    logger.warn(`User ${userId} already has an active SOS: ${existing._id}`);
    return { sosEvent: existing, alertedHospitals: [], duplicate: true };
  }

  // ── 2. Fetch user + create event ───────────────────────────────────────────
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const expiresAt = new Date(Date.now() + SOS_EXPIRY_MS);

  const sosEvent = await SOSEvent.create({
    user:     userId,
    location: { type: 'Point', coordinates },
    status:   'active',
    expiresAt,
    medicalSnapshot: {
      bloodGroup:         user.bloodGroup,
      allergies:          user.allergies,
      medicalConditions:  user.medicalConditions,
      currentMedications: user.currentMedications
    }
  });

  logger.info(`SOS event created: ${sosEvent._id} for user ${userId}`);

  // ── 3. Reverse geocode (non-blocking) ──────────────────────────────────────
  reverseGeocode(coordinates)
    .then(address => {
      if (address) {
        SOSEvent.findByIdAndUpdate(sosEvent._id, { address }).exec();
        sosEvent.address = address;
      }
    })
    .catch(() => {});

  // ── 4. Find nearby hospitals ───────────────────────────────────────────────
  let hospitals = await findNearbyInDB(coordinates);

  if (hospitals.length === 0) {
    logger.info('No registered hospitals found in DB — trying Google Places');
    const googleResults = await findNearbyViaGooglePlaces(coordinates);
    // Google results lack phone/email so we can only log, not SMS/email them
    hospitals = googleResults;
  }

  if (hospitals.length === 0) {
    logger.warn(`No hospitals found near [${coordinates}] — SOS still saved`);
  }

  // ── 5 & 6. Notify hospitals + emergency contacts in parallel ───────────────
  const alertedHospitals = [];
  const notificationDocs = [];

  const hospitalPromises = hospitals
    .filter(h => h.phone || h.email) // skip Google results with no contact
    .map(async hospital => {
      const distM = haversineDistance(coordinates, hospital.location.coordinates);

      try {
        await notifyHospital(hospital, sosEvent, user, distM);

        notificationDocs.push({
          hospital:       hospital._id,
          distanceMeters: Math.round(distM),
          notifiedAt:     new Date()
        });

        alertedHospitals.push({
          id:             hospital._id,
          name:           hospital.name,
          phone:          hospital.phone,
          address:        hospital.address,
          distanceMeters: Math.round(distM),
          location:       hospital.location
        });

        // ── 7. Real-time socket push ─────────────────────────────────────────
        if (io && hospital.socketId) {
          io.to(hospital.socketId).emit('sos:incoming', {
            sosEventId:    sosEvent._id.toString(),
            user: {
              name:  user.name,
              phone: user.phone,
              medicalSnapshot: sosEvent.medicalSnapshot
            },
            coordinates,
            address:        sosEvent.address,
            distanceMeters: Math.round(distM),
            timestamp:      sosEvent.createdAt
          });
          logger.info(`Socket event sent to hospital ${hospital.name} (${hospital.socketId})`);
        }
      } catch (err) {
        logger.error(`Failed to notify hospital ${hospital.name}: ${err.message}`);
      }
    });

  const contactPromise = user.emergencyContacts?.length
    ? notifyEmergencyContacts(user.emergencyContacts, user, sosEvent)
    : Promise.resolve();

  await Promise.allSettled([...hospitalPromises, contactPromise]);

  // ── Persist notification records ───────────────────────────────────────────
  if (notificationDocs.length > 0) {
    await SOSEvent.findByIdAndUpdate(sosEvent._id, {
      $push: { notifications: { $each: notificationDocs } }
    });
  }

  logger.info(
    `SOS ${sosEvent._id} — alerted ${alertedHospitals.length} hospital(s) + emergency contacts`
  );

  return { sosEvent, alertedHospitals };
};

/**
 * Hospital acknowledges they received the SOS.
 */
const acknowledgeSOSByHospital = async (sosEventId, hospitalId) => {
  const event = await SOSEvent.findOneAndUpdate(
    { _id: sosEventId, 'notifications.hospital': hospitalId },
    {
      $set: {
        status:                          'acknowledged',
        'notifications.$.acknowledged':  true,
        'notifications.$.acknowledgedAt': new Date()
      }
    },
    { new: true }
  );
  return event;
};

/**
 * Hospital accepts and will respond to the SOS.
 */
const acceptSOSByHospital = async (sosEventId, hospitalId, io) => {
  const event = await SOSEvent.findOneAndUpdate(
    { _id: sosEventId, 'notifications.hospital': hospitalId },
    {
      $set: {
        respondingHospital:            hospitalId,
        'notifications.$.accepted':    true,
        'notifications.$.acceptedAt':  new Date()
      }
    },
    { new: true }
  ).populate('user', 'name phone');

  // Notify patient in real-time that a hospital is coming
  if (io && event) {
    const hospital = await Hospital.findById(hospitalId).select('name phone address location');
    io.to(`user:${event.user._id}`).emit('sos:hospital_responding', {
      sosEventId,
      hospital: {
        name:     hospital.name,
        phone:    hospital.phone,
        address:  hospital.address,
        location: hospital.location
      }
    });
  }

  return event;
};

/**
 * Hospital declines the SOS.
 */
const declineSOSByHospital = async (sosEventId, hospitalId, reason = '') => {
  return SOSEvent.findOneAndUpdate(
    { _id: sosEventId, 'notifications.hospital': hospitalId },
    {
      $set: {
        'notifications.$.declined':      true,
        'notifications.$.declinedAt':    new Date(),
        'notifications.$.declineReason': reason
      }
    },
    { new: true }
  );
};

/**
 * User cancels their own SOS.
 */
const cancelSOS = async (sosEventId, userId, io) => {
  const event = await SOSEvent.findOneAndUpdate(
    { _id: sosEventId, user: userId, status: { $in: ['active', 'acknowledged'] } },
    { status: 'cancelled', cancelledAt: new Date() },
    { new: true }
  ).populate('notifications.hospital', 'socketId name');

  if (event && io) {
    event.notifications.forEach(n => {
      if (n.hospital?.socketId) {
        io.to(n.hospital.socketId).emit('sos:cancelled', { sosEventId });
      }
    });
  }

  return event;
};

/**
 * Mark SOS as resolved (patient confirmed safe / arrived at hospital).
 */
const resolveSOS = async (sosEventId, userId) => {
  return SOSEvent.findOneAndUpdate(
    { _id: sosEventId, user: userId },
    { status: 'resolved', resolvedAt: new Date() },
    { new: true }
  );
};

/**
 * Get current status of an SOS event (for patient polling).
 */
const getSOSStatus = async (sosEventId, userId) => {
  return SOSEvent.findOne({ _id: sosEventId, user: userId })
    .populate('respondingHospital', 'name phone address location')
    .populate('notifications.hospital', 'name phone address');
};

module.exports = {
  triggerSOS,
  acknowledgeSOSByHospital,
  acceptSOSByHospital,
  declineSOSByHospital,
  cancelSOS,
  resolveSOS,
  getSOSStatus
};
