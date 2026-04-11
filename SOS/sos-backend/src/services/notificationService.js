const nodemailer = require('nodemailer');
const twilio     = require('twilio');
const logger     = require('../utils/logger');

// ── Twilio client ─────────────────────────────────────────────────────────────
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ── SMTP transporter ──────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a Google Maps link from coordinates.
 */
const mapsLink = ([lng, lat]) =>
  `https://www.google.com/maps?q=${lat},${lng}`;

/**
 * Send an SMS via Twilio.
 */
const sendSMS = async (to, body) => {
  try {
    const msg = await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
    logger.info(`SMS sent to ${to} — SID: ${msg.sid}`);
    return msg;
  } catch (err) {
    logger.error(`SMS failed to ${to}: ${err.message}`);
    // Non-fatal — don't rethrow; other channels should still fire
  }
};

/**
 * Send an HTML email via SMTP.
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html
    });
    logger.info(`Email sent to ${to} — ID: ${info.messageId}`);
    return info;
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
  }
};

// ── Public notification functions ─────────────────────────────────────────────

/**
 * Notify a single hospital about an active SOS event.
 * Fires both SMS and email simultaneously (non-blocking pair).
 *
 * @param {Object} hospital  - Hospital document
 * @param {Object} sosEvent  - SOSEvent document
 * @param {Object} user      - User document
 * @param {number} distanceM - Distance in metres from user to hospital
 */
const notifyHospital = async (hospital, sosEvent, user, distanceM) => {
  const coords   = sosEvent.location.coordinates;
  const mapUrl   = mapsLink(coords);
  const distKm   = (distanceM / 1000).toFixed(2);
  const snapshot = sosEvent.medicalSnapshot;

  // ── SMS ──────────────────────────────────────────────────────────────────
  const smsBody =
    `🚨 EMERGENCY SOS — ${hospital.name}\n` +
    `Patient: ${user.name} | Blood: ${snapshot.bloodGroup}\n` +
    `Distance: ${distKm} km\n` +
    `Location: ${mapUrl}\n` +
    `Conditions: ${(snapshot.medicalConditions || []).join(', ') || 'None reported'}\n` +
    `Call patient: ${user.phone}`;

  // ── Email HTML ────────────────────────────────────────────────────────────
  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <div style="background:#d32f2f;padding:20px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0">🚨 Emergency SOS Alert</h1>
        <p style="color:#ffcdd2;margin:4px 0 0">Immediate response required</p>
      </div>
      <div style="background:#fff;border:1px solid #eee;padding:24px;border-radius:0 0 8px 8px">

        <h2 style="color:#d32f2f;margin-top:0">Patient Information</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;font-weight:bold;color:#555;width:180px">Name</td>
              <td style="padding:8px">${user.name}</td></tr>
          <tr style="background:#fafafa">
              <td style="padding:8px;font-weight:bold;color:#555">Phone</td>
              <td style="padding:8px"><a href="tel:${user.phone}">${user.phone}</a></td></tr>
          <tr><td style="padding:8px;font-weight:bold;color:#555">Blood Group</td>
              <td style="padding:8px;font-weight:bold;color:#d32f2f">${snapshot.bloodGroup}</td></tr>
          <tr style="background:#fafafa">
              <td style="padding:8px;font-weight:bold;color:#555">Allergies</td>
              <td style="padding:8px">${(snapshot.allergies || []).join(', ') || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;color:#555">Conditions</td>
              <td style="padding:8px">${(snapshot.medicalConditions || []).join(', ') || '—'}</td></tr>
          <tr style="background:#fafafa">
              <td style="padding:8px;font-weight:bold;color:#555">Medications</td>
              <td style="padding:8px">${(snapshot.currentMedications || []).join(', ') || '—'}</td></tr>
        </table>

        <h2 style="color:#d32f2f">Location</h2>
        <p>Distance from your hospital: <strong>${distKm} km</strong></p>
        <p>Address: ${sosEvent.address || 'Resolving…'}</p>
        <a href="${mapUrl}" style="display:inline-block;background:#1976d2;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px">
          📍 Open in Google Maps
        </a>

        <h2 style="color:#d32f2f;margin-top:24px">Actions</h2>
        <p>SOS Event ID: <code>${sosEvent._id}</code></p>
        <p style="color:#777;font-size:13px">
          Log in to the hospital dashboard to accept or decline this alert.<br>
          If you are responding, please update your status immediately.
        </p>
      </div>
    </div>
  `;

  await Promise.all([
    sendSMS(hospital.phone, smsBody),
    sendEmail({ to: hospital.email, subject: `🚨 SOS Alert — Patient ${user.name} (${distKm} km away)`, html: emailHtml })
  ]);
};

/**
 * Notify a user's personal emergency contacts about the SOS.
 *
 * @param {Array}  contacts - Array of { name, phone, email }
 * @param {Object} user
 * @param {Object} sosEvent
 */
const notifyEmergencyContacts = async (contacts, user, sosEvent) => {
  const mapUrl = mapsLink(sosEvent.location.coordinates);

  const promises = contacts.map(contact => {
    const sms =
      `⚠️ ${user.name} has triggered an Emergency SOS!\n` +
      `Their current location: ${mapUrl}\n` +
      `Please check on them immediately.`;

    const html = `
      <p>Hello ${contact.name},</p>
      <p><strong>${user.name}</strong> has triggered an Emergency SOS alert.</p>
      <p><a href="${mapUrl}">View their live location on Google Maps</a></p>
      <p>Please contact them or emergency services immediately.</p>
    `;

    return Promise.all([
      sendSMS(contact.phone, sms),
      contact.email
        ? sendEmail({ to: contact.email, subject: `⚠️ Emergency Alert — ${user.name} needs help`, html })
        : Promise.resolve()
    ]);
  });

  await Promise.allSettled(promises);
};

module.exports = { notifyHospital, notifyEmergencyContacts, sendSMS, sendEmail };
