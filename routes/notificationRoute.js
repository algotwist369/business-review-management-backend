const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const {
    getNotifications,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
} = require('../controller/notificationController');

// All notification routes require authentication
router.use(authMiddleware);

router.get('/', getNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);
router.delete('/clear-all', clearAllNotifications);
router.delete('/:id', clearNotification);

module.exports = router;
