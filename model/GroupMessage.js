const mongoose = require('mongoose');

const GroupMessageSchema = new mongoose.Schema({
    group_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatGroup',
        required: true,
        index: true
    },
    sender_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    text: {
        type: String,
        required: true,
        trim: true
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium',
        index: true
    },
    parent_message_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GroupMessage',
        default: null,
        index: true
    },
    is_edited: {
        type: Boolean,
        default: false
    },
    is_deleted: {
        type: Boolean,
        default: false,
        index: true
    },
    seen_by: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    }]
}, { timestamps: true });

// TTL index to automatically delete group messages after 24 hours (86400 seconds)
GroupMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

// Index for fast group messages retrieval
GroupMessageSchema.index({ group_id: 1, createdAt: 1 });

module.exports = mongoose.model('GroupMessage', GroupMessageSchema);
