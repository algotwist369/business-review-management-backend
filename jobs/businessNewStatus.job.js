const cron = require('node-cron');
const Business = require('../model/Business');

const updateBusinessStatus = async () => {
    try {
        const result = await Business.updateMany(
            {
                is_new: true,
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
        console.error('[Job Error] Failed to update business new status:', error);
    }
};

const startBusinessNewStatusJob = () => {
    // Run once immediately on startup
    updateBusinessStatus();

    // Schedule to run daily at midnight
    cron.schedule('0 0 * * *', updateBusinessStatus);
};

module.exports = startBusinessNewStatusJob;