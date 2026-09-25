const InvoiceActivityLog = require('../models/invoiceActivityLogModel');

// Get activity logs (Super Admin only)
const getActivityLogs = async (req, res) => {
    try {
        const { action, userId, page = 1, limit = 50 } = req.query;

        const filter = {};
        if (action) filter.action = action;
        if (userId) filter['performed_by.user_id'] = userId;

        const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
        const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

        const [logs, total] = await Promise.all([
            InvoiceActivityLog.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(pageSize),
            InvoiceActivityLog.countDocuments(filter),
        ]);

        return res.json({
            logs,
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (err) {
        console.error('[InvoiceLog] getActivityLogs error:', err);
        return res.status(500).json({ error: 'Failed to fetch invoice activity logs' });
    }
};

// Super Admin manual one-click: Clear All / Delete All Activity Logs
const clearAllLogs = async (req, res) => {
    try {
        const result = await InvoiceActivityLog.deleteMany({});
        return res.json({
            message: 'All invoice activity logs cleared successfully',
            deletedCount: result.deletedCount,
        });
    } catch (err) {
        console.error('[InvoiceLog] clearAllLogs error:', err);
        return res.status(500).json({ error: 'Failed to clear activity logs' });
    }
};

module.exports = {
    getActivityLogs,
    clearAllLogs,
};
