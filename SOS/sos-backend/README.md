# 🚑 Emergency SOS Backend

A Node.js/Express backend that notifies nearby hospitals the instant a patient taps the SOS button. Hospitals are alerted via **SMS (Twilio)**, **Email (SMTP)**, and **real-time WebSocket (Socket.io)** simultaneously.

---

## Architecture at a glance

```
Patient taps SOS
      │
      ▼
POST /api/sos/trigger
      │
      ├─► MongoDB $nearSphere query  ──► find verified hospitals within 5 km
      │
      ├─► Google Places fallback     ──► if DB has no results
      │
      ├─► notifyHospital() ×N        ──► SMS + Email fired in parallel
      │
      ├─► Socket.io push             ──► real-time alert to connected hospitals
      │
      └─► notifyEmergencyContacts()  ──► SMS + Email to patient's saved contacts
```

---

## Project structure

```
sos-backend/
├── src/
│   ├── server.js               # Entry point — HTTP + Socket.io + cron
│   ├── app.js                  # Express app, middleware, routes
│   ├── controllers/
│   │   ├── sosController.js    # HTTP handlers for SOS endpoints
│   │   └── authController.js   # Register / login (user + hospital)
│   ├── services/
│   │   ├── sosService.js       # Core orchestration logic
│   │   ├── hospitalFinderService.js  # Geospatial search + Google Places
│   │   └── notificationService.js   # Twilio SMS + Nodemailer email
│   ├── models/
│   │   ├── User.js             # Patient schema (blood group, allergies…)
│   │   ├── Hospital.js         # Hospital schema (location, socketId…)
│   │   └── SOSEvent.js         # Emergency event + notification tracking
│   ├── middleware/
│   │   └── auth.js             # JWT guard for users and hospitals
│   ├── routes/
│   │   ├── sosRoutes.js
│   │   └── authRoutes.js
│   ├── jobs/
│   │   └── sosJobs.js          # Cron: expire stale events, hourly stats
│   └── utils/
│       ├── socket.js           # Socket.io connection + room management
│       └── logger.js           # Winston logger
├── tests/
│   ├── sos.test.js
│   └── hospitalFinder.test.js
├── config/
│   └── db.js
├── .env.example
└── package.json
```

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Fill in MONGO_URI, JWT_SECRET, TWILIO_*, SMTP_*, GOOGLE_MAPS_API_KEY

# 3. Start development server
npm run dev

# 4. Run tests
npm test
```

---

## API reference

### Auth

| Method | Endpoint                  | Who      | Description                   |
|--------|---------------------------|----------|-------------------------------|
| POST   | `/api/auth/user/register` | Patient  | Register with medical profile |
| POST   | `/api/auth/user/login`    | Patient  | Login → get JWT               |
| PATCH  | `/api/auth/user/location` | Patient  | Update last known location    |
| POST   | `/api/auth/hospital/register` | Hospital | Register (pending verification) |
| POST   | `/api/auth/hospital/login`    | Hospital | Login → get JWT               |

### SOS

| Method | Endpoint                           | Who      | Description                          |
|--------|------------------------------------|----------|--------------------------------------|
| POST   | `/api/sos/trigger`                 | Patient  | **Single tap — triggers full SOS**   |
| GET    | `/api/sos/:id/status`              | Patient  | Poll for hospital response           |
| POST   | `/api/sos/:id/cancel`              | Patient  | Cancel alert (patient is safe)       |
| POST   | `/api/sos/:id/resolve`             | Patient  | Mark as resolved                     |
| POST   | `/api/sos/:id/hospital/acknowledge`| Hospital | Confirm alert received               |
| POST   | `/api/sos/:id/hospital/accept`     | Hospital | Confirm dispatching help             |
| POST   | `/api/sos/:id/hospital/decline`    | Hospital | Cannot respond                       |

#### Trigger SOS — request body
```json
{
  "latitude":  23.4009,
  "longitude": 88.4978
}
```

#### Trigger SOS — response
```json
{
  "success": true,
  "message": "SOS triggered — 3 hospital(s) alerted",
  "sosEventId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "alertedHospitals": [
    {
      "name":           "City General Hospital",
      "phone":          "+919876543210",
      "address":        "12 Hospital Road, Krishnanagar",
      "distanceMeters": 1240
    }
  ]
}
```

---

## Real-time (Socket.io)

Hospitals connect with their JWT in the handshake:

```js
const socket = io('http://localhost:5000', {
  auth: { token: '<hospital_jwt>' }
});

// Receive incoming SOS alerts
socket.on('sos:incoming', (data) => {
  console.log('New SOS!', data.user.name, data.distanceMeters + 'm away');
  // data shape:
  // { sosEventId, user: { name, phone, medicalSnapshot },
  //   coordinates, address, distanceMeters, timestamp }
});

// SOS was cancelled by patient
socket.on('sos:cancelled', ({ sosEventId }) => { ... });
```

Patients connect similarly and listen for:
```js
socket.on('sos:hospital_responding', (data) => {
  // data.hospital: { name, phone, address, location }
});

socket.on('sos:eta_update', ({ sosEventId, etaMinutes }) => { ... });
```

---

## SOS event lifecycle

```
active  ──► acknowledged (hospital opened alert)
        ──► resolved     (patient confirmed safe)
        ──► cancelled    (patient cancelled)
        ──► expired      (60 min timeout, cron job)
```

---

## Configuration

| Variable                   | Description                                    | Default |
|----------------------------|------------------------------------------------|---------|
| `SOS_SEARCH_RADIUS_METERS` | Radius to search for nearby hospitals          | 5000    |
| `SOS_MAX_HOSPITALS_ALERT`  | Max hospitals notified per SOS                 | 5       |
| `SOS_EXPIRY_MINUTES`       | Minutes before an active SOS auto-expires      | 60      |

---

## Key design decisions

- **Parallel notifications** — SMS + Email + Socket all fire with `Promise.allSettled`, so a Twilio failure never blocks the email or socket push.
- **Non-fatal notification errors** — if one channel fails, the others still deliver.
- **Google Places fallback** — if no hospitals are registered in your DB for a given area, the system falls back to live Google Places results.
- **Medical snapshot** — patient's blood group, allergies, and medications are captured at SOS time so hospitals see the profile even if it changes later.
- **Duplicate SOS guard** — a user can only have one active SOS at a time.
- **Rate limiting** — the trigger endpoint is limited to 10 requests per 15 minutes per IP to prevent abuse.
