const express = require('express');
const router = express.Router();

const {
    assignUserToAdmin,
    updateUserRole,
} = require('../controller/superAdminController');

const authMiddleware = require('../middlewares/auth.middleware');
const superAdminMiddleware = require('../middlewares/superAdmin.middleware');

// Super Admin Only
router.use(authMiddleware, superAdminMiddleware);

router.post('/assign-admin', assignUserToAdmin);
router.patch('/update-role/:id', updateUserRole);

module.exports = router;
