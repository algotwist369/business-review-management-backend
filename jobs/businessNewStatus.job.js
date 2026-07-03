const cron = require('node-cron');
const Business = require('../model/Business');
const { sendPendingWorkAlerts, sendGbpMaintenanceAlerts } = require('../services/notificationService');

const runDailyJobs = async () => {
    try {
        // 1. Run pending work alerts (for businesses >= 5 days old but still is_returnDocument: "after")
        await sendPendingWorkAlerts();
        await sendGbpMaintenanceAlerts();

        // 2. Set is_new to false for businesses >= 7 days old
        const result = await Business.updateMany(
            {
                is_returnDocument: "after",
                createdAt: {
                    $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
                },
            },
            {
                $set: {
                    is_new: false,
                },
            }
        );
        console.log(`[Job] Business status updated. Modified: ${result.modifiedCount}`);
    } catch (error) {
        console.error('[Job Error] Failed to run daily jobs:', error);
    }
};

const startBusinessNewStatusJob = () => {
    // Run once immediately on startup
    runDailyJobs();

    // Schedule to run daily at midnight
    cron.schedule('0 0 * * *', runDailyJobs);
};

module.exports = startBusinessNewStatusJob;
