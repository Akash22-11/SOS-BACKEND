const mongoose = require('mongoose');

// Each hospital notified about this SOS gets one entry here
const notificationSchema = new mongoose.Schema({
  hospital:      { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  distanceMeters:{ type: Number },
  notifiedAt:    { type: Date, default: Date.now },
  // acknowledged = hospital opened/read the alert
  acknowledged:  { type: Boolean, default: false },
  acknowledgedAt:{ type: Date },
  // accepted = hospital confirmed they are responding
  accepted:      { type: Boolean, default: false },
  acceptedAt:    { type: Date },
  // declined = hospital cannot respond
  declined:      { type: Boolean, default: false },
  declinedAt:    { type: Date },
  declineReason: { type: String }
});

const sosEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Location at moment SOS was triggered
    location: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }  // [lng, lat]
    },

    // Human-readable address (reverse-geocoded)
    address: { type: String, default: '' },

    status: {
      type:    String,
      enum:    ['active', 'acknowledged', 'resolved', 'expired', 'cancelled'],
      default: 'active'
    },

    // Snapshot of user medical info at time of SOS
    medicalSnapshot: {
      bloodGroup:        String,
      allergies:         [String],
      medicalConditions: [String],
      currentMedications:[String]
    },

    // Hospitals that were found and notified
    notifications: [notificationSchema],

    // Which hospital (if any) is responding
    respondingHospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },

    resolvedAt:  { type: Date },
    cancelledAt: { type: Date },
    expiresAt:   { type: Date }
  },
  { timestamps: true }
);

sosEventSchema.index({ location: '2dsphere' });
sosEventSchema.index({ user: 1, status: 1 });
sosEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

module.exports = mongoose.model('SOSEvent', sosEventSchema);
