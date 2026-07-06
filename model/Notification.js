const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    
    title: {
        type: String,
        required: true,
        trim: true,
    },

    message: {
        type: String,
        required: true,
        trim: true,
    },

    type: {
        type: String,
        enum: [
            'assignment',
            'pending_work',
            'completed_work',
            'gbp_post_expiring',
            'gbp_post_expired',
            'gbp_minimum_count_pending',
            'support_issue_raised',
            'support_issue_remark',
            'support_issue_resolved',
            'support_issue_reopened',
            'support_issue_status_changed'
        ],
        required: true,
    },

    business_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        index: true,
        default: null,
    },

    triggered_by_user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },

    is_read: {
        type: Boolean,
        default: false,
        index: true,
    },

    is_cleared: {
        type: Boolean,
        default: false,
        index: true,
    },
}, { timestamps: true });

// Auto-delete records older than 7 days (604800 seconds) using MongoDB TTL index
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
NotificationSchema.index({ user_id: 1, is_cleared: 1, is_read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
