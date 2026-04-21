const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const Hospital = require('../models/Hospital');
const logger   = require('../utils/logger');


/**
 * Protect routes for authenticated patients.
 */

const protectUser = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    logger.warn(`Auth failed: ${err.message}`);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/**
 * Protect routes for authenticated hospital staff.
 */
const protectHospital = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'hospital') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const hospital = await Hospital.findById(decoded.id);
    if (!hospital || !hospital.isActive) {
      return res.status(401).json({ success: false, message: 'Hospital not found or inactive' });
    }

    req.hospital = hospital;
    next();
  } catch (err) {
    logger.warn(`Hospital auth failed: ${err.message}`);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const extractToken = (req) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
};

/**
 * Sign a JWT for a user or hospital.
 */
const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

module.exports = { protectUser, protectHospital, signToken };
