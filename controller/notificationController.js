const Notification = require('../model/Notification');

// Get active notifications (unread first, sorted by createdAt desc)
const getNotifications = async (req, res) => {
    try {
        const userId = req.user._id;

        const notifications = await Notification.find({
            user_id: userId,
            is_cleared: false,
        })
        .sort({ is_read: 1, createdAt: -1 })
        .populate('triggered_by_user_id', 'username email')
        .populate('business_id', 'business_name location')
        .lean();

        return res.status(200).json(notifications);
    } catch (error) {
        console.error('[Notification Controller] getNotifications error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Mark a single notification as read
const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const notification = await Notification.findOneAndUpdate(
            { _id: id, user_id: userId },
            { $set: { is_read: true } },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        return res.status(200).json(notification);
    } catch (error) {
        console.error('[Notification Controller] markAsRead error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Mark all active notifications of the user as read
const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user._id;

        await Notification.updateMany(
            { user_id: userId, is_read: false },
            { $set: { is_read: true } }
        );

        return res.status(200).json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('[Notification Controller] markAllAsRead error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Clear a single notification (soft delete by setting is_cleared = true)
const clearNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const notification = await Notification.findOneAndUpdate(
            { _id: id, user_id: userId },
            { $set: { is_cleared: true } },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        return res.status(200).json({ message: 'Notification cleared successfully' });
    } catch (error) {
        console.error('[Notification Controller] clearNotification error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Clear all active notifications of the user
const clearAllNotifications = async (req, res) => {
    try {
        const userId = req.user._id;

        await Notification.updateMany(
            { user_id: userId, is_cleared: false },
            { $set: { is_cleared: true } }
        );

        return res.status(200).json({ message: 'All notifications cleared successfully' });
    } catch (error) {
        console.error('[Notification Controller] clearAllNotifications error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    getNotifications,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
};
