const { body, validationResult } = require('express-validator');
const sosService = require('../services/sosService');
const logger     = require('../utils/logger');

// Validation rules
const triggerValidation = [
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required')
];

/**
 * POST /api/sos/trigger
 * Authenticated user taps the SOS button.
 */
const trigger = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { latitude, longitude } = req.body;
  const coordinates = [parseFloat(longitude), parseFloat(latitude)]; // GeoJSON: [lng, lat]
  const io          = req.app.get('io');

  try {
    const { sosEvent, alertedHospitals, duplicate } = await sosService.triggerSOS(
      req.user.id,
      coordinates,
      io
    );

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message:  'You already have an active SOS event',
        sosEventId: sosEvent._id
      });
    }

    return res.status(201).json({
      success:          true,
      message:          `SOS triggered — ${alertedHospitals.length} hospital(s) alerted`,
      sosEventId:       sosEvent._id,
      alertedHospitals: alertedHospitals.map(h => ({
        name:           h.name,
        phone:          h.phone,
        address:        h.address,
        distanceMeters: h.distanceMeters
      }))
    });
  } catch (err) {
    logger.error(`SOS trigger error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Failed to trigger SOS' });
  }
};

/**
 * GET /api/sos/:id/status
 * Patient polls for status updates (which hospital is responding).
 */
const getStatus = async (req, res) => {
  try {
    const event = await sosService.getSOSStatus(req.params.id, req.user.id);
    if (!event) return res.status(404).json({ success: false, message: 'SOS event not found' });

    return res.json({
      success: true,
      data: {
        id:                 event._id,
        status:             event.status,
        address:            event.address,
        respondingHospital: event.respondingHospital,
        notifications:      event.notifications.map(n => ({
          hospital:      n.hospital,
          acknowledged:  n.acknowledged,
          accepted:      n.accepted,
          declined:      n.declined,
          distanceMeters:n.distanceMeters
        })),
        createdAt: event.createdAt,
        expiresAt: event.expiresAt
      }
    });
  } catch (err) {
    logger.error(`Get SOS status error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/sos/:id/cancel
 * Patient cancels their SOS.
 */
const cancel = async (req, res) => {
  try {
    const io    = req.app.get('io');
    const event = await sosService.cancelSOS(req.params.id, req.user.id, io);
    if (!event) return res.status(404).json({ success: false, message: 'SOS not found or already resolved' });
    return res.json({ success: true, message: 'SOS cancelled' });
  } catch (err) {
    logger.error(`Cancel SOS error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/sos/:id/resolve
 * Patient marks themselves as safe.
 */
const resolve = async (req, res) => {
  try {
    const event = await sosService.resolveSOS(req.params.id, req.user.id);
    if (!event) return res.status(404).json({ success: false, message: 'SOS not found' });
    return res.json({ success: true, message: 'SOS resolved' });
  } catch (err) {
    logger.error(`Resolve SOS error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/sos/:id/hospital/acknowledge
 * Hospital confirms they received the alert.
 */
const hospitalAcknowledge = async (req, res) => {
  try {
    const event = await sosService.acknowledgeSOSByHospital(req.params.id, req.hospital.id);
    if (!event) return res.status(404).json({ success: false, message: 'SOS not found' });
    return res.json({ success: true, message: 'Alert acknowledged' });
  } catch (err) {
    logger.error(`Hospital acknowledge error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/sos/:id/hospital/accept
 * Hospital confirms they are dispatching help.
 */
const hospitalAccept = async (req, res) => {
  try {
    const io    = req.app.get('io');
    const event = await sosService.acceptSOSByHospital(req.params.id, req.hospital.id, io);
    if (!event) return res.status(404).json({ success: false, message: 'SOS not found' });
    return res.json({ success: true, message: 'Response accepted — patient notified' });
  } catch (err) {
    logger.error(`Hospital accept error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/sos/:id/hospital/decline
 * Hospital cannot respond to this alert.
 */
const hospitalDecline = async (req, res) => {
  try {
    const event = await sosService.declineSOSByHospital(
      req.params.id,
      req.hospital.id,
      req.body.reason || ''
    );
    if (!event) return res.status(404).json({ success: false, message: 'SOS not found' });
    return res.json({ success: true, message: 'Response declined' });
  } catch (err) {
    logger.error(`Hospital decline error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  trigger,
  triggerValidation,
  getStatus,
  cancel,
  resolve,
  hospitalAcknowledge,
  hospitalAccept,
  hospitalDecline
};
