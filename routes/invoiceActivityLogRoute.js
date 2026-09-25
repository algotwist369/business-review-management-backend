const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { requireSuperAdmin } = require('../middlewares/invoiceAccess.middleware');
const logController = require('../controllers/invoiceActivityLogController');

router.use(authMiddleware);
router.use(requireSuperAdmin);

// Super Admin Audit Trail
router.get('/', logController.getActivityLogs);
router.delete('/clear-all', logController.clearAllLogs);

module.exports = router;
