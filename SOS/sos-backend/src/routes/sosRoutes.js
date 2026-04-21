const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/sosController');
const { protectUser, protectHospital } = require('../middleware/auth');


// ── Patient routes ────────────────────────────────────────────────────────────

// Single tap — trigger SOS
router.post('/trigger',       protectUser, ctrl.triggerValidation, ctrl.trigger);

// Poll for status (which hospital is responding)
router.get('/:id/status',     protectUser, ctrl.getStatus);

// Patient cancels their own alert
router.post('/:id/cancel',    protectUser, ctrl.cancel);

// Patient marks themselves safe
router.post('/:id/resolve',   protectUser, ctrl.resolve);

// ── Hospital routes ───────────────────────────────────────────────────────────

// Hospital opens / reads the alert
router.post('/:id/hospital/acknowledge', protectHospital, ctrl.hospitalAcknowledge);

// Hospital confirms they are sending help
router.post('/:id/hospital/accept',      protectHospital, ctrl.hospitalAccept);

// Hospital cannot respond
router.post('/:id/hospital/decline',     protectHospital, ctrl.hospitalDecline);

module.exports = router;
