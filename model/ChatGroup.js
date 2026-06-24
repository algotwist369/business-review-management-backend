const mongoose = require('mongoose');

const ChatGroupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }]
}, { timestamps: true });

// Add indexes for member lookup
ChatGroupSchema.index({ members: 1 });

// TTL index to automatically delete group chat after 24 hours (86400 seconds)
ChatGroupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('ChatGroup', ChatGroupSchema);
