
const { createAlert } = require('../services/monitoring.service');

// Track 5xx errors in a rolling window (last 5 minutes)
let errorCounts = [];
const ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ERROR_THRESHOLD = 10; // 10 errors in 5 minutes

// Track slow responses
const SLOW_RESPONSE_THRESHOLD_MS = 3000; // 3 seconds
let slowResponseCounts = [];
const SLOW_RESPONSE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SLOW_RESPONSE_THRESHOLD = 20; // 20 slow responses in 5 minutes

const apiMonitoringMiddleware = (req, res, next) => {
  const start = Date.now();

  // Capture when the response is finished
  res.on('finish', async () => {
    const responseTime = Date.now() - start;
    const statusCode = res.statusCode;

    // Clean up old error entries
    const now = Date.now();
    errorCounts = errorCounts.filter(t => now - t < ERROR_WINDOW_MS);
    slowResponseCounts = slowResponseCounts.filter(t => now - t < SLOW_RESPONSE_WINDOW_MS);

    // Check for 5xx errors
    if (statusCode >= 500) {
      errorCounts.push(now);
      if (errorCounts.length >= ERROR_THRESHOLD) {
        await createAlert({
          type: 'API_5XX_ERRORS_HIGH',
          message: `High number of 5xx errors: ${errorCounts.length} errors in last 5 minutes`,
          severity: 'CRITICAL',
          metadata: {
            endpoint: req.originalUrl,
            method: req.method,
            statusCode,
            errorCount: errorCounts.length,
          },
        });
      }
    }

    // Check for slow responses
    if (responseTime > SLOW_RESPONSE_THRESHOLD_MS) {
      slowResponseCounts.push(now);
      if (slowResponseCounts.length >= SLOW_RESPONSE_THRESHOLD) {
        await createAlert({
          type: 'API_RESPONSE_TIME_HIGH',
          message: `High number of slow responses: ${slowResponseCounts.length} responses > ${SLOW_RESPONSE_THRESHOLD_MS}ms in last 5 minutes`,
          severity: 'HIGH',
          metadata: {
            endpoint: req.originalUrl,
            method: req.method,
            responseTimeMs: responseTime,
            slowResponseCount: slowResponseCounts.length,
          },
        });
      }
    }
  });

  next();
};

module.exports = apiMonitoringMiddleware;
