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
    }
}, { timestamps: true });

// TTL index to automatically delete group messages after 24 hours (86400 seconds)
GroupMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

// Index for fast group messages retrieval
GroupMessageSchema.index({ group_id: 1, createdAt: 1 });

module.exports = mongoose.model('GroupMessage', GroupMessageSchema);
