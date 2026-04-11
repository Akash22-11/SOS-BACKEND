const jwt      = require('jsonwebtoken');
const Hospital = require('../models/Hospital');
const User     = require('../models/User');
const logger   = require('../utils/logger');

/**
 * Set up Socket.io event handlers.
 *
 * Hospitals connect here after login to:
 *   - Register their socketId so we can push SOS alerts to them in real-time
 *   - Join a room named "hospital:<id>" for targeted pushes
 *
 * Patients connect here to:
 *   - Join a room named "user:<id>" to receive hospital-response notifications
 */
const initSocket = (io) => {
  io.use(async (socket, next) => {
    // Authenticate socket connection via token in handshake
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.role = decoded.role;
      socket.entityId = decoded.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const { role, entityId } = socket;
    logger.info(`Socket connected: ${role} ${entityId} (${socket.id})`);

    if (role === 'hospital') {
      // Store socketId on hospital document for targeted pushes
      await Hospital.findByIdAndUpdate(entityId, { socketId: socket.id });
      socket.join(`hospital:${entityId}`);

      socket.on('disconnect', async () => {
        await Hospital.findByIdAndUpdate(entityId, { socketId: null });
        logger.info(`Hospital ${entityId} disconnected`);
      });
    }

    if (role === 'user') {
      socket.join(`user:${entityId}`);

      socket.on('disconnect', () => {
        logger.info(`User ${entityId} disconnected`);
      });
    }

    // Hospital can send a live ETA update back to patient
    socket.on('hospital:eta_update', ({ sosEventId, etaMinutes }) => {
      if (role !== 'hospital') return;
      io.to(`user:${entityId}`).emit('sos:eta_update', { sosEventId, etaMinutes });
    });
  });
};

module.exports = { initSocket };
