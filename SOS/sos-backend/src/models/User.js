const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const emergencyContactSchema = new mongoose.Schema({
  name:  { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String }
});

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true },
    phone:    { type: String, required: true },
    password: { type: String, required: true, select: false },

    // Medical info shown to hospitals on SOS
    bloodGroup:       { type: String, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'], default: 'Unknown' },
    allergies:        [String],
    medicalConditions:[String],
    currentMedications:[String],

    emergencyContacts: [emergencyContactSchema],

    // Last known location (updated periodically by app)
    lastLocation: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }   // [lng, lat]
    },

    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

userSchema.index({ lastLocation: '2dsphere' });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', userSchema);
