const cron     = require('node-cron');
const SOSEvent = require('../models/SOSEvent');
const logger   = require('../utils/logger');

/**
 * Every 5 minutes: mark any SOS events past their expiresAt as 'expired'.
 * (The MongoDB TTL index removes the document, but we want a status change first.)
 */

const expireStaleEvents = cron.schedule('*/5 * * * *', async () => {
  try {
    const result = await SOSEvent.updateMany(
      {
        status:    'active',
        expiresAt: { $lte: new Date() }
      },
      { status: 'expired' }
    );

    if (result.modifiedCount > 0) {
      logger.info(`Expired ${result.modifiedCount} stale SOS event(s)`);
    }
  } catch (err) {
    logger.error(`Cron expiry job failed: ${err.message}`);
  }
}, { scheduled: false });


/**
 * Every hour: log a quick dashboard of active events.
 */

const logActiveStats = cron.schedule('0 * * * *', async () => {
  try {
    const counts = await SOSEvent.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const summary = counts.map(c => `${c._id}: ${c.count}`).join(' | ');
    logger.info(`SOS stats — ${summary || 'no events'}`);
  } catch (err) {
    logger.error(`Stats cron failed: ${err.message}`);
  }
}, { scheduled: false });

const startJobs = () => {
  expireStaleEvents.start();
  logActiveStats.start();
  logger.info('Background cron jobs started');
};

const stopJobs = () => {
  expireStaleEvents.stop();
  logActiveStats.stop();
};

module.exports = { startJobs, stopJobs };
