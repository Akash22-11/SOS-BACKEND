const User     = require('../models/User');
const Hospital = require('../models/Hospital');
const { signToken } = require('../middleware/auth');
const logger   = require('../utils/logger');

// ── User Auth ─────────────────────────────────────────────────────────────────

const registerUser = async (req, res) => {
  try {
    const { name, email, phone, password, bloodGroup, allergies, medicalConditions, currentMedications, emergencyContacts } = req.body;

    if (await User.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const user = await User.create({
      name, email, phone, password,
      bloodGroup, allergies, medicalConditions, currentMedications, emergencyContacts
    });

    const token = signToken(user._id, 'user');
    logger.info(`New user registered: ${email}`);
    return res.status(201).json({ success: true, token, userId: user._id });
  } catch (err) {
    logger.error(`Register user error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = signToken(user._id, 'user');
    return res.json({ success: true, token, userId: user._id, name: user.name });
  } catch (err) {
    logger.error(`Login user error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

/**
 * PATCH /api/auth/user/location
 * App updates user's last known location periodically.
 */
const updateUserLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    await User.findByIdAndUpdate(req.user.id, {
      lastLocation: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] }
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not update location' });
  }
};

// ── Hospital Auth ─────────────────────────────────────────────────────────────

const registerHospital = async (req, res) => {
  try {
    const { name, email, phone, address, latitude, longitude, specialties, totalBeds, hasEmergency } = req.body;

    if (await Hospital.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'Hospital already registered' });
    }

    // Hospitals are created unverified — admin must verify before they receive alerts
    const hospital = await Hospital.create({
      name, email, phone, address,
      location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
      specialties, totalBeds, hasEmergency: hasEmergency !== false,
      isVerified: false
    });

    logger.info(`New hospital registered (pending verification): ${name} — ${email}`);
    return res.status(201).json({
      success: true,
      message: 'Registration submitted — pending admin verification',
      hospitalId: hospital._id
    });
  } catch (err) {
    logger.error(`Register hospital error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

const loginHospital = async (req, res) => {
  try {
    const { email, password } = req.body;
    // NOTE: In production add bcrypt password to Hospital model too.
    // For now we do a simple email lookup; extend with password field as needed.
    const hospital = await Hospital.findOne({ email, isVerified: true, isActive: true });

    if (!hospital) {
      return res.status(401).json({ success: false, message: 'Invalid credentials or not yet verified' });
    }

    const token = signToken(hospital._id, 'hospital');
    return res.json({ success: true, token, hospitalId: hospital._id, name: hospital.name });
  } catch (err) {
    logger.error(`Login hospital error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

module.exports = { registerUser, loginUser, updateUserLocation, registerHospital, loginHospital };
