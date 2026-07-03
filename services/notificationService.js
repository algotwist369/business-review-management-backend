const User = require('../model/user');
const Business = require('../model/Business');
const Notification = require('../model/Notification');
const Review = require('../model/review');
const GoogleAdsTeam = require('../model/GoogleAdsTeam');
const GoogleBusinessProfileUpdates = require('../model/GoogleBusinessProfileUpdates');
const SocialMediaManagement = require('../model/SocialMediaManagement');
const JustdialManagementTeam = require('../model/JustdialManagementTeam');
const WebDevTeam = require('../model/WebDevTeam');
const LeadsManagement = require('../model/LeadsManagement');
const { sendNotification, sendToMultipleUsers } = require('./socketService');

const getCurrentMonthStr = () => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${month}`;
};

const startOfDay = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const endOfDay = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};

const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
};

const getGbpAdminRecipientIds = async (user) => {
    const superAdmins = await User.find({ role: 'super_admin', is_deleted: false, is_active: true }).select('_id').lean();
    const superAdminIds = superAdmins.map(sa => sa._id.toString());
    const managingAdminIds = (user.managed_by || []).map(id => id.toString());
    return Array.from(new Set([...managingAdminIds, ...superAdminIds]));
};

const sendGbpNotificationOncePerDay = async ({
    recipientId,
    title,
    message,
    type,
    businessId,
    triggeredByUserId = null
}) => {
    const todayStart = startOfDay();

    const existing = await Notification.findOne({
        user_id: recipientId,
        title,
        message,
        type,
        business_id: businessId,
        triggered_by_user_id: triggeredByUserId,
        createdAt: { $gte: todayStart }
    }).lean();

    if (existing) return null;

    const notification = await Notification.create({
        user_id: recipientId,
        title,
        message,
        type,
        business_id: businessId,
        triggered_by_user_id: triggeredByUserId
    });

    const populated = await Notification.findById(notification._id)
        .populate('triggered_by_user_id', 'username email')
        .populate('business_id', 'business_name location')
        .lean();

    sendNotification(recipientId, populated);
    return populated;
};

// Check if all assigned scopes for a user on a specific business are completed
const checkUserCompletionForBusiness = async (userId, businessId) => {
    try {
        const user = await User.findById(userId).lean();
        if (!user) return false;

        const scopes = user.scopes || [];
        if (scopes.length === 0) return true; // No scopes = nothing to complete

        for (const scope of scopes) {
            if (scope === 'review_management') {
                const review = await Review.findOne({ user_id: userId, business_id: businessId }).lean();
                if (!review || review.review_count === 0) {
                    return false;
                }
            } 
            else if (scope === 'gbp_record_management') {
                const ad = await GoogleAdsTeam.findOne({ user_id: userId, business_id: businessId }).lean();
                if (!ad || ad.status !== 'completed') {
                    return false;
                }
            } 
            else if (scope === 'social_media_management') {
                const month = getCurrentMonthStr();
                const gbp = await GoogleBusinessProfileUpdates.findOne({ user_id: userId, business_id: businessId, month }).lean();
                const social = await SocialMediaManagement.findOne({ user_id: userId, business_id: businessId }).lean();
                if (!gbp || gbp.status !== 'completed' || !social || social.status !== 'completed') {
                    return false;
                }
            } 
            else if (scope === 'jd_management') {
                const jd = await JustdialManagementTeam.findOne({ user_id: userId, business_id: businessId }).lean();
                if (!jd || jd.status !== 'completed') {
                    return false;
                }
            } 
            else if (scope === 'web_dev_management') {
                const web = await WebDevTeam.findOne({ user_id: userId, business_id: businessId }).lean();
                if (!web || web.status !== 'completed') {
                    return false;
                }
            } 
            else if (scope === 'leads_management') {
                const leads = await LeadsManagement.findOne({ user_id: userId, business_id: businessId }).lean();
                if (!leads || leads.status !== 'completed') {
                    return false;
                }
            }
        }

        return true;
    } catch (error) {
        console.error('[Notification Service] checkUserCompletionForBusiness error:', error);
        return false;
    }
};

// Handle checking completion and notifying admins/super_admins if completed
const handleWorkspaceCompletion = async (userId, businessId) => {
    try {
        const business = await Business.findById(businessId).lean();
        if (!business) return;

        // Completion alerts are only triggered for "new" businesses
        if (!business.is_new) return;

        const isCompleted = await checkUserCompletionForBusiness(userId, businessId);
        if (!isCompleted) return;

        const user = await User.findById(userId).lean();
        if (!user) return;

        // Fetch all super admins to notify
        const superAdmins = await User.find({ role: 'super_admin', is_deleted: false, is_active: true }).select('_id').lean();
        const superAdminIds = superAdmins.map(sa => sa._id.toString());

        // Get managing admins
        const managingAdminIds = (user.managed_by || []).map(id => id.toString());

        // Combine recipients (unique list)
        const recipientIds = Array.from(new Set([...managingAdminIds, ...superAdminIds]));

        if (recipientIds.length === 0) return;

        // Check if we already created a completion notification for this business and user
        const existingNotification = await Notification.findOne({
            user_id: { $in: recipientIds },
            type: 'completed_work',
            business_id: businessId,
            triggered_by_user_id: userId
        }).lean();

        if (existingNotification) return; // Notification already exists, skip duplicate

        // Create Notifications in DB
        const notificationPromises = recipientIds.map(async (adminId) => {
            const notification = await Notification.create({
                user_id: adminId,
                title: 'Workspace Tasks Completed',
                message: `User ${user.username || user.email} has completed all workspace tasks for new business: ${business.business_name}.`,
                type: 'completed_work',
                business_id: businessId,
                triggered_by_user_id: userId
            });

            // Populate and return for socket emission
            return Notification.findById(notification._id)
                .populate('triggered_by_user_id', 'username email')
                .populate('business_id', 'business_name location')
                .lean();
        });

        const createdNotifications = await Promise.all(notificationPromises);

        // Emit real-time socket updates
        createdNotifications.forEach(notif => {
            const { sendNotification } = require('./socketService');
            sendNotification(notif.user_id, notif);
        });

        console.log(`[Notification Service] Triggered completion alerts to ${recipientIds.length} admins for business: ${businessId}`);
    } catch (error) {
        console.error('[Notification Service] handleWorkspaceCompletion error:', error);
    }
};

// Send daily alerts for pending new business tasks (2 days or less remaining)
const sendPendingWorkAlerts = async () => {
    try {
        console.log('[Job] Running pending work alert checks...');
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        
        // Find all businesses that are "new" and at least 5 days old
        const pendingBusinesses = await Business.find({
            is_returnDocument: "after",
            createdAt: { $lte: fiveDaysAgo }
        }).lean();

        if (pendingBusinesses.length === 0) {
            console.log('[Job] No pending new businesses requiring alerts.');
            return;
        }

        const pendingBusinessMap = new Map(pendingBusinesses.map(b => [b._id.toString(), b]));
        const pendingBusinessIds = Array.from(pendingBusinessMap.keys());

        // Find active users assigned to these businesses
        const users = await User.find({
            role: 'user',
            is_deleted: false,
            is_active: true,
            assigned_businesses: { $in: pendingBusinessIds }
        }).lean();

        // Get all active super admins (to notify if tasks are pending)
        const superAdmins = await User.find({ role: 'super_admin', is_deleted: false, is_active: true }).select('_id').lean();
        const superAdminIds = superAdmins.map(sa => sa._id.toString());

        for (const user of users) {
            // Filter user's assigned businesses to only those that are pending alerts
            const userPendingBizIds = (user.assigned_businesses || [])
                .map(id => id.toString())
                .filter(idStr => pendingBusinessMap.has(idStr));

            for (const bizIdStr of userPendingBizIds) {
                const business = pendingBusinessMap.get(bizIdStr);
                const isCompleted = await checkUserCompletionForBusiness(user._id, business._id);
                
                if (!isCompleted) {
                    // Compute days remaining
                    const ageMs = Date.now() - new Date(business.createdAt).getTime();
                    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                    const remainingMs = Math.max(0, sevenDaysMs - ageMs);
                    const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));

                    // Notification for User
                    const userNotif = await Notification.create({
                        user_id: user._id,
                        title: 'Pending Workspace Tasks',
                        message: `You have pending workspace tasks for business: ${business.business_name}. Only ${daysRemaining} day(s) left in the introductory period.`,
                        type: 'pending_work',
                        business_id: business._id
                    });

                    // Emit to user
                    const populatedUserNotif = await Notification.findById(userNotif._id)
                        .populate('business_id', 'business_name location')
                        .lean();
                    sendNotification(user._id, populatedUserNotif);

                    // Notifications for admins and super admins
                    const managingAdminIds = (user.managed_by || []).map(id => id.toString());
                    const adminRecipientIds = Array.from(new Set([...managingAdminIds, ...superAdminIds]));

                    for (const adminId of adminRecipientIds) {
                        const adminNotif = await Notification.create({
                            user_id: adminId,
                            title: 'Pending Workspace Tasks Alert',
                            message: `User ${user.username || user.email} has pending workspace tasks for new business: ${business.business_name}. Only ${daysRemaining} day(s) left in the introductory period.`,
                            type: 'pending_work',
                            business_id: business._id,
                            triggered_by_user_id: user._id
                        });

                        const populatedAdminNotif = await Notification.findById(adminNotif._id)
                            .populate('triggered_by_user_id', 'username email')
                            .populate('business_id', 'business_name location')
                            .lean();
                        sendNotification(adminId, populatedAdminNotif);
                    }
                }
            }
        }
        console.log('[Job] Pending work alert checks completed.');
    } catch (error) {
        console.error('[Job Error] sendPendingWorkAlerts error:', error);
    }
};

const getLatestGbpRecordMap = (records) => {
    const map = new Map();

    records.forEach(record => {
        const key = `${record.user_id?.toString()}:${record.business_id?._id?.toString() || record.business_id?.toString()}`;
        const existing = map.get(key);

        if (!existing || record.month > existing.month || (
            record.month === existing.month &&
            new Date(record.updatedAt || record.createdAt || 0) > new Date(existing.updatedAt || existing.createdAt || 0)
        )) {
            map.set(key, record);
        }
    });

    return map;
};

const getPermanentGbpCount = (records, field) => {
    const source = [...records]
        .sort((a, b) => {
            if (a.month !== b.month) return b.month.localeCompare(a.month);
            return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
        })
        .find(record => Number(record[field] || 0) > 0);

    return source ? Number(source[field] || 0) : 0;
};

const sendGbpMinimumAlerts = async () => {
    const records = await GoogleBusinessProfileUpdates.find({})
        .populate('business_id', 'business_name location')
        .lean();

    const latestRecordMap = getLatestGbpRecordMap(records);
    const grouped = new Map();

    records.forEach(record => {
        const userId = record.user_id?.toString();
        const businessId = (record.business_id?._id || record.business_id)?.toString();
        if (!userId || !businessId) return;
        const key = `${userId}:${businessId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(record);
    });

    for (const [key, groupRecords] of grouped.entries()) {
        const latestRecord = latestRecordMap.get(key);
        if (!latestRecord || latestRecord.status !== 'completed') continue;

        const user = await User.findById(latestRecord.user_id).lean();
        if (!user || user.is_deleted || !user.is_active) continue;

        const business = latestRecord.business_id;
        const businessName = business?.business_name || 'this business';
        const adminRecipientIds = await getGbpAdminRecipientIds(user);
        const allRecipientIds = Array.from(new Set([user._id.toString(), ...adminRecipientIds]));

        const checks = [
            {
                label: 'product count',
                current: getPermanentGbpCount(groupRecords, 'product_count'),
                minimum: 50
            },
            {
                label: 'service count',
                current: getPermanentGbpCount(groupRecords, 'service_count'),
                minimum: 150
            },
            {
                label: 'media count',
                current: getPermanentGbpCount(groupRecords, 'media_count'),
                minimum: 10
            },
            {
                label: 'scheduled posts count',
                current: Number(latestRecord.scheduled_posts_count || 0),
                minimum: 30
            }
        ];

        for (const check of checks) {
            if (check.current >= check.minimum) continue;

            for (const recipientId of allRecipientIds) {
                await sendGbpNotificationOncePerDay({
                    recipientId,
                    title: 'GBP Minimum Count Pending',
                    message: `GBP ${check.label} for ${businessName} is ${check.current}. Minimum required is ${check.minimum}.`,
                    type: 'gbp_minimum_count_pending',
                    businessId: business?._id || latestRecord.business_id,
                    triggeredByUserId: user._id
                });
            }
        }
    }
};

