require('dotenv').config();
const http         = require('http');
const { Server }   = require('socket.io');
const app          = require('./app');
const connectDB    = require('../config/db');
const { initSocket } = require('./utils/socket');
const { startJobs, stopJobs } = require('./jobs/sosJobs');
const logger       = require('./utils/logger');

const PORT = process.env.PORT || 5000;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const start = async () => {
  // 1. Connect to MongoDB
  await connectDB();

  // 2. Create HTTP server and attach Socket.io
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET', 'POST'] }
  });

  // 3. Make io accessible inside controllers via req.app.get('io')
  app.set('io', io);

  // 4. Register socket handlers
  initSocket(io);

  // 5. Start background jobs
  startJobs();

  // 6. Listen
  httpServer.listen(PORT, () => {
    logger.info(`🚑 SOS Backend running on port ${PORT} [${process.env.NODE_ENV}]`);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    stopJobs();
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`);
  });
};

start();
