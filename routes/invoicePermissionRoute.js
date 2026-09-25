const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { requireSuperAdmin } = require('../middlewares/invoiceAccess.middleware');
const permissionController = require('../controllers/invoicePermissionController');

router.use(authMiddleware);

// Get current user's permissions
router.get('/my-permission', permissionController.getMyPermission);

// Super Admin management endpoints
router.get('/', requireSuperAdmin, permissionController.getAllPermissions);
router.post('/upsert', requireSuperAdmin, permissionController.upsertPermission);
router.delete('/:userId', requireSuperAdmin, permissionController.revokePermission);

module.exports = router;