const sendGbpPostDateAlerts = async () => {
    const today = new Date();
    const twoDaysLater = addDays(today, 2);

    const expiringRecords = await GoogleBusinessProfileUpdates.find({
        post_end_date: {
            $gte: startOfDay(twoDaysLater),
            $lte: endOfDay(twoDaysLater)
        }
    })
        .populate('business_id', 'business_name location')
        .lean();

    for (const record of expiringRecords) {
        const user = await User.findById(record.user_id).lean();
        if (!user || user.is_deleted || !user.is_active) continue;

        const businessName = record.business_id?.business_name || 'this business';

        await sendGbpNotificationOncePerDay({
            recipientId: user._id,
            title: 'GBP Post Ending Soon',
            message: `Your post for ${businessName} is going to end in 2 days.`,
            type: 'gbp_post_expiring',
            businessId: record.business_id?._id || record.business_id,
            triggeredByUserId: user._id
        });
    }

    const expiredRecords = await GoogleBusinessProfileUpdates.find({
        post_end_date: { $lte: endOfDay(today) }
    })
        .populate('business_id', 'business_name location')
        .lean();

    for (const record of expiredRecords) {
        const user = await User.findById(record.user_id).lean();
        if (!user || user.is_deleted || !user.is_active) continue;

        const newerEntry = await GoogleBusinessProfileUpdates.findOne({
            user_id: record.user_id,
            business_id: record.business_id?._id || record.business_id,
            _id: { $ne: record._id },
            post_start_date: { $gt: record.post_start_date || record.post_end_date }
        }).lean();

        if (newerEntry) continue;

        const businessName = record.business_id?.business_name || 'this business';
        const adminRecipientIds = await getGbpAdminRecipientIds(user);

        for (const adminId of adminRecipientIds) {
            await sendGbpNotificationOncePerDay({
                recipientId: adminId,
                title: 'GBP Post Ended',
                message: `User ${user.username || user.email} has not added a new post entry after the post ended for ${businessName}.`,
                type: 'gbp_post_expired',
                businessId: record.business_id?._id || record.business_id,
                triggeredByUserId: user._id
            });
        }
    }
};

const sendGbpMaintenanceAlerts = async () => {
    try {
        console.log('[Job] Running GBP maintenance alert checks...');
        await sendGbpPostDateAlerts();
        await sendGbpMinimumAlerts();
        console.log('[Job] GBP maintenance alert checks completed.');
    } catch (error) {
        console.error('[Job Error] sendGbpMaintenanceAlerts error:', error);
    }
};

module.exports = {
    checkUserCompletionForBusiness,
    handleWorkspaceCompletion,
    sendPendingWorkAlerts,
    sendGbpMaintenanceAlerts,
};
