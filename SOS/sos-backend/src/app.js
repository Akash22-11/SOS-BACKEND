require('dotenv').config();
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const logger      = require('./utils/logger');

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const sosRoutes  = require('./routes/sosRoutes');

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: true }));
app.use(express.json());


// Global rate limiter (100 req / 15 min per IP)
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));


// Stricter limiter on SOS trigger (10 per 15 min per IP — prevents spam)
const sosLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { success: false, message: 'Too many SOS requests — please wait' }
});
app.use('/api/sos/trigger', sosLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/sos',  sosRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// 404 handler
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

module.exports = app;
