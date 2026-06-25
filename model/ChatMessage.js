const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
    sender_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    
    recipient_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },

    text: {
        type: String,
        required: true,
        trim: true,
    },

    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium',
        index: true,
    },

    is_read: {
        type: Boolean,
        default: false,
        index: true,
    },

    parent_message_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatMessage',
        default: null,
        index: true,
    },

    is_edited: {
        type: Boolean,
        default: false,
    },

    is_deleted: {
        type: Boolean,
        default: false,
        index: true,
    },
}, { timestamps: true });

// Compound index for fast retrieval of historical conversations between two users
ChatMessageSchema.index({ sender_id: 1, recipient_id: 1, createdAt: 1 });

// TTL index to automatically delete conversations after 48 hours (172800 seconds)
ChatMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172800 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
