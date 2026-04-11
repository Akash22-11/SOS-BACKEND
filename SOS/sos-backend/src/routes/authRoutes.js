const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/authController');
const { protectUser } = require('../middleware/auth');

// ── Patient ───────────────────────────────────────────────────────────────────
router.post('/user/register', ctrl.registerUser);
router.post('/user/login',    ctrl.loginUser);
router.patch('/user/location',protectUser, ctrl.updateUserLocation);

// ── Hospital ──────────────────────────────────────────────────────────────────
router.post('/hospital/register', ctrl.registerHospital);
router.post('/hospital/login',    ctrl.loginHospital);

module.exports = router;
