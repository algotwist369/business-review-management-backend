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
        enum: ['assignment', 'pending_work', 'completed_work'],
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

module.exports = mongoose.model('Notification', NotificationSchema);