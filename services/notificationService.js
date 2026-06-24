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
            is_new: true,
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

module.exports = {
    checkUserCompletionForBusiness,
    handleWorkspaceCompletion,
    sendPendingWorkAlerts,
};
