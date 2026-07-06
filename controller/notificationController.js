const Notification = require('../model/Notification');

// Get active notifications (unread first, sorted by createdAt desc)
const getNotifications = async (req, res) => {
    try {
        const userId = req.user._id;
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
        const skip = (page - 1) * limit;

        const filter = {
            user_id: userId,
            is_cleared: false,
        };

        const [notifications, total, unread_total] = await Promise.all([
            Notification.find(filter)
        .sort({ is_read: 1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
        .populate('triggered_by_user_id', 'username email')
        .populate('business_id', 'business_name location')
                .lean(),
            Notification.countDocuments(filter),
            Notification.countDocuments({ ...filter, is_read: false })
        ]);

        return res.status(200).json({
            total,
            unread_total,
            page,
            limit,
            has_more: skip + notifications.length < total,
            next_page: skip + notifications.length < total ? page + 1 : null,
            data: notifications
        });
    } catch (error) {
        console.error('[Notification Controller] getNotifications error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getUnreadCount = async (req, res) => {
    try {
        const userId = req.user._id;
        const types = String(req.query.types || '')
            .split(',')
            .map(type => type.trim())
            .filter(Boolean);

        const filter = {
            user_id: userId,
            is_cleared: false,
            is_read: false,
        };

        if (types.length) {
            filter.type = { $in: types };
        }

        const count = await Notification.countDocuments(filter);
        return res.status(200).json({ count });
    } catch (error) {
        console.error('[Notification Controller] getUnreadCount error:', error);
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
            { returnDocument: "after" }
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
            { returnDocument: "after" }
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
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
};
