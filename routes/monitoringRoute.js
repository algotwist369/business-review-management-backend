
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const superAdminMiddleware = require('../middlewares/superAdmin.middleware');
const {
  getMetrics,
  getAlerts,
  resolveAlertController,
  getStatusSummary,
} = require('../controller/monitoringController');

// All routes are super admin only
router.use(authMiddleware, superAdminMiddleware);

router.get('/status-summary', getStatusSummary);
router.get('/metrics', getMetrics);
router.get('/alerts', getAlerts);
router.patch('/alerts/:alertId/resolve', resolveAlertController);

module.exports = router;
