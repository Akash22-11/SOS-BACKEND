const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },
    email:   { type: String, required: true, unique: true, lowercase: true },
    phone:   { type: String, required: true },
    address: { type: String, required: true },

    location: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }  // [lng, lat]
    },

    specialties:   [String],
    totalBeds:     { type: Number, default: 0 },
    availableBeds: { type: Number, default: 0 },
    hasEmergency:  { type: Boolean, default: true },
    isVerified:    { type: Boolean, default: false },
    isActive:      { type: Boolean, default: true },

    // Socket.io room — hospitals join this on login
    socketId: { type: String, default: null },

    // FCM/Push token for mobile/web push notifications
    pushToken: { type: String, default: null },

    rating:       { type: Number, default: 0, min: 0, max: 5 },
    reviewCount:  { type: Number, default: 0 }
  },
  { timestamps: true }
);

hospitalSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Hospital', hospitalSchema);
