
const cron = require('node-cron');
const { collectAndSaveMetrics } = require('../services/monitoring.service');

const startMonitoringJob = () => {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    console.log('[MONITORING] Collecting metrics...');
    await collectAndSaveMetrics();
  });

  console.log('[MONITORING] Started periodic metrics collection');
};

module.exports = startMonitoringJob;
